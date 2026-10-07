import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createTestEngine,
  useColliders,
  type TestEngine,
} from './harness';

/**
 * The strafe basis shipped inverted once, with A and D swapped. The oracle
 * has to come from somewhere other than the movement code, or it just
 * restates the bug: screen-right is `aim x up`, and the aim direction is
 * taken from the camera the player is actually looking through.
 */
function aimBasis(g: {
  camera: THREE.PerspectiveCamera;
  updateCamera: (dt: number, alpha?: number) => void;
}) {
  g.updateCamera(0);
  const aim = g.camera
    .getWorldDirection(new THREE.Vector3())
    .setY(0)
    .normalize();
  return { aim, right: aim.clone().cross(new THREE.Vector3(0, 1, 0)).normalize() };
}

describe('strafe direction', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  // Every yaw quadrant, so a sign error that cancels out at yaw 0 cannot hide.
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7])(
    'sends D toward screen-right and A away from it at yaw %f',
    (yaw) => {
      test = createTestEngine();
      const { g } = test;
      useColliders(g, []);
      g.yaw = yaw;
      g.pitch = 0;
      g.position.set(0, 0, 0);
      g.prevPlayerPosition.set(0, 0, 0);
      g.renderPosition.set(0, 0, 0);

      const { right } = aimBasis(g);

      const stepFrom = (key: string) => {
        g.position.set(0, 0, 0);
        g.velocity.set(0, 0, 0);
        g.grounded = true;
        g.wasGrounded = true;
        g.keys.clear();
        g.keys.add(key);
        for (let i = 0; i < 6; i += 1) g.updatePlayer(1 / 60);
        return new THREE.Vector3(g.position.x, 0, g.position.z);
      };

      const wentRight = stepFrom('KeyD');
      const wentLeft = stepFrom('KeyA');

      expect(right.length()).toBeCloseTo(1, 5);
      expect(wentRight.length()).toBeGreaterThan(0.05);
      expect(wentRight.clone().normalize().dot(right)).toBeCloseTo(1, 2);
      expect(wentLeft.clone().normalize().dot(right)).toBeCloseTo(-1, 2);
    },
  );

  it('keeps W along the aim direction rather than the strafe axis', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.yaw = 0.9;
    g.pitch = 0;
    g.position.set(0, 0, 0);
    g.prevPlayerPosition.set(0, 0, 0);
    g.renderPosition.set(0, 0, 0);

    const { aim } = aimBasis(g);

    g.velocity.set(0, 0, 0);
    g.grounded = true;
    g.wasGrounded = true;
    g.keys.add('KeyW');
    for (let i = 0; i < 6; i += 1) g.updatePlayer(1 / 60);

    const moved = new THREE.Vector3(g.position.x, 0, g.position.z).normalize();
    expect(moved.dot(aim)).toBeCloseTo(1, 2);
  });
});

describe('player movement responsiveness', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  it('finishes horizontal travel after landing on a ledge edge', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, [
      new THREE.Box3(
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(2, 0.75, 1),
      ),
    ]);
    g.position.set(-0.45, 0.8, 0);
    g.velocity.set(6, -6, 0);
    g.grounded = false;
    g.wasGrounded = false;

    g.updatePlayer(1 / 60);

    expect(g.grounded).toBe(true);
    expect(g.position.y).toBeCloseTo(0.75, 5);
    expect(g.position.x).toBeGreaterThan(-0.4);
  });

  it('renders the local camera at current state instead of one tick behind', () => {
    test = createTestEngine();
    const { g } = test;
    g.prevPlayerPosition.set(0, 0, 0);
    g.position.set(10, 2, -4);

    g.updateCamera(0);

    expect(g.renderPosition.toArray()).toEqual([10, 2, -4]);
    expect(g.camera.position.x).toBe(10);
    expect(g.camera.position.z).toBe(-4);
  });

  it('looks ahead by the unconsumed sim time while playing', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    g.position.set(10, 2, -4);
    g.velocity.set(6, 0, 3);

    g.updateCamera(0, 0.5);

    // Half of a 1/60 step at full timescale = 1/120s of velocity.
    expect(g.renderPosition.x).toBeCloseTo(10 + 6 / 120, 5);
    expect(g.renderPosition.z).toBeCloseTo(-4 + 3 / 120, 5);
  });

  it('does not look ahead into a wall the player has not hit yet', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, [
      new THREE.Box3(
        new THREE.Vector3(10.44, 0, -9),
        new THREE.Vector3(12, 4, 9),
      ),
    ]);
    g.phase = 'playing';
    // Player box ends at x=10.42, a hair short of the wall face at 10.44.
    g.position.set(10, 0, 0);
    // Dash speed straight at the wall: velocity has not been zeroed yet
    // because the simulation has not processed the impact.
    g.velocity.set(19, 0, 0);

    g.updateCamera(0, 1);

    expect(g.renderPosition.x).toBe(10);
  });

  it('still looks ahead while sliding along resting contact', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, [
      new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 2, 9)),
    ]);
    g.phase = 'playing';
    // Standing exactly on the slab: touching, but not colliding.
    g.position.set(0, 2, 0);
    g.velocity.set(6, 0, 0);

    g.updateCamera(0, 0.5);

    expect(g.renderPosition.x).toBeCloseTo(6 / 120, 5);
  });

  it('caps the look-ahead below the player box so it can never tunnel', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    g.position.set(10, 2, -4);
    // Absurd speed: raw look-ahead would be 10 units in one step.
    g.velocity.set(600, 0, 0);

    g.updateCamera(0, 1);

    // Clamped to 2 * PLAYER_RADIUS - 0.04 = 0.8 per axis.
    expect(g.renderPosition.x).toBeCloseTo(10.8, 5);
  });

  it('does not look ahead while paused', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'paused';
    g.position.set(5, 1, 0);
    g.velocity.set(6, 0, 0);

    g.updateCamera(0, 0.9);

    expect(g.renderPosition.toArray()).toEqual([5, 1, 0]);
  });
});
describe('sprint and dash bindings', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  it('holds Shift to sprint: forward speed rises by the sprint multiplier', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    // Shift is the sprint only in the classic style; the default style gives
    // that key to the slide instead.
    g.settings = { ...g.settings, movementStyle: 'classic' };
    g.phase = 'playing';
    g.position.set(0, 0, 0);
    g.velocity.set(0, 0, 0);
    g.grounded = true;
    g.yaw = 0;

    g.keys.add('KeyW');
    for (let i = 0; i < 120; i++) g.updatePlayer(1 / 60);
    const baseSpeed = Math.hypot(g.velocity.x, g.velocity.z);

    // Re-centre between phases: a long straight run parks the player against
    // the arena's outer bounds, where the clamp reads as zero velocity.
    g.position.set(0, 0, 0);
    g.keys.add('ShiftLeft');
    for (let i = 0; i < 120; i++) g.updatePlayer(1 / 60);
    const sprintSpeed = Math.hypot(g.velocity.x, g.velocity.z);

    expect(baseSpeed).toBeGreaterThan(5);
    expect(sprintSpeed / baseSpeed).toBeGreaterThan(1.25);
    expect(sprintSpeed / baseSpeed).toBeLessThan(1.45);

    // Shift without forward input is not a sprint.
    g.keys.clear();
    g.keys.add('ShiftLeft');
    g.keys.add('KeyD');
    g.position.set(0, 0, 0);
    g.velocity.set(0, 0, 0);
    for (let i = 0; i < 120; i++) g.updatePlayer(1 / 60);
    const strafeSpeed = Math.hypot(g.velocity.x, g.velocity.z);
    expect(strafeSpeed).toBeLessThan(baseSpeed * 1.1);
  });

  it('dashes on Q, and Shift no longer dashes', () => {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.phase = 'playing';
    g.grounded = true;
    g.keys.add('KeyW');

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    expect(g.dashTimer).toBe(0);
    expect(g.dashCharges).toBe(2);

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    expect(g.dashTimer).toBeGreaterThan(0);
    expect(g.dashCharges).toBe(1);
  });
});
