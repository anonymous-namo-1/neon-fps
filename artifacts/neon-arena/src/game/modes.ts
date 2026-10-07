import type { GameModeId, HuntRole } from './contract';

/**
 * Mode catalogue.
 *
 * A mode is deliberately thin: the simulation (movement, weapons, damage,
 * arena, enemies) is shared by all four, and a mode only decides who the
 * opposition is, what ends the run and what the objective line reads. Keeping
 * that as data -- rather than four forked update loops -- is what stops the
 * engine growing a second copy of itself per mode.
 */
export interface GameModeDef {
  id: GameModeId;
  /** Display name, e.g. "ZOMBIE HORDE". */
  name: string;
  /** One line for the mode card. */
  tagline: string;
  /** The pitch, two sentences at most. */
  blurb: string;
  /** What the player is trying to do, shown on the HUD. */
  objective: string;
  /** Bullet rules for the mode card's detail panel. */
  rules: string[];
  /** CSS accent colour, used for cards and HUD trim. */
  accent: string;
  /** Playable in a two-player room. */
  coop: boolean;
  /** How the second player fits in, for the lobby copy. */
  coopNote: string;
  /** Rough length, for the card footer. */
  duration: string;
}

export const GAME_MODES: GameModeDef[] = [
  {
    id: 'horde',
    name: 'ZOMBIE HORDE',
    tagline: 'Endless waves of infected.',
    blurb:
      'The classic survival run, now against the infected. Each cleared wave pays out an upgrade and the horde comes back bigger.',
    objective: 'Survive the horde',
    rules: [
      'Waves escalate forever -- the run ends when you drop',
      'Pick one of three upgrades after every wave',
      'Headshots on the infected hit their exposed core',
      'Bloaters detonate, so do not let them close',
    ],
    accent: '#9bc53d',
    coop: true,
    coopNote: 'Both operators share the wave and revive on the next one.',
    duration: 'Until you die',
  },
  {
    id: 'royale',
    name: 'NEON ROYALE',
    tagline: 'Seven rivals. One grid. Last one standing.',
    blurb:
      'A solo battle royale against seven rival operators inside a collapsing kill grid. Outside the ring the floor eats your health.',
    objective: 'Be the last operator standing',
    rules: [
      'Seven rival operators drop in with you',
      'The safe grid shrinks every 45 seconds',
      'Outside the grid you take steady damage',
      'Downing a rival drops their ammo and a shield fragment',
    ],
    accent: '#ff4d6d',
    coop: true,
    coopNote: 'You and your friend drop as a duo against six rivals.',
    duration: '5 to 8 minutes',
  },
  {
    id: 'duel',
    name: 'DUEL',
    tagline: 'Best of five, one arena, no upgrades.',
    blurb:
      'A stripped-back 1v1. Even loadouts, no upgrades, no waves -- just aim, movement and nerve across five rounds.',
    objective: 'Win three rounds',
    rules: [
      'First to three round wins takes the match',
      'Health and shield reset at the top of every round',
      'A round has a 60 second clock -- most damage dealt wins it',
      'No upgrades: the loadout you bring is the loadout you keep',
    ],
    accent: '#ffb020',
    coop: true,
    coopNote: 'The other operator is your opponent, not your teammate.',
    duration: '3 to 6 minutes',
  },
  {
    id: 'hunt',
    name: 'BLACKOUT',
    tagline: 'Hide in the dark, or hunt what does.',
    blurb:
      'Arena lights cut out. Hiders have no weapons and one job -- stay unseen until the clock runs out. Seekers have a scanner and a sidearm.',
    objective: 'Stay hidden until the lights come back',
    rules: [
      'Hiders are unarmed and silent, and leave no trail',
      'Seekers get a scanner pulse every 12 seconds',
      'Sprinting, sliding and firing all spike your detection',
      'Hiders win on the clock, seekers win by finding everyone',
    ],
    accent: '#22e0ff',
    coop: true,
    coopNote: 'One operator hides, the other hunts. Sides swap each match.',
    duration: '2 to 4 minutes',
  },
];

export function modeInfo(id: GameModeId): GameModeDef {
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0]!;
}

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** The knobs the engine reads to set a run up. Pure data, no behaviour. */
export interface ModeTuning {
  /** Spawn waves of AI enemies. */
  waves: boolean;
  /** Draw enemies from the infected family instead of the constructs. */
  infected: boolean;
  /** Rival operator bots to spawn at the start. */
  bots: number;
  /** Offer an upgrade choice between waves. */
  upgrades: boolean;
  /** Run a shrinking safe zone. */
  zone: boolean;
  /** Rounds needed to win, 0 when the mode is not round based. */
  roundsToWin: number;
  /** Seconds per round, 0 when there is no round clock. */
  roundSeconds: number;
  /** Match clock in seconds, 0 when the mode has no clock. */
  matchSeconds: number;
  /** Arena light level, 1 is normal. Blackout runs dark. */
  lightLevel: number;
  /** Score multiplier applied to the whole run. */
  scoreMul: number;
  /**
   * Operators can shoot each other. Horde is the co-op mode -- two friends
   * against the infected -- so it is the one mode where a squadmate is not a
   * valid target and shots pass straight through them.
   */
  pvp: boolean;
}

export const MODE_TUNING: Record<GameModeId, ModeTuning> = {
  horde: {
    waves: true,
    infected: true,
    bots: 0,
    upgrades: true,
    zone: false,
    roundsToWin: 0,
    roundSeconds: 0,
    matchSeconds: 0,
    lightLevel: 1,
    scoreMul: 1,
    pvp: false,
  },
  royale: {
    waves: false,
    infected: false,
    bots: 7,
    upgrades: false,
    zone: true,
    roundsToWin: 0,
    roundSeconds: 0,
    matchSeconds: 0,
    lightLevel: 1,
    scoreMul: 1.35,
    pvp: true,
  },
  duel: {
    waves: false,
    infected: false,
    bots: 1,
    upgrades: false,
    zone: false,
    roundsToWin: 3,
    roundSeconds: 60,
    matchSeconds: 0,
    lightLevel: 1,
    scoreMul: 1.2,
    pvp: true,
  },
  hunt: {
    waves: false,
    infected: false,
    bots: 3,
    upgrades: false,
    zone: false,
    roundsToWin: 0,
    roundSeconds: 0,
    matchSeconds: 150,
    lightLevel: 0.22,
    scoreMul: 1.15,
    pvp: true,
  },
};

/** Radius schedule for the Royale grid, in metres, one entry per collapse. */
export const ZONE_STEPS = [46, 34, 24, 16, 10, 6];
/** Seconds between collapses. */
export const ZONE_INTERVAL = 45;
/** Health per second lost outside the grid. */
export const ZONE_DAMAGE = 7;

/** Seconds a Blackout hider gets before the seekers are released. */
export const HUNT_HEADSTART = 15;
/** Seconds between seeker scanner pulses. */
export const HUNT_PULSE_INTERVAL = 12;

/** The objective line for the HUD, given live run state. */
export function objectiveFor(
  mode: GameModeId,
  state: {
    wave: number;
    opponents: number;
    duelScore: { player: number; rival: number };
    huntRole: HuntRole;
    modeTimer: number;
    hidersLeft: number;
  },
): string {
  switch (mode) {
    case 'horde':
      return `WAVE ${state.wave} -- SURVIVE`;
    case 'royale':
      return state.opponents > 0
        ? `${state.opponents} RIVAL${state.opponents === 1 ? '' : 'S'} LEFT`
        : 'LAST ONE STANDING';
    case 'duel':
      return `ROUNDS ${state.duelScore.player} - ${state.duelScore.rival}`;
    case 'hunt':
      return state.huntRole === 'hider'
        ? `STAY HIDDEN -- ${Math.ceil(state.modeTimer)}s`
        : `${state.hidersLeft} HIDER${state.hidersLeft === 1 ? '' : 'S'} LEFT`;
  }
}
