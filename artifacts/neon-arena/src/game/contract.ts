/**
 * Shared contract between the 3D game engine (src/game/*) and the React
 * interface layer (src/ui/*).
 *
 * The engine owns all of these values and pushes a fresh `GameSnapshot` to
 * subscribers roughly 30 times per second. Every component in `src/ui` is a
 * pure presentational component: it receives a snapshot plus callbacks and
 * never imports anything from the engine other than these types.
 */

export type GamePhase =
  /** Title screen, no run in progress. */
  | 'menu'
  /** A run is live and the player is in control. */
  | 'playing'
  /** Between waves. The player is choosing an upgrade. */
  | 'intermission'
  /** Run is live but suspended (Escape / pointer lock lost). */
  | 'paused'
  /** The run has ended. */
  | 'dead';

export type WeaponId = 'pulse' | 'plasma' | 'scatter' | 'arc';

/**
 * Every enemy archetype, mirrored by `ENEMY_CONFIG` in enemies.ts. That table
 * imports this union so the two can never drift apart.
 */
export type EnemyKindId =
  | 'skitter'
  | 'spectre'
  | 'splitter'
  | 'brute'
  | 'seeker'
  | 'warden'
  // The infected family, used by Zombie Horde. They share the construct
  // runtime exactly -- only the stats and the body differ.
  | 'shambler'
  | 'runner'
  | 'bloater'
  | 'stalker'
  | 'screamer'
  // Rival operators: bots in Royale and Duel, and hunters in Blackout.
  | 'operator';

export interface EnemyKindInfo {
  id: EnemyKindId;
  /** Display name, matching the archetype's callout in the kill feed. */
  name: string;
  /** CSS colour of the archetype's shell, for legends and breakdowns. */
  accent: string;
}

/** Display list for kill breakdowns, ordered as the archetypes unlock. */
export const ENEMY_KINDS: EnemyKindInfo[] = [
  { id: 'skitter', name: 'SKITTER', accent: '#ff2d78' },
  { id: 'spectre', name: 'SPECTRE', accent: '#22e0ff' },
  { id: 'splitter', name: 'SPLITTER', accent: '#a855f7' },
  { id: 'brute', name: 'BRUTE', accent: '#ffb020' },
  { id: 'seeker', name: 'SEEKER', accent: '#ff6b1a' },
  { id: 'warden', name: 'WARDEN', accent: '#3ddc84' },
  { id: 'shambler', name: 'SHAMBLER', accent: '#7f9a4a' },
  { id: 'runner', name: 'RUNNER', accent: '#c2d94c' },
  { id: 'bloater', name: 'BLOATER', accent: '#9bc53d' },
  { id: 'stalker', name: 'STALKER', accent: '#4ade80' },
  { id: 'screamer', name: 'SCREAMER', accent: '#a3e635' },
  { id: 'operator', name: 'OPERATOR', accent: '#ff4d6d' },
];

export interface WeaponState {
  id: WeaponId;
  /** Display name, e.g. "PULSE RIFLE". */
  name: string;
  /** Rounds currently in the magazine. */
  ammo: number;
  /** Magazine capacity. */
  magazine: number;
  /** True while a reload animation is running. */
  reloading: boolean;
  /** Reload completion, 0 to 1. */
  reloadProgress: number;
  /** Alt-fire charge level, 0 to 1. Only the plasma weapon charges. */
  charge: number;
  /** True when this weapon supports hold-to-charge alt fire. */
  chargeable: boolean;
}

export type UpgradeFamily = 'offense' | 'defense' | 'mobility' | 'utility';
export type UpgradeTier = 'common' | 'rare' | 'elite';

export interface UpgradeOption {
  id: string;
  /** Short punchy name, e.g. "HOLLOW POINT". */
  name: string;
  /** One-line flavour, e.g. "Rounds that open up on impact." */
  tagline: string;
  /** The concrete mechanical effect, e.g. "+20% weapon damage". */
  effect: string;
  family: UpgradeFamily;
  tier: UpgradeTier;
  /** How many times the player has already taken this upgrade. */
  stacks: number;
}

export type FeedTone = 'kill' | 'crit' | 'wave' | 'warn' | 'buff';

export interface FeedEntry {
  id: number;
  text: string;
  tone: FeedTone;
}

export type MarkerKind = 'hit' | 'crit' | 'kill';

/* ------------------------------------------------------------------ */
/* Loadout                                                             */
/* ------------------------------------------------------------------ */

/** How many weapons the player carries into a run. */
export const LOADOUT_SLOTS = 2;

export interface WeaponInfo {
  id: WeaponId;
  /** Display name, e.g. "PULSE RIFLE". The engine reads names from here. */
  name: string;
  /** One-line role. */
  tagline: string;
  /** How it plays, shown while picking a loadout. */
  detail: string;
}

/** Display catalogue for the loadout screen, in unlock order. */
export const WEAPONS: WeaponInfo[] = [
  {
    id: 'pulse',
    name: 'PULSE RIFLE',
    tagline: 'Hitscan workhorse.',
    detail: 'High cadence, deep magazine, no travel time. Never a wrong pick.',
  },
  {
    id: 'plasma',
    name: 'PLASMA LANCE',
    tagline: 'Charged splash.',
    detail: 'Slow projectile with a blast radius. Hold alt-fire to overcharge.',
  },
  {
    id: 'scatter',
    name: 'SHARD BURST',
    tagline: 'Point blank burst.',
    detail: 'Nine pellets with brutal falloff. Rewards closing on the heavies.',
  },
  {
    id: 'arc',
    name: 'ARC TETHER',
    tagline: 'Chains through crowds.',
    detail: 'Low per-hit damage that jumps to four targets. Answer to a swarm.',
  },
];

export function weaponInfo(id: WeaponId): WeaponInfo {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0]!;
}

/** The two weapons available before anything has been unlocked. */
export const STARTER_LOADOUT: WeaponId[] = ['pulse', 'plasma'];

export type RunModifierId = 'iron' | 'swarm' | 'glass' | 'frenzy';

/**
 * An optional handicap taken before a run. Every modifier makes the run
 * harder and pays for it with score, which in turn is what earns levels.
 */
export interface RunModifier {
  id: RunModifierId;
  /** Short name, e.g. "IRON OPERATOR". */
  name: string;
  tagline: string;
  /** The concrete mechanical cost, e.g. "No overshield". */
  effect: string;
  /** Score multiplier this modifier applies for the whole run. */
  scoreMul: number;
}

/* ------------------------------------------------------------------ */
/* Game modes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Which set of rules a run is played under. The simulation -- movement,
 * weapons, damage, arena -- is identical across all four; only the objective,
 * the opposition and the end condition change.
 */
export type GameModeId = 'horde' | 'royale' | 'duel' | 'hunt';

/** Which side of a Blackout (hide and seek) match the player is on. */
export type HuntRole = 'hider' | 'seeker';

/** Everything the engine needs to configure a run before it starts. */
export interface RunConfig {
  /** Weapons carried, in slot order. Exactly `LOADOUT_SLOTS` entries. */
  loadout: WeaponId[];
  modifiers: RunModifierId[];
  /** Rules to play under. Defaults to `horde` when omitted. */
  mode?: GameModeId;
  /** Blackout only: which side the player takes. Defaults to `hider`. */
  huntRole?: HuntRole;
  /** Cosmetic body colours, from the shop. */
  skin?: { body: number; trim: number };
  /** Projectile trail colour from the shop, or null for the weapon default. */
  trail?: number | null;
  /** Perks bought in the shop and equipped for this run. */
  perks?: string[];
  /** True when this run is a networked match against another operator. */
  online?: boolean;
}

/* ------------------------------------------------------------------ */
/* Progression                                                         */
/* ------------------------------------------------------------------ */

export type UnlockKind = 'weapon' | 'arena' | 'modifier';

export interface UnlockDef {
  id: string;
  kind: UnlockKind;
  /** A `WeaponId`, an arena id, or a `RunModifierId`, matching `kind`. */
  target: string;
  /** Operator level at which this becomes available. */
  level: number;
  name: string;
  description: string;
}

/** Everything the interface needs to draw the player's career so far. */
export interface ProgressionState {
  level: number;
  /** Lifetime XP. */
  xp: number;
  /** XP banked inside the current level. */
  xpIntoLevel: number;
  /** XP the current level costs end to end. */
  xpForLevel: number;
  runs: number;
  kills: number;
  bestScore: number;
  bestWave: number;
  /** Ids of every unlock earned so far. */
  unlocked: string[];
  /** The next unlock still to come, or null once everything is earned. */
  nextUnlock: UnlockDef | null;
}

/** What a single finished run paid out. Rendered on the game over screen. */
export interface RunReward {
  xpEarned: number;
  breakdown: { label: string; xp: number }[];
  levelBefore: number;
  levelAfter: number;
  /** Unlocks this run crossed the threshold for. */
  unlocked: UnlockDef[];
  /** True when this run beat the stored personal best. */
  personalBest: boolean;
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

export interface GameSnapshot {
  phase: GamePhase;

  /** Id of the map currently loaded. Matches an entry in ARENAS. */
  arenaId: string;

  /** Current health. Reaches 0 on death. */
  health: number;
  maxHealth: number;
  /** Regenerating overshield that absorbs damage before health. */
  shield: number;
  maxShield: number;

  /** Dash charges currently available. */
  dashCharges: number;
  maxDashCharges: number;
  /** Recharge progress of the next dash charge, 0 to 1. */
  dashRecharge: number;

  /** Only the weapons carried this run, in slot order. */
  weapons: WeaponState[];
  activeWeapon: WeaponId;
  /** Modifiers this run is being played with. */
  modifiers: RunModifierId[];

  /** Wave number, starting at 1. */
  wave: number;
  /** Enemies still alive in the current wave. */
  enemiesRemaining: number;
  /** Total enemies in the current wave. */
  enemiesTotal: number;
  /** Seconds until the next wave begins. 0 when not counting down. */
  waveCountdown: number;

  score: number;
  /** Combo multiplier applied to score, 1 or higher. */
  combo: number;
  /** Fraction of the combo window remaining, 0 to 1. */
  comboTimer: number;
  /** Highest combo reached this run. */
  bestCombo: number;
  kills: number;
  /** Kills this run broken down by archetype. */
  killsByKind: Record<EnemyKindId, number>;
  /** Shots fired this run, counting each shotgun volley once. */
  shotsFired: number;
  /** Shot accuracy percentage, 0 to 100. */
  accuracy: number;
  /** Elapsed run time in seconds. */
  timeSeconds: number;
  /** Smoothed frames per second, for the optional on-screen readout. */
  fps: number;

  /** Overdrive meter fill, 0 to 1. */
  overdrive: number;
  /** True while Overdrive is being spent. */
  overdriveActive: boolean;
  /** Remaining Overdrive duration, 0 to 1, while active. */
  overdriveRemaining: number;

  /**
   * Increments every time the player lands a shot. Key hit-marker animations
   * off this value rather than off a boolean, so rapid hits each animate.
   */
  markerId: number;
  markerKind: MarkerKind;

  /** Increments every time the player takes damage. */
  damageId: number;
  /** Direction of the most recent incoming damage, in radians relative to the
   * camera forward vector. 0 is directly ahead, positive is to the right. */
  damageAngle: number;

  /** Large centre-screen callout, e.g. "WAVE 4". Null when nothing to show. */
  announcement: string | null;
  /** Smaller line under the announcement. */
  announcementSub: string | null;

  /** Newest first. Capped at 6 entries by the engine. */
  feed: FeedEntry[];

  /** The three upgrades offered during `intermission`. */
  upgradeChoices: UpgradeOption[];
  /** Upgrades the player has already banked this run, newest last. */
  ownedUpgrades: UpgradeOption[];

  /* ---------------------------- game mode ---------------------------- */

  /** Rules this run is being played under. */
  mode: GameModeId;
  /** One-line statement of what the player has to do right now. */
  objective: string;
  /** Rival operators still alive, for Royale and Duel. */
  opponents: number;
  /** Generic mode countdown in seconds, 0 when nothing is pending. */
  modeTimer: number;
  /** Royale: current radius of the safe zone in metres, 0 when unused. */
  zoneRadius: number;
  /** Royale: true while the zone is actively closing. */
  zoneClosing: boolean;
  /** Royale: true while the player is taking grid damage outside the zone. */
  outsideZone: boolean;
  /** Duel: rounds won, player first. */
  duelScore: { player: number; rival: number };
  /** Duel: round number, starting at 1. */
  duelRound: number;
  /** Blackout: which side the player is on. */
  huntRole: HuntRole;
  /** Blackout: how close the opposition is to a lock, 0 to 1. */
  detection: number;
  /** Blackout: hiders still undiscovered. */
  hidersLeft: number;
  /** True once the run has been won rather than lost. */
  victory: boolean;
  /** Credits this run has banked so far. */
  credits: number;
  /**
   * Other operators in the match. Empty offline. `hostile` is false in the
   * co-op horde mode, where a squadmate cannot be shot.
   */
  rivals: {
    callsign: string;
    health: number;
    maxHealth: number;
    dead: boolean;
    hostile: boolean;
  }[];

  /* ---------------------------- movement ----------------------------- */

  /** Boost fuel remaining, 0 to 1. Only meaningful in the slide/boost style. */
  boostFuel: number;
  /** True while the operator is in a slide. */
  sliding: boolean;

  /** True when the browser pointer lock is active. */
  pointerLocked: boolean;

  /** True while the operator is aiming down the active weapon's scope. */
  scoped: boolean;
  /** Scope magnification of the active weapon. 1 means no scope fitted. */
  zoomLevel: number;
}

export type QualityLevel = 'low' | 'medium' | 'high';

export interface GameSettings {
  /** Mouse look sensitivity multiplier, 0.2 to 3. */
  sensitivity: number;
  /** Master audio volume, 0 to 1. Scales everything the game plays. */
  volume: number;
  /** Weapon and impact volume relative to master, 0 to 1. */
  effectsVolume: number;
  /**
   * Render budget. `high` is full bloom, `medium` halves the bloom pass and
   * thins particles, `low` drops the bloom pass entirely.
   */
  quality: QualityLevel;
  /** Show the frame-rate readout in the corner of the HUD. */
  showFps: boolean;
  /** Invert vertical mouse look. */
  invertY: boolean;
  /**
   * `classic` is hold-to-sprint plus a flat ground dash. `slide` swaps those
   * for a momentum slide (crouch while running) and a fuel-metered thruster
   * boost that works in the air.
   */
  movementStyle: MovementStyle;
}

export type MovementStyle = 'classic' | 'slide';

export const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 1,
  volume: 0.7,
  effectsVolume: 0.85,
  quality: 'high',
  showFps: false,
  invertY: false,
  movementStyle: 'slide',
};

/** A zeroed kill tally, one entry per archetype. */
export function emptyKillTally(): Record<EnemyKindId, number> {
  return {
    skitter: 0,
    spectre: 0,
    splitter: 0,
    brute: 0,
    seeker: 0,
    warden: 0,
    shambler: 0,
    runner: 0,
    bloater: 0,
    stalker: 0,
    screamer: 0,
    operator: 0,
  };
}

/**
 * A representative snapshot. Useful as a default value and as reference for
 * what the interface has to render.
 */
export function createSnapshot(): GameSnapshot {
  return {
    phase: 'menu',
    // Kept as a literal so the contract stays free of Three.js imports.
    arenaId: 'grid',
    health: 100,
    maxHealth: 100,
    shield: 50,
    maxShield: 50,
    dashCharges: 2,
    maxDashCharges: 2,
    dashRecharge: 1,
    weapons: [
      {
        id: 'pulse',
        name: 'PULSE RIFLE',
        ammo: 28,
        magazine: 28,
        reloading: false,
        reloadProgress: 0,
        charge: 0,
        chargeable: false,
      },
      {
        id: 'plasma',
        name: 'PLASMA LANCE',
        ammo: 5,
        magazine: 5,
        reloading: false,
        reloadProgress: 0,
        charge: 0,
        chargeable: true,
      },
    ],
    activeWeapon: 'pulse',
    modifiers: [],
    wave: 1,
    enemiesRemaining: 0,
    enemiesTotal: 0,
    waveCountdown: 0,
    score: 0,
    combo: 1,
    comboTimer: 0,
    bestCombo: 1,
    kills: 0,
    killsByKind: emptyKillTally(),
    shotsFired: 0,
    accuracy: 100,
    timeSeconds: 0,
    fps: 60,
    overdrive: 0,
    overdriveActive: false,
    overdriveRemaining: 0,
    markerId: 0,
    markerKind: 'hit',
    damageId: 0,
    damageAngle: 0,
    announcement: null,
    announcementSub: null,
    feed: [],
    upgradeChoices: [],
    ownedUpgrades: [],
    mode: 'horde',
    objective: '',
    opponents: 0,
    modeTimer: 0,
    zoneRadius: 0,
    zoneClosing: false,
    outsideZone: false,
    duelScore: { player: 0, rival: 0 },
    duelRound: 1,
    huntRole: 'hider',
    detection: 0,
    hidersLeft: 0,
    victory: false,
    credits: 0,
    rivals: [],
    boostFuel: 1,
    sliding: false,
    pointerLocked: false,
    scoped: false,
    zoomLevel: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Component prop contracts implemented in src/ui                      */
/* ------------------------------------------------------------------ */

export interface MainMenuProps {
  /**
   * Begins a run with the given loadout. Requests pointer lock as a direct
   * result of the click, so it must be called from the click handler itself.
   */
  onStart: (config: RunConfig) => void;
  /** Mode armed for the next run. */
  mode: GameModeId;
  onModeChange: (id: GameModeId) => void;
  /** True while a squad guest is bound to the host's mode; the cards go read-only. */
  modeLocked?: boolean;
  /** Blackout side armed for the next run. */
  huntRole: HuntRole;
  onHuntRoleChange: (role: HuntRole) => void;
  /** Wallet, catalogue ownership and equipped cosmetics. */
  store: StoreLike;
  onPurchase: (itemId: string) => void;
  onEquip: (itemId: string) => void;
  /** Starts the rewarded sponsor feed. Resolves when the reward is banked. */
  onWatchAd: () => void;
  /** Live state of the sponsor feed, for the shop's reward button. */
  ad: { ready: boolean; waitMs: number; remaining: number; playing: boolean; progress: number };
  settings: GameSettings;
  onSettingsChange: (next: GameSettings) => void;
  /** Best score this browser has recorded locally, or null if never played. */
  personalBest: number | null;
  /** Id of the map currently loaded. */
  arenaId: string;
  /** Swaps the map. Only accepted while on the menu. */
  onArenaChange: (id: string) => void;
  /** Career state: level, XP and what has been unlocked. */
  progression: ProgressionState;
  /** Weapons the player last deployed with, restored between sessions. */
  loadout: WeaponId[];
  onLoadoutChange: (next: WeaponId[]) => void;
  /** Modifiers armed for the next run. */
  modifiers: RunModifierId[];
  onModifiersChange: (next: RunModifierId[]) => void;
  online: {
    status: 'idle' | 'connecting' | 'waiting' | 'matched' | 'error';
    mode: 'private' | 'quick' | null;
    roomCode: string | null;
    error: string | null;
    players: Array<{ id: string; callsign: string; local: boolean }>;
    createPrivate: () => void;
    joinPrivate: (code: string) => void;
    quickPlay: () => void;
    cancel: () => void;
  };
}

/**
 * The shop's persisted state, re-exported so UI props can name it without
 * every menu component importing the economy module directly.
 */
export type StoreLike = import('./economy').StoreState;

export interface HudProps {
  snapshot: GameSnapshot;
  /** Optional readouts the player can switch on in settings. */
  showFps?: boolean;
  /** Decides whether the mobility strip shows dashes or boost fuel. */
  movementStyle?: MovementStyle;
}

export interface PauseMenuProps {
  snapshot: GameSnapshot;
  settings: GameSettings;
  onSettingsChange: (next: GameSettings) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

export interface IntermissionProps {
  snapshot: GameSnapshot;
  /** Called with the chosen `UpgradeOption.id`. */
  onChoose: (upgradeId: string) => void;
}

export interface GameOverProps {
  snapshot: GameSnapshot;
  /** What the run paid out, or null while the award is still being banked. */
  reward: RunReward | null;
  /** Career state after this run was banked. */
  progression: ProgressionState;
  /** Credits banked for this run, itemised for the summary. */
  payout: {
    total: number;
    lines: { label: string; amount: number }[];
  } | null;
  onRestart: () => void;
  onQuit: () => void;
}
