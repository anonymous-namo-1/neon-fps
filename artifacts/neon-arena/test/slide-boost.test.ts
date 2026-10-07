import { afterEach, describe, expect, it } from 'vitest';

import { createTestEngine, useColliders, type TestEngine } from './harness';

/**
 * Slide & boost is the alternative movement style. The invariants that matter
 * are that a slide *costs* something (so it cannot be spammed as free speed)
 * and that boost is bounded by its tank rather than by how long a key is held.
 */
describe('slide & boost', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  function runner(): TestEngine {
    const created = createTestEngine();
    const { g } = created;
    useColliders(g, []);
    g.settings = { ...g.settings, movementStyle: 'slide' };
    g.phase = 'playing';
    g.position.set(0, 0, 0);
    g.velocity.set(0, 0, 0);
    g.grounded = true;
    g.yaw = 0;
    return created;
  }

  it('slides on Shift once moving, and the slide beats a plain run', () => {
    test = runner();
    const { g } = test;

    g.keys.add('KeyW');
    for (let i = 0; i < 120; i++) g.updatePlayer(1 / 60);
    const runSpeed = Math.hypot(g.velocity.x, g.velocity.z);
    expect(runSpeed).toBeGreaterThan(5);

    g.position.set(0, 0, 0);
    g.keys.add('ShiftLeft');
    g.updatePlayer(1 / 60);
    expect(g.sliding).toBe(true);

    const slideSpeed = Math.hypot(g.velocity.x, g.velocity.z);
    expect(slideSpeed).toBeGreaterThan(runSpeed * 1.3);
  });

  it('bleeds speed while sliding rather than holding it', () => {
    test = runner();
    const { g } = test;

    g.keys.add('KeyW');
    for (let i = 0; i < 120; i++) g.updatePlayer(1 / 60);
    g.position.set(0, 0, 0);
    g.keys.add('ShiftLeft');
    g.updatePlayer(1 / 60);
    const peak = Math.hypot(g.velocity.x, g.velocity.z);

    for (let i = 0; i < 30; i++) g.updatePlayer(1 / 60);
    const later = Math.hypot(g.velocity.x, g.velocity.z);
    expect(later).toBeLessThan(peak);
  });

  it('will not start a slide from a standstill', () => {
    test = runner();
    const { g } = test;

    g.keys.add('ShiftLeft');
    g.keys.add('KeyW');
    g.updatePlayer(1 / 60);
    expect(g.sliding).toBe(false);
  });

  it('spends boost fuel in the air and refills it on the ground', () => {
    test = runner();
    const { g } = test;

    g.position.set(0, 6, 0);
    g.keys.add('ShiftLeft');
    g.keys.add('KeyW');
    // Held airborne so the tank, not the landing, is what the test measures.
    for (let i = 0; i < 30; i++) {
      g.grounded = false;
      g.updatePlayer(1 / 60);
    }

    expect(g.boostFuel).toBeLessThan(1);
    // Thrust beat gravity: the player is higher than they started.
    expect(g.position.y).toBeGreaterThan(6);

    const spent = g.boostFuel;
    g.keys.clear();
    for (let i = 0; i < 30; i++) {
      g.grounded = true;
      g.updatePlayer(1 / 60);
    }
    expect(g.boostFuel).toBeGreaterThan(spent);
  });

  it('runs out of thrust instead of climbing forever', () => {
    test = runner();
    const { g } = test;

    g.position.set(0, 6, 0);
    g.keys.add('ShiftLeft');
    // Past the tank's capacity, tracking how high the burn ever got.
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      g.grounded = false;
      g.updatePlayer(1 / 60);
      peak = Math.max(peak, g.position.y);
    }

    expect(g.boostFuel).toBe(0);

    // With the tank dry, gravity is winning again.
    for (let i = 0; i < 60; i++) {
      g.grounded = false;
      g.updatePlayer(1 / 60);
    }
    expect(g.position.y).toBeLessThan(peak);
  });

  it('leaves the classic style untouched', () => {
    test = runner();
    const { g } = test;
    g.settings = { ...g.settings, movementStyle: 'classic' };

    g.keys.add('KeyW');
    g.keys.add('ShiftLeft');
    for (let i = 0; i < 60; i++) g.updatePlayer(1 / 60);
    expect(g.sliding).toBe(false);
    expect(g.boostFuel).toBe(1);
  });
});
