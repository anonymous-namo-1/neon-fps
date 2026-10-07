import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildZombieVisual,
  disposeZombieGeometry,
  ZOMBIE_CONFIG,
  type ZombieKind,
} from '../src/game/zombies';

const KINDS = Object.keys(ZOMBIE_CONFIG) as ZombieKind[];

afterEach(() => disposeZombieGeometry());

describe('zombie visuals', () => {
  it.each(KINDS)('builds a runtime-compatible %s', (kind) => {
    const visual = buildZombieVisual(kind);

    expect(visual.group).toBeInstanceOf(THREE.Group);
    expect(visual.shell).toBeInstanceOf(THREE.Mesh);
    expect(visual.wire).toBeInstanceOf(THREE.Mesh);
    expect(visual.core).toBeInstanceOf(THREE.Mesh);
    expect(visual.core.name).toBe('head');
    expect(visual.group.getObjectByName('head')).toBe(visual.core);
    // Runtime orbiter animation would turn articulated body parts into debris.
    expect(visual.orbiters).toEqual([]);
    expect(visual.shield).toBeNull();
    expect(visual.shieldMaterial).toBeNull();

    visual.dispose();
  });

  it.each(KINDS)('keeps the %s palette below the bloom washout limits', (kind) => {
    const visual = buildZombieVisual(kind);
    const standardMaterials = new Set<THREE.MeshStandardMaterial>();

    visual.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) {
          standardMaterials.add(material);
        }
      }
    });

    // Rot should look matte and organic under ACES rather than chrome-white.
    expect(standardMaterials.size).toBeGreaterThan(0);
    for (const material of standardMaterials) {
      expect(material.metalness).toBeLessThanOrEqual(0.3);
      expect(material.emissiveIntensity).toBeLessThanOrEqual(1.2);
    }
    expect(visual.shellMaterial).toBeInstanceOf(THREE.MeshStandardMaterial);
    visual.dispose();
  });

  it.each(KINDS)('plants the %s feet at its zero-hover origin', (kind) => {
    const visual = buildZombieVisual(kind);
    const bounds = new THREE.Box3().setFromObject(visual.group);

    expect(ZOMBIE_CONFIG[kind].hover).toBe(0);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.06);
    expect(bounds.min.y).toBeLessThan(0.06);
    visual.dispose();
  });

  it.each(KINDS)('articulates the %s without changing its scene graph', (kind) => {
    const visual = buildZombieVisual(kind);
    const leg = visual.group.getObjectByName('leg-left');
    const arm = visual.group.getObjectByName('arm-right');
    const descendants: THREE.Object3D[] = [];
    visual.group.traverse((node) => descendants.push(node));
    const beforeLeg = leg?.rotation.x ?? 0;
    const beforeArm = arm?.rotation.x ?? 0;

    for (let i = 0; i < 90; i++) visual.animate(1 / 60, 5, 0.37);

    const after: THREE.Object3D[] = [];
    visual.group.traverse((node) => after.push(node));
    expect(leg?.rotation.x).not.toBeCloseTo(beforeLeg, 4);
    expect(arm?.rotation.x).not.toBeCloseTo(beforeArm, 4);
    // Animation stays allocation-free at the scene-graph level during hordes.
    expect(after).toEqual(descendants);
    visual.dispose();
  });

  it('owns disposable materials while leaving shared geometry cached', () => {
    const visual = buildZombieVisual('shambler');
    const disposeShell = vi.spyOn(visual.shellMaterial, 'dispose');
    const disposeWire = vi.spyOn(visual.wireMaterial, 'dispose');
    const disposeCore = vi.spyOn(visual.coreMaterial, 'dispose');

    expect(() => visual.dispose()).not.toThrow();
    expect(disposeShell).toHaveBeenCalledOnce();
    expect(disposeWire).toHaveBeenCalledOnce();
    expect(disposeCore).toHaveBeenCalledOnce();
  });
});