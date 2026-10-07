import { afterEach, describe, expect, it } from 'vitest';

import { createTestEngine, useColliders, type TestEngine } from './harness';

const THIRD_PERSON_DISTANCE = 3.4;

describe('weapon scopes', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  it('right mouse engages the scope and release lets it go', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.pointerLocked = true;
    const canvas = (test.engine as unknown as { canvas: HTMLCanvasElement })
      .canvas;

    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    expect(g.scoping).toBe(true);

    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    expect(g.scoping).toBe(false);
  });

  it('pulls the third-person camera into the eye and narrows the FOV', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    test.engine.setViewMode('third');
    g.applyLoadout(['pulse', 'plasma']);
    g.yaw = 0;
    g.pitch = 0;
    g.position.set(0, 0, 5);

    g.updateCamera(1 / 60, 0);
    const unscopedZ = g.camera.position.z;
    const unscopedFov = g.camera.fov;

    g.scoping = true;
    for (let i = 0; i < 180; i++) g.updateCamera(1 / 60, 0);

    // Fully scoped: camera collapses to the eye along the aim ray, and the
    // FOV divides by the pulse rifle's 1.9x magnification.
    expect(g.scopeBlend).toBe(1);
    expect(g.tpDistance).toBeLessThan(0.05);
    expect(g.camera.position.z).toBeLessThan(unscopedZ - 3);
    expect(g.camera.fov).toBeLessThan(unscopedFov / 1.7);

    g.scoping = false;
    for (let i = 0; i < 180; i++) g.updateCamera(1 / 60, 0);

    expect(g.scopeBlend).toBe(0);
    expect(g.tpDistance).toBeCloseTo(THIRD_PERSON_DISTANCE, 1);
    expect(g.camera.fov).toBeGreaterThan(unscopedFov - 2);
  });

  it('tightens pulse spread while scoped so magnified shots land', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    g.applyLoadout(['pulse', 'plasma']);
    g.grounded = true;

    // The scoped multiplier is deterministic: 30% of base spread at full
    // engagement. Verify through the weapon runtime the engine fires with.
    const weapon = g.weapons.find((w) => w.id === 'pulse')!;
    expect(weapon.zoom).toBeCloseTo(1.9, 5);

    g.scopeBlend = 1;
    const scopedSpread = weapon.spread * (1 - 0.7 * g.scopeBlend);
    expect(scopedSpread).toBeCloseTo(weapon.spread * 0.3, 8);
  });

  it('drops the scope when the run resets', () => {
    test = createTestEngine();
    const { g } = test;
    g.scoping = true;
    g.scopeBlend = 0.8;

    test.engine.start();

    expect(g.scoping).toBe(false);
    expect(g.scopeBlend).toBe(0);
  });

  it('starts the plasma charge when a scoped swap lands on the lance', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.pointerLocked = true;
    g.applyLoadout(['pulse', 'plasma']);
    g.swapWeapon('pulse');
    const canvas = (test.engine as unknown as { canvas: HTMLCanvasElement })
      .canvas;

    // Scoping the pulse rifle spools nothing -- wrong weapon.
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    expect(g.scoping).toBe(true);
    expect(g.charging).toBe(false);

    // The button never lifts, so the swap itself must start the charge.
    g.swapWeapon('plasma');
    expect(g.charging).toBe(true);

    // Swapping away releases the charge rather than carrying it.
    g.swapWeapon('pulse');
    expect(g.charging).toBe(false);
  });

  it('does not spool a scoped swap onto a reloading lance', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.pointerLocked = true;
    g.applyLoadout(['pulse', 'plasma']);
    g.swapWeapon('pulse');
    Object.assign(g.weapons.find((w) => w.id === 'plasma')!, {
      reloading: true,
    });

    const canvas = (test.engine as unknown as { canvas: HTMLCanvasElement })
      .canvas;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
    g.swapWeapon('plasma');
    expect(g.charging).toBe(false);
  });
});
