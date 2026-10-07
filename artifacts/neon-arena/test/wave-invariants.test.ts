import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import { ARENAS } from '@/game/arena';

import {
  createTestEngine,
  seedRandom,
  type EngineInternals,
  type TestEngine,
} from './harness';

/**
 * Runs real waves headlessly on every map and asserts the world stays sane.
 *
 * Enemy placement is the product of steering, separation, arena clamping, wall
 * pushout and surface tracking, all interacting. Nothing in that chain throws
 * when it goes wrong -- a unit welded inside a pillar or drifting past the
 * wall just stops being reachable, and the wave never ends. This is the check
 * that turns those into failures.
 *
 * The player is held invulnerable and does not shoot: this is a test of the
 * enemy simulation, and a dead player would stop the wave two seconds in.
 */

const DT = 1 / 60;
const WAVES = [1, 5, 9];
const SEEDS = [0x5eed, 0x1d0d, 0xb0a7];
const STEPS_PER_WAVE = 420;

/**
 * The engine's own definition of a wall.
 *
 * Pushout deliberately ignores any box shorter than the player's ceiling --
 * those are the ledges and crates units are meant to stand on top of. A plain
 * AABB overlap test flags every enemy resting on cover as embedded, so this
 * check has to apply the same predicate the engine does.
 */
function wallsOf(g: EngineInternals): THREE.Box3[] {
  const ceiling = g.position.y + 5;
  return g.arena.colliders.filter((box) => box.max.y > ceiling);
}

function expectSaneEnemies(g: EngineInternals, where: string): void {
  const walls = wallsOf(g);
  const half = g.arena.half;

  for (const enemy of g.enemies) {
    const { x, y, z } = enemy.position;
    const label = `${enemy.config.kind} at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} (${where})`;

    expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), label).toBe(true);
    expect(
      Number.isFinite(enemy.velocity.x) &&
        Number.isFinite(enemy.velocity.y) &&
        Number.isFinite(enemy.velocity.z),
      label,
    ).toBe(true);
    expect(Number.isFinite(enemy.health), label).toBe(true);
    expect(enemy.health, label).toBeGreaterThan(0);

    // Inside the room.
    expect(Math.abs(x), label).toBeLessThanOrEqual(half);
    expect(Math.abs(z), label).toBeLessThanOrEqual(half);

    // Above the floor.
    expect(y, label).toBeGreaterThanOrEqual(0);

    // Out of every solid wall. A hair of slack: pushout parks a unit exactly
    // on the face it was ejected through.
    const slack = 1e-3;
    for (const box of walls) {
      if (y > box.max.y + enemy.radius) continue;
      const embedded =
        x > box.min.x - enemy.radius + slack &&
        x < box.max.x + enemy.radius - slack &&
        z > box.min.z - enemy.radius + slack &&
        z < box.max.z + enemy.radius - slack;
      expect(embedded, `${label} embedded in wall`).toBe(false);
    }
  }

  // The HUD reads "remaining / total"; fragments that grow the roster without
  // growing the total made it count past its own maximum.
  const remaining = g.enemies.length + g.waveQueue.length;
  expect(remaining + g.waveKilled, where).toBeLessThanOrEqual(g.waveTotal);
}

/**
 * Empties the arena the way clearing a wave does.
 *
 * A wave only ever begins on an empty floor, and `startWave` resets the wave
 * total accordingly -- so a test that jumps straight to a later wave has to
 * clear the survivors first or it invents a bug the game cannot reach.
 */
function clearArena(g: EngineInternals): void {
  for (let guard = 0; guard < 32 && g.enemies.length > 0; guard++) {
    for (const enemy of [...g.enemies]) g.killEnemy(enemy, false);
  }
  g.waveQueue.length = 0;
  expect(g.enemies).toHaveLength(0);
}

describe('wave invariants', () => {
  let harness: TestEngine | null = null;
  let restoreRandom: (() => void) | null = null;

  afterEach(() => {
    harness?.dispose();
    harness = null;
    restoreRandom?.();
    restoreRandom = null;
  });

  for (const meta of ARENAS) {
    it(`keeps every enemy in the world across waves on ${meta.id}`, () => {
      for (const seed of SEEDS) {
        restoreRandom = seedRandom(seed);
        harness = createTestEngine(meta.id);
        const g = harness.g;

        harness.engine.start();

        let sawEnemies = false;

        for (const wave of WAVES) {
          clearArena(g);
          g.phase = 'playing';
          // The countdown would otherwise restart a wave of its own choosing
          // partway through this one.
          g.waveCountdown = 0;
          g.startWave(wave);

          for (let step = 0; step < STEPS_PER_WAVE; step++) {
            // The enemies are the subject; an invulnerable player keeps the
            // wave running long enough to observe them.
            g.iframes = 1;
            g.simulate(DT);

            if (g.enemies.length > 0) sawEnemies = true;
            if (step % 4 === 0) {
              const at = `${meta.id} seed ${seed} wave ${wave} step ${step}`;
              expectSaneEnemies(g, at);
            }
            if (g.phase !== 'playing') break;
          }

          expectSaneEnemies(g, `${meta.id} seed ${seed} wave ${wave} end`);
        }

        // Guards against the whole run silently spawning nothing.
        expect(sawEnemies).toBe(true);

        harness.dispose();
        harness = null;
        restoreRandom();
        restoreRandom = null;
      }
    });
  }

  it('spawns nobody inside the map geometry', () => {
    restoreRandom = seedRandom(31337);
    harness = createTestEngine();
    const g = harness.g;

    harness.engine.start();
    g.waveCountdown = 0;
    g.startWave(7);

    for (let step = 0; step < 600; step++) {
      g.iframes = 1;
      g.simulate(DT);
      if (g.phase !== 'playing') break;

      // Check units while they are still scaling in, before pushout has had a
      // chance to tidy up after a bad spawn point.
      for (const enemy of g.enemies) {
        if (enemy.spawnTimer <= 0) continue;
        for (const box of wallsOf(g)) {
          const inside =
            enemy.position.x > box.min.x - enemy.radius &&
            enemy.position.x < box.max.x + enemy.radius &&
            enemy.position.z > box.min.z - enemy.radius &&
            enemy.position.z < box.max.z + enemy.radius &&
            enemy.position.y < box.max.y + enemy.radius;
          expect(inside, `${enemy.config.kind} spawned inside geometry`).toBe(
            false,
          );
        }
      }
    }
  });
});
