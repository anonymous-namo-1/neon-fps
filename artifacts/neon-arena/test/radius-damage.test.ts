import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestEngine,
  spawnEnemy,
  useColliders,
  type EngineInternals,
  type TestEnemy,
  type TestEngine,
} from './harness';

/**
 * Area damage has to decide who it hits *before* it hits anyone.
 *
 * Killing a splitter splices it out of the enemy array and appends three
 * fragments to the end. A blast that walked the live array therefore skipped
 * whichever enemy shifted into the dead one's index -- a shot that visibly
 * engulfed four units but only damaged three -- and could also catch fragments
 * that did not exist when the shot went off.
 *
 * Both radius attacks (plasma splash and the seeker payload) snapshot their
 * targets first. These tests order the array so a naive live walk provably
 * skips a target.
 */

const BLAST = new THREE.Vector3(0, 1, 0);

function damageTaken(enemy: TestEnemy): number {
  return enemy.maxHealth - enemy.health;
}

describe('radius damage target snapshotting', () => {
  let harness: TestEngine;
  let g: EngineInternals;

  beforeEach(() => {
    harness = createTestEngine();
    g = harness.g;
    g.phase = 'playing';
    g.position.set(0, 0, 40);
    useColliders(g);
  });

  afterEach(() => harness.dispose());

  it('plasma splash damages every enemy the blast covered, including the one after a kill', () => {
    // A splitter sits second, so its removal shifts `after` down into the
    // index the iterator has already passed.
    const first = spawnEnemy(g, 'skitter', new THREE.Vector3(-2, 1, 0));
    const splitter = spawnEnemy(g, 'splitter', new THREE.Vector3(0, 1, 0), {
      health: 1,
    });
    const after = spawnEnemy(g, 'skitter', new THREE.Vector3(2, 1, 0));
    const last = spawnEnemy(g, 'skitter', new THREE.Vector3(0, 1, 2));

    g.spawnProjectile({
      origin: BLAST,
      direction: new THREE.Vector3(0, 0, -1),
      speed: 0,
      damage: 6,
      radius: 0.3,
      splash: 6,
      fromPlayer: true,
      charge: 0,
      material: new THREE.MeshBasicMaterial(),
      life: 3,
    });
    const projectile = g.projectiles[0]!;
    projectile.position.copy(BLAST);

    g.detonate(projectile);

    expect(splitter.alive).toBe(false);
    for (const enemy of [first, after, last]) {
      expect(damageTaken(enemy)).toBeGreaterThan(0);
    }

    // The fragments were born by this blast; they must not also be hit by it.
    const fragments = g.enemies.filter((e) => e.generation === 1);
    expect(fragments).toHaveLength(3);
    for (const fragment of fragments) {
      expect(damageTaken(fragment)).toBe(0);
    }
  });

  it('a seeker payload damages every enemy the blast covered, including the one after a kill', () => {
    const seeker = spawnEnemy(g, 'seeker', new THREE.Vector3(0, 1, 0));
    const splitter = spawnEnemy(g, 'splitter', new THREE.Vector3(1.5, 1, 0), {
      health: 1,
    });
    const after = spawnEnemy(g, 'skitter', new THREE.Vector3(-1.5, 1, 0));
    const last = spawnEnemy(g, 'skitter', new THREE.Vector3(0, 1, 2.5));
    g.playerCenter.set(0, 0.98, 40);

    g.seekerDetonate(seeker);

    expect(splitter.alive).toBe(false);
    for (const enemy of [after, last]) {
      expect(enemy.alive).toBe(true);
      expect(damageTaken(enemy)).toBeGreaterThan(0);
    }

    const fragments = g.enemies.filter((e) => e.generation === 1);
    expect(fragments).toHaveLength(3);
    for (const fragment of fragments) {
      expect(damageTaken(fragment)).toBe(0);
    }
  });

  it('splash falls off with distance from the blast', () => {
    const near = spawnEnemy(g, 'skitter', new THREE.Vector3(0.5, 1, 0), {
      health: 1e6,
      maxHealth: 1e6,
    });
    const far = spawnEnemy(g, 'skitter', new THREE.Vector3(5, 1, 0), {
      health: 1e6,
      maxHealth: 1e6,
    });

    g.spawnProjectile({
      origin: BLAST,
      direction: new THREE.Vector3(0, 0, -1),
      speed: 0,
      damage: 100,
      radius: 0.3,
      splash: 6,
      fromPlayer: true,
      charge: 0,
      material: new THREE.MeshBasicMaterial(),
      life: 3,
    });
    const projectile = g.projectiles[0]!;
    projectile.position.copy(BLAST);

    g.detonate(projectile);

    expect(damageTaken(near)).toBeGreaterThan(damageTaken(far));
    expect(damageTaken(far)).toBeGreaterThan(0);
  });

  it('the wave total grows with splitter fragments so remaining never exceeds total', () => {
    g.startWave(1);
    g.waveQueue.length = 0;
    g.waveTotal = 1;
    g.waveKilled = 0;

    const splitter = spawnEnemy(g, 'splitter', new THREE.Vector3(0, 1.2, 0));
    g.killEnemy(splitter);

    const remaining = g.enemies.length + g.waveQueue.length + g.waveKilled;
    expect(g.enemies).toHaveLength(3);
    expect(g.waveTotal).toBe(4);
    expect(remaining).toBeLessThanOrEqual(g.waveTotal);
  });
});
