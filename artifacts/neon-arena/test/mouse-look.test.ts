import { afterEach, describe, expect, it } from 'vitest';

import { createTestEngine, type TestEngine } from './harness';

describe('vertical mouse look', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  it('looks up when the mouse moves up with normal Y look', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.pointerLocked = true;
    g.pitch = 0;
    g.settings.invertY = false;

    g.onMouseMove(new MouseEvent('mousemove', { movementY: -20 }));

    expect(g.pitch).toBeLessThan(0);
  });

  it('keeps the optional inverted-Y setting working', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.pointerLocked = true;
    g.pitch = 0;
    test.engine.applySettings({ ...g.settings, invertY: true });
    expect(g.settings.invertY).toBe(true);

    g.onMouseMove(new MouseEvent('mousemove', { movementY: -20 }));

    expect(g.pitch).toBeGreaterThan(0);
  });
});