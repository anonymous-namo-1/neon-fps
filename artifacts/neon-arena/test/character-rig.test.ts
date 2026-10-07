import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  CharacterRig,
  LOCAL_PALETTE,
  type CharacterPose,
} from '../src/game/character';

const idlePose = (): CharacterPose => ({
  forwardSpeed: 0,
  strafeSpeed: 0,
  verticalSpeed: 0,
  grounded: true,
  aimPitch: 0,
  scoped: 0,
  dashing: false,
  reloading: false,
  dead: false,
  sliding: 0,
  boosting: false,
});

function allFinite(root: THREE.Object3D): boolean {
  let finite = true;
  root.traverse((node) => {
    const values = [
      node.position.x,
      node.position.y,
      node.position.z,
      node.rotation.x,
      node.rotation.y,
      node.rotation.z,
      node.scale.x,
      node.scale.y,
      node.scale.z,
    ];
    if (!values.every(Number.isFinite)) finite = false;
  });
  return finite;
}

describe('CharacterRig', () => {
  it('builds an articulated, player-sized operator', () => {
    const rig = new CharacterRig(LOCAL_PALETTE);
    const hips = rig.group.getObjectByName('hips');
    const chest = rig.group.getObjectByName('chest');
    const head = rig.group.getObjectByName('head');
    expect(hips).toBeTruthy();
    expect(chest).toBeTruthy();
    expect(head).toBeTruthy();
    expect(chest?.parent?.name).toBe('spine');
    expect(head?.parent?.name).toBe('neck');

    const size = new THREE.Box3()
      .setFromObject(rig.group)
      .getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(1.6);
    expect(size.y).toBeLessThan(1.9);
    expect(size.x).toBeLessThan(1);
    rig.dispose();
  });

  it('cycles its jointed legs while walking without NaN', () => {
    const rig = new CharacterRig(LOCAL_PALETTE);
    const pose = { ...idlePose(), forwardSpeed: 4.5 };
    const thigh = rig.group.getObjectByName('thighL');
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      rig.update(1 / 60, pose);
      samples.push(thigh?.rotation.x ?? 0);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.2);
    expect(allFinite(rig.group)).toBe(true);
    rig.dispose();
  });

  it('shows exactly the selected weapon proxy', () => {
    const rig = new CharacterRig(LOCAL_PALETTE);
    for (const id of ['pulse', 'plasma', 'scatter', 'arc'] as const) {
      rig.setWeapon(id);
      const visible = ['pulse', 'plasma', 'scatter', 'arc'].filter(
        (key) => rig.group.getObjectByName(`weapon-${key}`)?.visible,
      );
      expect(visible).toEqual([id]);
    }
    rig.dispose();
  });

  it('applies recoil and springs the weapon back in half a second', () => {
    const rig = new CharacterRig(LOCAL_PALETTE);
    const pose = idlePose();
    const anchor = rig.group.getObjectByName('weaponAnchor');
    rig.update(1 / 60, pose);
    const rest = anchor?.position.z ?? 0;
    rig.fire();
    rig.update(1 / 60, pose);
    expect(anchor?.position.z).toBeGreaterThan(rest + 0.04);
    for (let i = 0; i < 30; i++) rig.update(1 / 60, pose);
    expect(Math.abs((anchor?.position.z ?? 0) - rest)).toBeLessThan(0.01);
    rig.dispose();
  });

  it('settles into a finite collapsed pose', () => {
    const rig = new CharacterRig(LOCAL_PALETTE);
    const pose = { ...idlePose(), dead: true };
    for (let i = 0; i < 120; i++) rig.update(1 / 60, pose);
    expect(allFinite(rig.group)).toBe(true);
    expect(rig.group.getObjectByName('hips')?.position.y).toBeLessThan(0.4);
    rig.dispose();
  });
});