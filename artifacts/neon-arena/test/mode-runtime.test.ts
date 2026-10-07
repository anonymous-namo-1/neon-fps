import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MODE_TUNING, ZONE_STEPS } from '../src/game/modes';
import { ModeRuntime, type ModeHost } from '../src/game/mode-runtime';

/**
 * The rules layer is pure logic over a narrow host, so it can be tested
 * without a renderer, an arena or a frame loop -- which is the whole reason
 * modes live outside the engine.
 */
function fakeHost(overrides: Partial<ModeHost> = {}) {
  const state = {
    operators: 0,
    radius: 0,
    playerDistanceFromCentre: 0,
    nearest: Infinity,
    speed: 0,
    firing: false,
    damage: 0,
    zone: 0,
    light: 1,
    armed: true,
    waves: 0,
    rounds: 0,
    finished: null as boolean | null,
    feed: [] as string[],
  };

  const host: ModeHost = {
    playerRadius: () => state.playerDistanceFromCentre,
    playerSpeed: () => state.speed,
    playerFiring: () => state.firing,
    nearestEnemyDistance: () => state.nearest,
    operatorCount: () => state.operators,
    spawnOperator: () => {
      state.operators += 1;
      return true;
    },
    eliminateRandomOperator: () => {
      if (state.operators <= 0) return false;
      state.operators -= 1;
      return true;
    },
    damagePlayer: (amount) => {
      state.damage += amount;
    },
    announce: () => {},
    feed: (text) => {
      state.feed.push(text);
    },
    finishRun: (victory) => {
      state.finished = victory;
    },
    resetRound: () => {
      state.rounds += 1;
      state.operators = 0;
    },
    setZoneRadius: (radius) => {
      state.zone = radius;
    },
    setLightLevel: (level) => {
      state.light = level;
    },
    setPlayerArmed: (armed) => {
      state.armed = armed;
    },
    startWaveFlow: () => {
      state.waves += 1;
    },
    ...overrides,
  };

  return { host, state };
}

function run(runtime: ModeRuntime, seconds: number, step = 1 / 60): void {
  for (let i = 0; i < Math.round(seconds / step); i++) runtime.tick(step);
}

describe('horde', () => {
  it('hands the run straight to the wave loop', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('horde', 'hider', host);
    runtime.start();

    expect(state.waves).toBe(1);
    expect(runtime.usesWaves).toBe(true);
    expect(runtime.infected).toBe(true);
    expect(state.operators).toBe(0);
  });
});

describe('royale', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('drops the full field and opens on the widest ring', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('royale', 'hider', host);
    runtime.start();

    expect(state.operators).toBe(MODE_TUNING.royale.bots);
    expect(runtime.opponents).toBe(MODE_TUNING.royale.bots);
    expect(state.zone).toBe(ZONE_STEPS[0]);
    expect(state.waves).toBe(0);
  });

  it('counts only the rivals the arena could actually place', () => {
    // A cramped arena can refuse a spawn. Counting the attempts instead of
    // the arrivals leaves a run whose rival counter can never reach zero.
    let attempts = 0;
    const { host, state } = fakeHost({
      spawnOperator: () => {
        attempts += 1;
        if (attempts > 3) return false;
        state.operators += 1;
        return true;
      },
    });
    const runtime = new ModeRuntime('royale', 'hider', host);
    runtime.start();

    expect(attempts).toBe(MODE_TUNING.royale.bots);
    expect(state.operators).toBe(3);
    expect(runtime.opponents).toBe(3);
  });

  // A human counts as an opponent but is not in the operator list, so nothing
  // in the normal attrition path can ever remove them. Left unhandled, a
  // friend closing the tab strands the match one rival short of a win.
  it('backfills a bot when a human rival disconnects', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('royale', 'hider', host, 1);
    runtime.start();

    const before = runtime.opponents;
    runtime.onHumanLeft();

    expect(runtime.opponents).toBe(before);
    expect(state.operators).toBe(MODE_TUNING.royale.bots);
    expect(state.finished).toBeNull();
  });

  it('ends the match when the last human leaves and no bot can replace them', () => {
    let allowSpawn = true;
    const { host, state } = fakeHost({
      spawnOperator: () => {
        if (!allowSpawn) return false;
        state.operators += 1;
        return true;
      },
    });
    // A solo human rival and no room for bots: the whole field is that player.
    const runtime = new ModeRuntime(
      'royale',
      'hider',
      host,
      MODE_TUNING.royale.bots,
    );
    runtime.start();
    expect(runtime.opponents).toBe(MODE_TUNING.royale.bots);

    allowSpawn = false;
    for (let i = 0; i < MODE_TUNING.royale.bots; i++) runtime.onHumanLeft();

    expect(runtime.opponents).toBe(0);
    expect(state.finished).toBe(true);
  });

  it('ignores a disconnect for a room that had no humans in it', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('royale', 'hider', host);
    runtime.start();

    const before = runtime.opponents;
    runtime.onHumanLeft();

    expect(runtime.opponents).toBe(before);
    expect(state.operators).toBe(MODE_TUNING.royale.bots);
  });

  it('hurts the player outside the ring and not inside it', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('royale', 'hider', host);
    runtime.start();

    state.playerDistanceFromCentre = ZONE_STEPS[0]! - 5;
    run(runtime, 1);
    expect(state.damage).toBe(0);

    state.playerDistanceFromCentre = ZONE_STEPS[0]! + 20;
    run(runtime, 1);
    expect(state.damage).toBeGreaterThan(0);
    expect(runtime.outsideZone).toBe(true);
  });

  it('thins the field over time and ends when the last rival falls', () => {
    const { host } = fakeHost();
    const runtime = new ModeRuntime('royale', 'hider', host);
    runtime.start();

    // Long enough for several attrition rolls.
    run(runtime, 200);
    expect(runtime.opponents).toBeLessThan(MODE_TUNING.royale.bots);

    while (runtime.opponents > 0) runtime.onOperatorKilled();
    expect(runtime.victory).toBe(true);
    expect(runtime.finished).toBe(true);
  });
});

describe('duel', () => {
  it('turns a death into a lost round, not a lost run', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('duel', 'hider', host);
    runtime.start();

    expect(runtime.onPlayerDied()).toBe('round');
    expect(runtime.duelScore.rival).toBe(1);
    expect(runtime.duelRound).toBe(2);
    expect(state.rounds).toBe(1);
    expect(runtime.finished).toBe(false);
  });

  it('ends the match on the third round win', () => {
    const { host } = fakeHost();
    const runtime = new ModeRuntime('duel', 'hider', host);
    runtime.start();

    runtime.onOperatorKilled();
    // The engine only ticks a mode between rounds, so skip the intro pause.
    run(runtime, 3);
    runtime.onOperatorKilled();
    run(runtime, 3);
    runtime.onOperatorKilled();

    expect(runtime.duelScore.player).toBe(MODE_TUNING.duel.roundsToWin);
    expect(runtime.victory).toBe(true);
  });

  it('gives an expired round to the rival', () => {
    const { host } = fakeHost();
    const runtime = new ModeRuntime('duel', 'hider', host);
    runtime.start();

    run(runtime, MODE_TUNING.duel.roundSeconds + 1);
    expect(runtime.duelScore.rival).toBe(1);
  });
});

describe('blackout', () => {
  it('takes the hider\'s weapon and dims the arena', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('hunt', 'hider', host);
    runtime.start();

    expect(state.armed).toBe(false);
    expect(state.light).toBeLessThan(1);
    // The hunters are not out yet.
    expect(state.operators).toBe(0);
  });

  it('arms the seeker and spawns the hiders immediately', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('hunt', 'seeker', host);
    runtime.start();

    expect(state.armed).toBe(true);
    expect(state.operators).toBe(MODE_TUNING.hunt.bots);
  });

  it('builds detection from proximity and noise, and decays it', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('hunt', 'hider', host);
    runtime.start();

    // Close enough and loud enough to be noticed, but short of being seen --
    // saturating the meter would end the match and stop the ticks.
    state.nearest = 10;
    state.speed = 6;
    run(runtime, 1.5);
    const spotted = runtime.detection;
    expect(spotted).toBeGreaterThan(0);
    expect(spotted).toBeLessThan(1);

    state.nearest = Infinity;
    state.speed = 0;
    run(runtime, 2);
    expect(runtime.detection).toBeLessThan(spotted);
  });

  it('loses the match when detection tops out', () => {
    const { host, state } = fakeHost();
    const runtime = new ModeRuntime('hunt', 'hider', host);
    runtime.start();

    state.nearest = 1;
    state.speed = 12;
    state.firing = true;
    run(runtime, 30);

    expect(runtime.finished).toBe(true);
    expect(runtime.victory).toBe(false);
  });

  it('wins by outlasting the clock', () => {
    const { host } = fakeHost();
    const runtime = new ModeRuntime('hunt', 'hider', host);
    runtime.start();

    run(runtime, MODE_TUNING.hunt.matchSeconds + 1, 0.25);
    expect(runtime.victory).toBe(true);
  });
});
