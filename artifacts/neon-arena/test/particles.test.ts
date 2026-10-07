import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { ParticleField } from '../src/game/particles';

const ORIGIN = new THREE.Vector3(0, 1, 0);

/**
 * The field is the busiest buffer in the game, so the property that matters is
 * that idle time is genuinely idle: live particles stay packed at the front of
 * the buffer, and the draw range collapses the moment they expire. A sparse
 * layout still renders correctly, which is why this needs a test -- the cost
 * shows up as a full-capacity scan and upload every frame instead.
 */
describe('ParticleField', () => {
  it('draws exactly the particles that are alive', () => {
    const field = new ParticleField(64);
    field.burst(ORIGIN, { count: 10, color: 0xffffff, speed: 2, life: 5 });
    field.update(0.016);

    expect(field.points.geometry.drawRange.count).toBe(10);
  });

  it('packs survivors down so old bursts do not widen the scan', () => {
    const field = new ParticleField(64);
    // Short-lived particles first, long-lived ones after them: the survivors
    // start at high slot indices and have to be moved down.
    field.burst(ORIGIN, { count: 12, color: 0xff0000, speed: 2, life: 0.1 });
    field.burst(ORIGIN, { count: 4, color: 0x00ff00, speed: 2, life: 5 });

    field.update(0.05);
    expect(field.points.geometry.drawRange.count).toBe(16);

    field.update(0.3);
    expect(field.points.geometry.drawRange.count).toBe(4);

    // Survivors kept their own data through the compaction: they are green,
    // still moving, and none of the dead red slots leaked into the range.
    const color = field.points.geometry.getAttribute('pColor');
    for (let i = 0; i < 4; i++) {
      expect(color.getX(i)).toBe(0);
      expect(color.getY(i)).toBeGreaterThan(0);
    }
  });

  it('returns to zero work once everything has expired', () => {
    const field = new ParticleField(64);
    field.burst(ORIGIN, { count: 40, color: 0xffffff, speed: 3, life: 0.2 });
    field.update(1);

    expect(field.points.geometry.drawRange.count).toBe(0);

    // And the pool is reusable from the front afterwards.
    field.burst(ORIGIN, { count: 5, color: 0xffffff, speed: 3, life: 5 });
    field.update(0.016);
    expect(field.points.geometry.drawRange.count).toBe(5);
  });

  it('never draws more than its capacity when a burst overflows', () => {
    const field = new ParticleField(16);
    field.burst(ORIGIN, { count: 50, color: 0xffffff, speed: 3, life: 5 });
    field.update(0.016);

    expect(field.points.geometry.drawRange.count).toBe(16);
  });
});
