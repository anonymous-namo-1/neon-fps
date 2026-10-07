import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createTestEngine,
  useColliders,
  type TestEngine,
} from './harness';

/** Mirrors the engine's private EYE_HEIGHT / THIRD_PERSON_* constants. */
const EYE_HEIGHT = 1.68;
const THIRD_PERSON_DISTANCE = 3.4;
const THIRD_PERSON_MARGIN = 0.22;

describe('third-person view', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  it('starts in third person so the operator is visible, and V toggles', () => {
    test = createTestEngine();
    expect(test.g.viewMode).toBe('third');
    test.engine.toggleViewMode();
    expect(test.g.viewMode).toBe('first');
    test.engine.toggleViewMode();
    expect(test.g.viewMode).toBe('third');
  });

  it('hangs the camera behind the operator along the aim ray', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    test.engine.setViewMode('third');
    // Yaw/pitch of 0 faces -Z, so "behind" is +Z. resetRun aims the spawn
    // yaw at the arena centre, so pin it explicitly.
    g.yaw = 0;
    g.pitch = 0;
    g.position.set(2, 0, 5);

    g.updateCamera(0, 0);

    expect(g.camera.position.x).toBeCloseTo(2, 5);
    expect(g.camera.position.y).toBeCloseTo(EYE_HEIGHT, 5);
    expect(g.camera.position.z).toBeCloseTo(5 + THIRD_PERSON_DISTANCE, 5);
    // Rotation is untouched, so the camera looks straight back through the
    // eye point and the crosshair ray still passes through the head.
    expect(g.camera.rotation.y).toBeCloseTo(0, 5);
  });

  it('pulls in so a wall never sits between camera and operator', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, [
      new THREE.Box3(
        new THREE.Vector3(-9, 0, 6.5),
        new THREE.Vector3(9, 4, 8),
      ),
    ]);
    g.phase = 'playing';
    test.engine.setViewMode('third');
    g.yaw = 0;
    g.pitch = 0;
    g.position.set(0, 0, 5);

    g.updateCamera(0, 0);

    // Wall face at z=6.5; the camera stops MARGIN short of it instead of
    // sitting at the full follow distance inside the wall.
    expect(g.camera.position.z).toBeCloseTo(6.5 - THIRD_PERSON_MARGIN, 3);
    expect(g.tpDistance).toBeCloseTo(1.5 - THIRD_PERSON_MARGIN, 3);
  });

  it('collapses to the eye instead of crossing a hit inside the margin', () => {
    test = createTestEngine();
    const { g } = test;
    // Wall face only 0.1 behind the eye -- closer than the 0.22 margin.
    useColliders(g, [
      new THREE.Box3(
        new THREE.Vector3(-9, 0, 5.1),
        new THREE.Vector3(9, 4, 7),
      ),
    ]);
    g.phase = 'playing';
    test.engine.setViewMode('third');
    g.yaw = 0;
    g.pitch = 0;
    g.position.set(0, 0, 5);

    g.updateCamera(0, 0);

    expect(g.tpDistance).toBe(0);
    // Camera sits at the eye, never beyond the wall face at 5.1.
    expect(g.camera.position.z).toBeCloseTo(5, 5);
  });

  it('caps distance at the floor without leaving the aim ray', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    test.engine.setViewMode('third');
    g.yaw = 0;
    g.pitch = 1; // looking steeply up: the backward ray dives toward the floor
    g.position.set(0, 0, 5);

    g.updateCamera(0, 0);

    const d = (EYE_HEIGHT - 0.18) / Math.sin(1);
    expect(g.tpDistance).toBeCloseTo(d, 4);
    expect(g.camera.position.y).toBeCloseTo(0.18, 4);
    // Still exactly on the eye ray: x untouched, z = eye + cos(pitch) * d.
    expect(g.camera.position.x).toBeCloseTo(0, 5);
    expect(g.camera.position.z).toBeCloseTo(5 + Math.cos(1) * d, 4);
  });

  it('fires from the operator head instead of the hidden muzzle', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    test.engine.setViewMode('third');
    g.applyLoadout(['plasma', 'pulse']);
    g.swapWeapon('plasma');
    g.yaw = 0;
    g.pitch = 0;
    g.position.set(3, 0, 5);
    g.updateCamera(0, 0);

    g.fire(0);

    expect(g.projectiles.length).toBe(1);
    const p = g.projectiles[0];
    expect(p.position.x).toBeCloseTo(3, 5);
    expect(p.position.y).toBeCloseTo(EYE_HEIGHT, 5);
    expect(p.position.z).toBeCloseTo(5, 5);
  });
});
