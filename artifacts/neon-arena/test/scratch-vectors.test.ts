import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import { ENEMY_CONFIG } from '@/game/enemies';

import {
  createTestEngine,
  spawnEnemy,
  useColliders,
  type EngineInternals,
  type TestEngine,
} from './harness';

/**
 * The engine reuses a small pool of scratch vectors (`v1`-`v4`) across the
 * whole simulation to keep the per-frame allocation count at zero. That is
 * fine until a helper called from the middle of another routine borrows a
 * vector the caller is still holding.
 *
 * Two real bugs of exactly this shape have already shipped and been fixed:
 *
 *   - the brute's ground slam wrote its knockback direction into `v4`, which
 *     at that moment was the enemy AI's desired-velocity accumulator, so every
 *     brute that slammed also gave itself a steering impulse;
 *   - the line-of-sight probe borrowed `v3`/`v4` while the AI switch was
 *     holding the flattened player direction and the desired velocity in them.
 *
 * Neither produced an error, a warning, or anything visible in a screenshot.
 * These tests pin both the contract (dedicated vectors stay dedicated) and the
 * behaviour it protects (steering stays analytically correct).
 */

const DT = 1 / 60;

/** A single tall block that the probe rays cross, so the LOS loop does work. */
function farWall(): THREE.Box3[] {
  return [
    new THREE.Box3(
      new THREE.Vector3(-24, -2, -12),
      new THREE.Vector3(24, 12, -8),
    ),
  ];
}

describe('shared scratch vectors', () => {
  let harness: TestEngine | null = null;

  const engine = (): EngineInternals => {
    harness = createTestEngine();
    const g = harness.g;
    g.phase = 'playing';
    g.position.set(0, 0, 0);
    return g;
  };

  afterEach(() => {
    harness?.dispose();
    harness = null;
  });

  it('bruteSlam leaves the desired-velocity accumulator alone', () => {
    const g = engine();
    const brute = spawnEnemy(g, 'brute', new THREE.Vector3(0, 1.5, 4));

    g.v4.set(3, 4, 5);
    g.bruteSlam(brute, g.playerCenter.set(0, 0.98, 0));

    // The slam has to have actually landed, or the assertion below is vacuous.
    expect(g.velocity.lengthSq()).toBeGreaterThan(0);
    expect(g.v4.toArray()).toEqual([3, 4, 5]);
  });

  it('a slamming brute does not steer itself with its own knockback', () => {
    // Differential: the only difference between the runs is whether the
    // telegraph expires this step, i.e. whether the slam fires at all. With
    // the telegraph up the AI leaves `desired` at zero either way, so both
    // runs must produce the same (zero) velocity.
    const step = (slamThisStep: boolean): THREE.Vector3 => {
      const g = engine();
      const brute = spawnEnemy(g, 'brute', new THREE.Vector3(0, 1.5, 4), {
        // 9 is the slam radius; the player at the origin is well inside it.
        telegraph: slamThisStep ? DT / 2 : 1,
      });
      g.updateEnemies(DT, DT);
      const velocity = brute.velocity.clone();
      harness?.dispose();
      harness = null;
      return velocity;
    };

    const slammed = step(true);
    const held = step(false);

    expect(held.length()).toBeLessThan(1e-9);
    expect(slammed.distanceTo(held)).toBeLessThan(1e-9);
  });

  it('hasLineOfSight leaves v3 and v4 alone', () => {
    const g = engine();
    useColliders(g, farWall());

    g.v3.set(1, 2, 3);
    g.v4.set(4, 5, 6);
    const visible = g.hasLineOfSight(
      new THREE.Vector3(0, 3.6, 15),
      new THREE.Vector3(0, 0.98, 0),
    );

    expect(visible).toBe(true);
    expect(g.v3.toArray()).toEqual([1, 2, 3]);
    expect(g.v4.toArray()).toEqual([4, 5, 6]);
  });

  it('a spectre orbits on exactly the velocity its AI asked for', () => {
    const g = engine();
    // The wall sits beyond the player, so the ray reaches it -- the probe
    // writes its hit point -- but sight is not blocked.
    useColliders(g, farWall());

    const spectre = spawnEnemy(g, 'spectre', new THREE.Vector3(0, 3.6, 15), {
      strafeSign: 1,
    });

    g.updateEnemies(DT, DT);

    // Closed form for this setup: 15m out is inside the 22m leash and outside
    // the 11m standoff, so the approach/retreat term is zero and only the
    // orbit term survives. `flat` is (0, 0, -1), so the orbit pushes +x.
    const speed =
      ENEMY_CONFIG.spectre.speed * (1 + Math.min(0.35, g.wave * 0.02));
    const expected = new THREE.Vector3(speed * 0.95, 0, 0).multiplyScalar(
      Math.min(1, DT * 6),
    );

    expect(spectre.velocity.x).toBeCloseTo(expected.x, 10);
    expect(spectre.velocity.y).toBeCloseTo(0, 10);
    expect(spectre.velocity.z).toBeCloseTo(0, 10);
  });

  it('killing a splitter mid-pass does not move the player anchor', () => {
    // `killEnemy` spawns the three fragments through `v1`/`v2`. The enemy AI
    // holds the player's centre for the whole pass, so that anchor lives in a
    // dedicated vector -- if it ever shared v1, every enemy processed after a
    // fragmentation would steer at a splitter shard's spawn point instead.
    const g = engine();
    const splitter = spawnEnemy(g, 'splitter', new THREE.Vector3(6, 1.2, 6));
    const anchor = new THREE.Vector3(7, 1, -3);
    g.playerCenter.copy(anchor);

    g.killEnemy(splitter);

    expect(g.enemies.filter((e) => e.generation === 1)).toHaveLength(3);
    expect(g.playerCenter.toArray()).toEqual(anchor.toArray());
  });

  it('a seeker blast that fragments a splitter does not move the player anchor', () => {
    const g = engine();
    const seeker = spawnEnemy(g, 'seeker', new THREE.Vector3(0, 1.7, 10));
    spawnEnemy(g, 'splitter', new THREE.Vector3(2, 1.2, 10), { health: 1 });
    const anchor = new THREE.Vector3(7, 1, -3);
    g.playerCenter.copy(anchor);

    g.seekerDetonate(seeker);

    expect(seeker.alive).toBe(false);
    expect(g.enemies.filter((e) => e.generation === 1)).toHaveLength(3);
    expect(g.playerCenter.toArray()).toEqual(anchor.toArray());
  });
});
