import { afterEach, describe, expect, it } from 'vitest';

import type { RunConfig } from '@/game/contract';
import { createTestEngine, type TestEngine } from './harness';

/**
 * A run is not allowed to inherit anything from the one before it. These are
 * the leaks that actually shipped once: a won royale made the next death
 * report a victory, and its zone ring stayed hanging over the horde arena.
 */
function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    loadout: ['pulse', 'plasma'],
    modifiers: [],
    mode: 'horde',
    ...overrides,
  } as RunConfig;
}

describe('run reset', () => {
  let harness: TestEngine;

  afterEach(() => harness?.dispose());

  it('does not carry a victory into the next run', () => {
    harness = createTestEngine();
    const { engine, g, snapshots } = harness;

    engine.start(config({ mode: 'duel' }));
    g.finishRun(true);
    expect(snapshots[snapshots.length - 1]!.victory).toBe(true);

    engine.start(config({ mode: 'horde' }));
    expect(g.modeVictory).toBe(false);
    expect(snapshots[snapshots.length - 1]!.victory).toBe(false);
  });

  it('hides the royale zone when the next run is not a royale', () => {
    harness = createTestEngine();
    const { engine, g } = harness;

    engine.start(config({ mode: 'royale' }));
    expect(g.zoneMesh?.visible).toBe(true);

    engine.start(config({ mode: 'horde' }));
    expect(g.zoneMesh?.visible).toBe(false);
  });

  it('refills the boost tank and drops any slide', () => {
    harness = createTestEngine();
    const { engine, g } = harness;

    engine.start(config());
    g.boostFuel = 0.1;
    g.sliding = true;

    engine.start(config());
    expect(g.boostFuel).toBe(1);
    expect(g.sliding).toBe(false);
  });

  it('re-arms the player after a run as a blackout hider', () => {
    harness = createTestEngine();
    const { engine, g } = harness;

    engine.start(config({ mode: 'hunt', huntRole: 'hider' }));
    const disarmed = g.stats.maxHealth > 0 && !harnessArmed(g);
    expect(disarmed).toBe(true);

    engine.start(config({ mode: 'horde' }));
    expect(harnessArmed(g)).toBe(true);
  });

  it('clears a shop trail colour when the next run has none', () => {
    harness = createTestEngine();
    const { engine, g } = harness;

    engine.start(config({ trail: 0xff0000 } as Partial<RunConfig>));
    expect(g.runTrail).toBe(0xff0000);

    engine.start(config());
    expect(g.runTrail).toBe(null);
  });
});

/** `playerArmed` is private; read it through the same cast the harness uses. */
function harnessArmed(g: unknown): boolean {
  return (g as { playerArmed: boolean }).playerArmed;
}
