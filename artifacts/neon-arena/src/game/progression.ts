/**
 * Career progression: the only part of the game that survives a run.
 *
 * A single small record is persisted (lifetime XP plus a few bests) and
 * everything the interface shows -- level, unlocks, what is coming next -- is
 * derived from it. Nothing here touches Three.js, so the React layer can
 * import the catalogues directly to draw locked and unlocked state.
 */

import type {
  ProgressionState,
  RunModifier,
  RunModifierId,
  RunReward,
  UnlockDef,
  WeaponId,
} from './contract';
import { LOADOUT_SLOTS, STARTER_LOADOUT, WEAPONS } from './contract';
import type { PlayerStats } from './upgrades';

const STORAGE_KEY = 'neon-arena:progress:v1';
/** Pre-progression builds stored only a high score. Fold it in on first load. */
const LEGACY_BEST_KEY = 'neon-arena:best';

/* --------------------------------------------------------------------- */
/* Modifiers                                                              */
/* --------------------------------------------------------------------- */

/** Run-wide knobs a modifier can move that are not player stats. */
export interface RunTuning {
  /** Multiplier on every enemy's base movement speed. */
  enemySpeedMul: number;
  /** Multiplier on the spawn budget of every wave. */
  waveBudgetMul: number;
}

export function baseTuning(): RunTuning {
  return { enemySpeedMul: 1, waveBudgetMul: 1 };
}

interface ModifierDef extends RunModifier {
  apply: (stats: PlayerStats, tuning: RunTuning) => void;
}

const MODIFIER_DEFS: ModifierDef[] = [
  {
    id: 'iron',
    name: 'IRON OPERATOR',
    tagline: 'The overshield emitter stays in the locker.',
    effect: 'No overshield',
    scoreMul: 1.4,
    apply: (stats) => {
      stats.maxShield = 0;
    },
  },
  {
    id: 'swarm',
    name: 'SWARM PROTOCOL',
    tagline: 'Command sends everything at once.',
    effect: '+45% hostiles per wave',
    scoreMul: 1.55,
    apply: (_stats, tuning) => {
      tuning.waveBudgetMul *= 1.45;
    },
  },
  {
    id: 'glass',
    name: 'GLASS CANNON',
    tagline: 'All the power routed away from the plating.',
    effect: '+85% damage, integrity capped at 45',
    scoreMul: 1.7,
    apply: (stats) => {
      stats.damageMul *= 1.85;
      stats.maxHealth = 45;
    },
  },
  {
    id: 'frenzy',
    name: 'FRENZY DRIVE',
    tagline: 'Their servos are running well past rated speed.',
    effect: '+30% enemy movement speed',
    scoreMul: 1.35,
    apply: (_stats, tuning) => {
      tuning.enemySpeedMul *= 1.3;
    },
  },
];

/** Display catalogue for the loadout screen. */
export const MODIFIERS: RunModifier[] = MODIFIER_DEFS.map(
  ({ apply: _apply, ...rest }) => rest,
);

export function modifierInfo(id: RunModifierId): RunModifier | null {
  return MODIFIERS.find((m) => m.id === id) ?? null;
}

/**
 * Folds every armed modifier into the run. Mutates `stats` and `tuning` and
 * returns the combined score multiplier the modifiers paid out.
 */
export function applyRunModifiers(
  ids: RunModifierId[],
  stats: PlayerStats,
  tuning: RunTuning,
): void {
  for (const id of ids) {
    const def = MODIFIER_DEFS.find((m) => m.id === id);
    if (!def) continue;
    def.apply(stats, tuning);
    stats.scoreMul *= def.scoreMul;
  }
}

/* --------------------------------------------------------------------- */
/* Unlocks                                                                */
/* --------------------------------------------------------------------- */

/**
 * What each level hands over. Weapons and maps arrive early so the first
 * handful of runs each change something; modifiers are the long tail.
 */
export const UNLOCKS: UnlockDef[] = [
  {
    id: 'weapon-scatter',
    kind: 'weapon',
    target: 'scatter',
    level: 1,
    name: 'SHARD BURST',
    description: 'Close-range burst weapon added to the armoury.',
  },
  {
    id: 'arena-reactor',
    kind: 'arena',
    target: 'reactor',
    level: 1,
    name: 'REACTOR',
    description: 'Radial sector with a central stack to orbit.',
  },
  {
    id: 'weapon-arc',
    kind: 'weapon',
    target: 'arc',
    level: 1,
    name: 'ARC TETHER',
    description: 'Chain weapon added to the armoury.',
  },
  {
    id: 'modifier-iron',
    kind: 'modifier',
    target: 'iron',
    level: 1,
    name: 'IRON OPERATOR',
    description: 'Run without an overshield for +40% score.',
  },
  {
    id: 'arena-coldstore',
    kind: 'arena',
    target: 'coldstore',
    level: 1,
    name: 'COLD STORAGE',
    description: 'Container maze with blind corners.',
  },
  {
    id: 'modifier-swarm',
    kind: 'modifier',
    target: 'swarm',
    level: 1,
    name: 'SWARM PROTOCOL',
    description: 'Far bigger waves for +55% score.',
  },
  {
    id: 'modifier-glass',
    kind: 'modifier',
    target: 'glass',
    level: 1,
    name: 'GLASS CANNON',
    description: 'Huge damage on 45 integrity for +70% score.',
  },
  {
    id: 'modifier-frenzy',
    kind: 'modifier',
    target: 'frenzy',
    level: 1,
    name: 'FRENZY DRIVE',
    description: 'Faster hostiles for +35% score.',
  },
];

/* --------------------------------------------------------------------- */
/* Levels                                                                 */
/* --------------------------------------------------------------------- */

/** XP the given level costs to clear. Level 1 costs 600, then +300 each. */
export function levelCost(level: number): number {
  return 600 + Math.max(0, level - 1) * 300;
}

interface LevelPosition {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
}

function positionOf(xp: number): LevelPosition {
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));
  // The curve is linear, so this loop is bounded by a handful of iterations
  // per thousand XP -- cheap enough to keep the maths readable.
  for (;;) {
    const cost = levelCost(level);
    if (remaining < cost) {
      return { level, xpIntoLevel: remaining, xpForLevel: cost };
    }
    remaining -= cost;
    level += 1;
  }
}

/* --------------------------------------------------------------------- */
/* Persisted record                                                       */
/* --------------------------------------------------------------------- */

export interface ProgressRecord {
  xp: number;
  runs: number;
  kills: number;
  bestScore: number;
  bestWave: number;
}

export function emptyRecord(): ProgressRecord {
  return { xp: 0, runs: 0, kills: 0, bestScore: 0, bestWave: 0 };
}

function sanitiseNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function loadProgress(): ProgressRecord {
  const record = emptyRecord();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const candidate = parsed as Partial<ProgressRecord>;
          record.xp = sanitiseNumber(candidate.xp);
          record.runs = sanitiseNumber(candidate.runs);
          record.kills = sanitiseNumber(candidate.kills);
          record.bestScore = sanitiseNumber(candidate.bestScore);
          record.bestWave = sanitiseNumber(candidate.bestWave);
        }
      } catch {
        // A corrupt current record must not prevent recovery of a legacy best.
      }
    }
    const legacy = sanitiseNumber(
      Number.parseInt(window.localStorage.getItem(LEGACY_BEST_KEY) ?? '', 10),
    );
    if (legacy > record.bestScore) record.bestScore = legacy;
  } catch {
    return emptyRecord();
  }
  return record;
}

export function saveProgress(record: ProgressRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* storage disabled -- progression is a nicety, never a hard failure */
  }
}

/* --------------------------------------------------------------------- */
/* Derived state                                                          */
/* --------------------------------------------------------------------- */

export function describeProgress(record: ProgressRecord): ProgressionState {
  const { level, xpIntoLevel, xpForLevel } = positionOf(record.xp);
  const unlocked = UNLOCKS.filter((u) => u.level <= level);
  return {
    level,
    xp: record.xp,
    xpIntoLevel,
    xpForLevel,
    runs: record.runs,
    kills: record.kills,
    bestScore: record.bestScore,
    bestWave: record.bestWave,
    unlocked: unlocked.map((u) => u.id),
    nextUnlock: UNLOCKS.find((u) => u.level > level) ?? null,
  };
}

function hasUnlock(level: number, kind: UnlockDef['kind'], target: string) {
  const def = UNLOCKS.find((u) => u.kind === kind && u.target === target);
  // Anything not on the unlock table ships with the game.
  return !def || def.level <= level;
}

export function isWeaponUnlocked(level: number, id: WeaponId): boolean {
  return hasUnlock(level, 'weapon', id);
}

export function isArenaUnlocked(level: number, id: string): boolean {
  return hasUnlock(level, 'arena', id);
}

export function isModifierUnlocked(level: number, id: RunModifierId): boolean {
  return hasUnlock(level, 'modifier', id);
}

/** The level a locked entry becomes available at, or null if it is not gated. */
export function unlockLevelFor(
  kind: UnlockDef['kind'],
  target: string,
): number | null {
  return UNLOCKS.find((u) => u.kind === kind && u.target === target)?.level ?? null;
}

/** Drops anything the player has not unlocked and pads back to full slots. */
export function sanitiseLoadout(
  loadout: readonly WeaponId[],
  level: number,
): WeaponId[] {
  const kept: WeaponId[] = [];
  const knownWeapons = new Set<WeaponId>(WEAPONS.map((weapon) => weapon.id));
  for (const id of loadout) {
    if (kept.length >= LOADOUT_SLOTS) break;
    if (kept.includes(id)) continue;
    if (!knownWeapons.has(id)) continue;
    if (!isWeaponUnlocked(level, id)) continue;
    kept.push(id);
  }
  for (const id of STARTER_LOADOUT) {
    if (kept.length >= LOADOUT_SLOTS) break;
    if (!kept.includes(id)) kept.push(id);
  }
  return kept;
}

export function sanitiseModifiers(
  modifiers: readonly RunModifierId[],
  level: number,
): RunModifierId[] {
  return MODIFIERS.filter(
    (m) => modifiers.includes(m.id) && isModifierUnlocked(level, m.id),
  ).map((m) => m.id);
}

/* --------------------------------------------------------------------- */
/* Awarding a run                                                         */
/* --------------------------------------------------------------------- */

const XP_PER_SCORE = 1 / 25;
const XP_PER_WAVE = 30;
const XP_PER_KILL = 3;

export interface RunResult {
  score: number;
  wave: number;
  kills: number;
}

/**
 * Banks a finished run. Returns the record to persist plus what the player
 * earned, which is what the game over screen reads.
 */
export function awardRun(
  record: ProgressRecord,
  run: RunResult,
): { record: ProgressRecord; reward: RunReward } {
  const current: ProgressRecord = {
    xp: sanitiseNumber(record.xp),
    runs: sanitiseNumber(record.runs),
    kills: sanitiseNumber(record.kills),
    bestScore: sanitiseNumber(record.bestScore),
    bestWave: sanitiseNumber(record.bestWave),
  };
  const score = sanitiseNumber(run.score);
  const wave = sanitiseNumber(run.wave);
  const kills = sanitiseNumber(run.kills);

  const scoreXp = Math.round(score * XP_PER_SCORE);
  const waveXp = wave * XP_PER_WAVE;
  const killXp = kills * XP_PER_KILL;
  const xpEarned = scoreXp + waveXp + killXp;

  const levelBefore = positionOf(current.xp).level;
  const next: ProgressRecord = {
    xp: current.xp + xpEarned,
    runs: current.runs + 1,
    kills: current.kills + kills,
    bestScore: Math.max(current.bestScore, score),
    bestWave: Math.max(current.bestWave, wave),
  };
  const levelAfter = positionOf(next.xp).level;

  return {
    record: next,
    reward: {
      xpEarned,
      breakdown: [
        { label: 'SCORE', xp: scoreXp },
        { label: `WAVE ${wave}`, xp: waveXp },
        { label: `${kills} KILLS`, xp: killXp },
      ],
      levelBefore,
      levelAfter,
      unlocked: UNLOCKS.filter(
        (u) => u.level > levelBefore && u.level <= levelAfter,
      ),
      personalBest: score > 0 && score > current.bestScore,
    },
  };
}
