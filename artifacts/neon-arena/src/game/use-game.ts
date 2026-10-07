import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSnapshot,
  DEFAULT_SETTINGS,
  STARTER_LOADOUT,
} from './contract';
import type {
  GameModeId,
  GameSettings,
  GameSnapshot,
  HuntRole,
  RunConfig,
  RunModifierId,
  RunReward,
  WeaponId,
} from './contract';
import {
  adAvailability,
  claimAd,
  creditsForRun,
  equip as equipItem,
  grantCredits,
  loadStore,
  purchase as purchaseItem,
  saveStore,
  SHOP_ITEMS,
  type StoreState,
} from './economy';
import { GameEngine } from './engine';
import { useMultiplayer } from './use-multiplayer';
import {
  awardRun,
  describeProgress,
  loadProgress,
  sanitiseLoadout,
  sanitiseModifiers,
  saveProgress,
  type ProgressRecord,
} from './progression';

const SETTINGS_KEY = 'neon-arena:settings';
const KIT_KEY = 'neon-arena:kit:v1';

function loadSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      sensitivity:
        typeof parsed.sensitivity === 'number' &&
        Number.isFinite(parsed.sensitivity)
          ? Math.min(3, Math.max(0.2, parsed.sensitivity))
          : DEFAULT_SETTINGS.sensitivity,
      volume:
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? Math.min(1, Math.max(0, parsed.volume))
          : DEFAULT_SETTINGS.volume,
      effectsVolume:
        typeof parsed.effectsVolume === 'number' &&
        Number.isFinite(parsed.effectsVolume)
          ? Math.min(1, Math.max(0, parsed.effectsVolume))
          : DEFAULT_SETTINGS.effectsVolume,
      quality:
        parsed.quality === 'high' ||
        parsed.quality === 'medium' ||
        parsed.quality === 'low'
          ? parsed.quality
          : DEFAULT_SETTINGS.quality,
      showFps:
        typeof parsed.showFps === 'boolean'
          ? parsed.showFps
          : DEFAULT_SETTINGS.showFps,
      invertY:
        typeof parsed.invertY === 'boolean'
          ? parsed.invertY
          : DEFAULT_SETTINGS.invertY,
      movementStyle:
        parsed.movementStyle === 'classic' || parsed.movementStyle === 'slide'
          ? parsed.movementStyle
          : DEFAULT_SETTINGS.movementStyle,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

interface StoredKit {
  loadout: WeaponId[];
  modifiers: RunModifierId[];
  /** Mode armed for the next run. */
  mode: GameModeId;
  /** Side armed for Blackout. */
  huntRole: HuntRole;
}

const MODE_IDS: GameModeId[] = ['horde', 'royale', 'duel', 'hunt'];

function defaultKit(): StoredKit {
  return {
    loadout: [...STARTER_LOADOUT],
    modifiers: [],
    mode: 'horde',
    huntRole: 'hider',
  };
}

function loadKit(): StoredKit {
  try {
    const raw = window.localStorage.getItem(KIT_KEY);
    if (!raw) return defaultKit();
    const parsed = JSON.parse(raw) as Partial<StoredKit>;
    return {
      loadout: Array.isArray(parsed.loadout)
        ? parsed.loadout
        : [...STARTER_LOADOUT],
      modifiers: Array.isArray(parsed.modifiers) ? parsed.modifiers : [],
      mode:
        typeof parsed.mode === 'string' && MODE_IDS.includes(parsed.mode)
          ? parsed.mode
          : 'horde',
      huntRole: parsed.huntRole === 'seeker' ? 'seeker' : 'hider',
    };
  } catch {
    return defaultKit();
  }
}

function saveKit(kit: StoredKit): void {
  try {
    window.localStorage.setItem(KIT_KEY, JSON.stringify(kit));
  } catch {
    /* storage disabled -- the kit just resets next session */
  }
}

/**
 * Owns the Three.js engine instance and republishes its snapshots into React.
 * The engine pushes about 30 updates a second, which is smooth enough for the
 * HUD without forcing React to keep up with the render loop.
 *
 * Progression lives here rather than in the engine: the engine stays a pure
 * simulation with no storage, and this hook banks each finished run.
 */
export function useGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [snapshot, setSnapshot] = useState<GameSnapshot>(createSnapshot);
  const [settings, setSettingsState] = useState<GameSettings>(loadSettings);
  const [record, setRecord] = useState<ProgressRecord>(loadProgress);
  const [lastReward, setLastReward] = useState<RunReward | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<StoreState>(loadStore);
  const [ad, setAd] = useState({ playing: false, progress: 0 });
  /** Credits the finished run paid out, for the game over screen. */
  const [lastPayout, setLastPayout] = useState<{
    total: number;
    lines: { label: string; amount: number }[];
  } | null>(null);

  const progression = useMemo(() => describeProgress(record), [record]);
  const [kit, setKit] = useState<StoredKit>(loadKit);
  const multiplayer = useMultiplayer(
    engineRef,
    snapshot.arenaId,
    snapshot.phase === 'playing' ||
      snapshot.phase === 'paused' ||
      snapshot.phase === 'intermission',
    kit.mode,
  );

  // Anything the player has not unlocked yet is dropped on the way out, so a
  // kit saved before a reset can never smuggle a locked weapon into a run.
  const loadout = useMemo(
    () => sanitiseLoadout(kit.loadout, progression.level),
    [kit.loadout, progression.level],
  );
  const modifiers = useMemo(
    () => sanitiseModifiers(kit.modifiers, progression.level),
    [kit.modifiers, progression.level],
  );

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: GameEngine;
    try {
      engine = new GameEngine(canvas, setSnapshot);
    } catch (cause) {
      // Almost always a missing WebGL2 context: no GPU, a headless browser, or
      // hardware acceleration switched off. Say so instead of crashing.
      setError(
        cause instanceof Error && /webgl/i.test(cause.message)
          ? 'This browser could not create a WebGL context. Enable hardware acceleration or try Chrome, Edge, or Firefox on a desktop.'
          : `The renderer failed to start: ${String(cause)}`,
      );
      return;
    }

    engine.applySettings(settingsRef.current);
    engineRef.current = engine;

    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, []);

  // Bank the run exactly once when the engine reports a death. The snapshot
  // keeps arriving 30 times a second afterwards, hence the latch.
  const bankedRef = useRef(false);
  useEffect(() => {
    if (snapshot.phase !== 'dead') {
      bankedRef.current = false;
      return;
    }
    if (bankedRef.current) return;
    bankedRef.current = true;

    setRecord((current) => {
      const { record: next, reward } = awardRun(current, {
        score: snapshot.score,
        wave: snapshot.wave,
        kills: snapshot.kills,
      });
      saveProgress(next);
      setLastReward(reward);
      return next;
    });

    // Credits are banked from the same latch as XP, so a run can never pay
    // out twice however many snapshots arrive after death.
    const payout = creditsForRun({
      score: snapshot.score,
      kills: snapshot.kills,
      wave: snapshot.wave,
      win: snapshot.victory,
    });
    setLastPayout(payout);
    setStore((current) => {
      const next = grantCredits(current, payout.total);
      saveStore(next);
      return next;
    });
  }, [
    snapshot.phase,
    snapshot.score,
    snapshot.wave,
    snapshot.kills,
    snapshot.victory,
  ]);

  const setSettings = useCallback((next: GameSettings) => {
    setSettingsState(next);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    engineRef.current?.applySettings(next);
  }, []);

  const setLoadout = useCallback((next: WeaponId[]) => {
    setKit((current) => {
      const updated = { ...current, loadout: next };
      saveKit(updated);
      return updated;
    });
  }, []);

  const setModifiers = useCallback((next: RunModifierId[]) => {
    setKit((current) => {
      const updated = { ...current, modifiers: next };
      saveKit(updated);
      return updated;
    });
  }, []);

  // The host picks the mode for the room. A guest whose menu says something
  // else would start a run the room is not playing, so follow the host --
  // but only outside a run, so nobody's mode changes under them mid-match.
  const roomGameMode = multiplayer.roomGameMode;
  const followingHost = !multiplayer.isHost && roomGameMode !== null;
  useEffect(() => {
    if (!followingHost || roomGameMode === null) return;
    if (snapshot.phase !== 'menu') return;
    setKit((current) => {
      if (current.mode === roomGameMode) return current;
      const updated = { ...current, mode: roomGameMode };
      saveKit(updated);
      return updated;
    });
  }, [followingHost, roomGameMode, snapshot.phase]);

  // Ignored rather than reverted for a guest: letting the card flip and snap
  // back a frame later looks like a bug rather than a rule.
  const followingHostRef = useRef(followingHost);
  followingHostRef.current = followingHost;
  const setMode = useCallback((next: GameModeId) => {
    if (followingHostRef.current) return;
    setKit((current) => {
      const updated = { ...current, mode: next };
      saveKit(updated);
      return updated;
    });
  }, []);

  const setHuntRole = useCallback((next: HuntRole) => {
    setKit((current) => {
      const updated = { ...current, huntRole: next };
      saveKit(updated);
      return updated;
    });
  }, []);

  const purchase = useCallback((itemId: string) => {
    setStore((current) => {
      const result = purchaseItem(current, itemId);
      if (!result.ok) return current;
      saveStore(result.state);
      return result.state;
    });
  }, []);

  const equip = useCallback((itemId: string) => {
    setStore((current) => {
      const next = equipItem(current, itemId);
      saveStore(next);
      return next;
    });
  }, []);

  /**
   * The sponsor feed. There is no ad network wired up -- this plays a timed
   * house spot and pays the same reward a real one would, so the flow, the
   * cooldown and the daily cap are all real even though the inventory is not.
   */
  const adTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (adTimer.current !== null) window.clearInterval(adTimer.current);
    },
    [],
  );

  const watchAd = useCallback(() => {
    if (adTimer.current !== null) return;
    if (!adAvailability(store, Date.now()).ready) return;

    setAd({ playing: true, progress: 0 });
    const started = Date.now();
    const duration = 6000;
    adTimer.current = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / duration);
      setAd({ playing: progress < 1, progress });
      if (progress < 1) return;

      if (adTimer.current !== null) window.clearInterval(adTimer.current);
      adTimer.current = null;
      setStore((current) => {
        const result = claimAd(current, Date.now());
        if (!result.ok) return current;
        saveStore(result.state);
        return result.state;
      });
    }, 100);
  }, [store]);

  /** Cosmetics and perks the shop has equipped, in the engine's shape. */
  const kitFromStore = useMemo(() => {
    const skinItem = SHOP_ITEMS.find((i) => i.id === store.equippedSkin);
    const trailItem = SHOP_ITEMS.find((i) => i.id === store.equippedTrail);
    return {
      skin: skinItem
        ? { body: skinItem.color, trim: skinItem.accent ?? skinItem.color }
        : undefined,
      trail: trailItem ? trailItem.color : null,
      perks: SHOP_ITEMS.filter(
        (i) => i.category === 'perk' && store.owned.includes(i.id),
      ).map((i) => i.perk ?? i.id),
    };
  }, [store.equippedSkin, store.equippedTrail, store.owned]);

  const kitRef = useRef(kitFromStore);
  kitRef.current = kitFromStore;

  // Deploying is the last moment the mode can still be corrected. The effect
  // that syncs a guest's menu commits a render later than a fast click, so the
  // room's mode is re-applied here rather than trusting the stored kit.
  const enforcedModeRef = useRef<GameModeId | null>(null);
  enforcedModeRef.current = followingHost ? roomGameMode : null;

  const actions = useMemo(
    () => ({
      start: (config: RunConfig) => {
        setLastReward(null);
        setLastPayout(null);
        const mode = enforcedModeRef.current ?? config.mode;
        engineRef.current?.start({ ...config, mode, ...kitRef.current });
      },
      resume: () => engineRef.current?.resume(),
      restart: () => {
        setLastReward(null);
        engineRef.current?.restart();
      },
      quit: () => engineRef.current?.quitToMenu(),
      chooseUpgrade: (id: string) => engineRef.current?.chooseUpgrade(id),
      setArena: (id: string) => engineRef.current?.setArena(id),
    }),
    [],
  );

  const adState = useMemo(() => {
    const availability = adAvailability(store, Date.now());
    return { ...availability, playing: ad.playing, progress: ad.progress };
    // `ad` drives the recompute while a spot is playing; the cooldown itself
    // only has to be right at the moment the shop is opened.
  }, [store, ad]);

  return {
    canvasRef,
    snapshot,
    settings,
    setSettings,
    personalBest: record.bestScore > 0 ? record.bestScore : null,
    progression,
    lastReward,
    lastPayout,
    loadout,
    setLoadout,
    modifiers,
    setModifiers,
    mode: kit.mode,
    setMode,
    /** Set while a guest is bound to the host's choice of mode. */
    modeLocked: followingHost,
    huntRole: kit.huntRole,
    setHuntRole,
    store,
    purchase,
    equip,
    watchAd,
    adState,
    multiplayer,
    actions,
    error,
  };
}
