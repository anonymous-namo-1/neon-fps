/**
 * The scene's light count must never change while a run is live.
 *
 * Three.js bakes the number of lights into every material's shader program,
 * so adding or removing one recompiles the whole scene. Giving each enemy and
 * projectile its own light meant every wave spawn triggered that recompile --
 * a visible freeze at the exact moment the game got busy. A fixed pool is the
 * fix, and this test is what keeps it fixed.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestEngine, spawnEnemy, type TestEngine } from './harness';
import { DEFAULT_SETTINGS } from '@/game/contract';

let harness: TestEngine | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

function countLights(scene: THREE.Scene): number {
  let total = 0;
  scene.traverse((object) => {
    if ((object as THREE.Light).isLight) total += 1;
  });
  return total;
}

describe('dynamic light pool', () => {
  it('holds the light count steady across spawns, shots and kills', () => {
    harness = createTestEngine();
    const { g, engine } = harness;

    const baseline = countLights(g.scene);

    for (let i = 0; i < 16; i++) {
      spawnEnemy(g, 'skitter', new THREE.Vector3(i * 2 - 16, 0.9, -12));
    }
    expect(countLights(g.scene)).toBe(baseline);

    engine.setViewMode('first');
    g.applyLoadout(['plasma']);
    for (let i = 0; i < 6; i++) {
      g.fire(1);
      g.simulate(1 / 60);
    }
    expect(g.projectiles.length).toBeGreaterThan(0);
    expect(countLights(g.scene)).toBe(baseline);

    g.present(1 / 60, 0);
    expect(countLights(g.scene)).toBe(baseline);

    g.enemies.forEach((enemy) => g.killEnemy(enemy));
    for (let i = 0; i < 30; i++) g.simulate(1 / 60);
    g.present(1 / 60, 0);
    expect(countLights(g.scene)).toBe(baseline);
  });

  it('points its brightest slot at the nearest emitter', () => {
    harness = createTestEngine();
    const { g } = harness;

    const near = spawnEnemy(g, 'skitter', new THREE.Vector3(0, 0.9, -4));
    spawnEnemy(g, 'skitter', new THREE.Vector3(0, 0.9, -60));
    g.enemies.forEach((enemy) => {
      enemy.visual.group.position.copy(enemy.position);
    });

    g.present(1 / 60, 0);

    const lit: THREE.PointLight[] = [];
    g.scene.traverse((object) => {
      const light = object as THREE.PointLight;
      if (light.isPointLight && light.intensity > 0) lit.push(light);
    });

    expect(lit.length).toBeGreaterThan(0);
    const closest = lit.reduce((best, light) =>
      light.position.distanceTo(near.position) <
      best.position.distanceTo(near.position)
        ? light
        : best,
    );
    expect(closest.position.distanceTo(near.position)).toBeLessThan(0.001);
  });

  it('resizes only when the quality tier changes', () => {
    harness = createTestEngine();
    const { g, engine } = harness;

    const high = countLights(g.scene);
    engine.applySettings({ ...DEFAULT_SETTINGS, quality: 'low' });
    const low = countLights(g.scene);
    expect(low).toBeLessThan(high);

    // Same tier again: no rebuild, so no recompile.
    engine.applySettings({ ...DEFAULT_SETTINGS, quality: 'low', volume: 0.5 });
    expect(countLights(g.scene)).toBe(low);
  });
});
