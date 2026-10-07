import * as THREE from 'three';

import type { EnemyConfig, EnemyVisual } from './enemies';

export type ZombieKind =
  | 'shambler'
  | 'runner'
  | 'bloater'
  | 'stalker'
  | 'screamer';

export const ZOMBIE_CONFIG: Record<ZombieKind, EnemyConfig> = {
  shambler: {
    kind: 'shambler',
    name: 'SHAMBLER',
    health: 72,
    radius: 0.72,
    hover: 0,
    speed: 3.6,
    color: 0x71865a,
    coreColor: 0xff4f87,
    coreRadius: 0.3,
    score: 125,
    cost: 1.4,
    contactDamage: 13,
    attackRange: 1.9,
    attackCooldown: 1.25,
    ranged: false,
    projectileDamage: 0,
    projectileSpeed: 0,
    minWave: 1,
  },
  runner: {
    kind: 'runner',
    name: 'RUNNER',
    health: 42,
    radius: 0.62,
    hover: 0,
    speed: 7.4,
    color: 0x8ca36d,
    coreColor: 0xff7a36,
    coreRadius: 0.27,
    score: 170,
    cost: 1.8,
    contactDamage: 14,
    attackRange: 2.35,
    attackCooldown: 0.78,
    ranged: false,
    projectileDamage: 0,
    projectileSpeed: 0,
    minWave: 2,
  },
  bloater: {
    kind: 'bloater',
    name: 'BLOATER',
    health: 360,
    radius: 1.45,
    hover: 0,
    speed: 2.5,
    color: 0x66734b,
    coreColor: 0xdfff3f,
    coreRadius: 0.44,
    score: 620,
    cost: 6,
    contactDamage: 24,
    attackRange: 2.75,
    attackCooldown: 1.8,
    ranged: false,
    projectileDamage: 0,
    projectileSpeed: 0,
    minWave: 5,
    blastRadius: 5.4,
  },
  stalker: {
    kind: 'stalker',
    name: 'STALKER',
    health: 58,
    radius: 0.68,
    hover: 0,
    speed: 7.9,
    color: 0x526b61,
    coreColor: 0xc65cff,
    coreRadius: 0.28,
    score: 285,
    cost: 2.8,
    contactDamage: 24,
    attackRange: 2.25,
    attackCooldown: 1.05,
    ranged: false,
    projectileDamage: 0,
    projectileSpeed: 0,
    minWave: 4,
  },
  screamer: {
    kind: 'screamer',
    name: 'SCREAMER',
    health: 115,
    radius: 0.82,
    hover: 0,
    speed: 3.8,
    color: 0x7a8171,
    coreColor: 0x31ffd2,
    coreRadius: 0.34,
    score: 340,
    cost: 3.6,
    contactDamage: 8,
    attackRange: 24,
    attackCooldown: 2.05,
    ranged: true,
    projectileDamage: 13,
    projectileSpeed: 19,
    minWave: 4,
  },
};

export interface ZombieVisual extends EnemyVisual {
  animate: (dt: number, moveSpeed: number, phase: number) => void;
}

interface ZombieProfile {
  torsoWidth: number;
  torsoHeight: number;
  torsoDepth: number;
  shoulderY: number;
  armLength: number;
  armThickness: number;
  legLength: number;
  legThickness: number;
  headScaleX: number;
  headScaleY: number;
  baseLean: number;
}

const PROFILES: Record<ZombieKind, ZombieProfile> = {
  shambler: {
    torsoWidth: 0.72,
    torsoHeight: 0.86,
    torsoDepth: 0.4,
    shoulderY: 1.62,
    armLength: 0.7,
    armThickness: 0.12,
    legLength: 0.9,
    legThickness: 0.13,
    headScaleX: 0.94,
    headScaleY: 1,
    baseLean: -0.13,
  },
  runner: {
    torsoWidth: 0.56,
    torsoHeight: 0.78,
    torsoDepth: 0.31,
    shoulderY: 1.58,
    armLength: 0.72,
    armThickness: 0.09,
    legLength: 1,
    legThickness: 0.095,
    headScaleX: 0.86,
    headScaleY: 0.95,
    baseLean: -0.28,
  },
  bloater: {
    torsoWidth: 1.38,
    torsoHeight: 1.18,
    torsoDepth: 0.9,
    shoulderY: 1.72,
    armLength: 0.76,
    armThickness: 0.19,
    legLength: 0.82,
    legThickness: 0.2,
    headScaleX: 1.08,
    headScaleY: 0.92,
    baseLean: -0.06,
  },
  stalker: {
    torsoWidth: 0.62,
    torsoHeight: 0.78,
    torsoDepth: 0.34,
    shoulderY: 1.5,
    armLength: 0.84,
    armThickness: 0.095,
    legLength: 0.94,
    legThickness: 0.105,
    headScaleX: 0.88,
    headScaleY: 1.08,
    baseLean: -0.35,
  },
  screamer: {
    torsoWidth: 0.68,
    torsoHeight: 0.9,
    torsoDepth: 0.38,
    shoulderY: 1.62,
    armLength: 0.67,
    armThickness: 0.11,
    legLength: 0.9,
    legThickness: 0.12,
    headScaleX: 0.9,
    headScaleY: 1.28,
    baseLean: -0.1,
  },
};

/** Geometry is immutable and shared; hit-flashable materials remain per rig. */
const geometryCache = new Map<string, THREE.BufferGeometry>();

function cached(
  key: string,
  make: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  const existing = geometryCache.get(key);
  if (existing) return existing;
  const geometry = make();
  geometryCache.set(key, geometry);
  return geometry;
}

function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return cached(
    `box:${width}:${height}:${depth}`,
    () => new THREE.BoxGeometry(width, height, depth),
  );
}

function cylinder(radius: number, height: number): THREE.BufferGeometry {
  return cached(
    `cylinder:${radius}:${height}`,
    () => new THREE.CylinderGeometry(radius * 0.82, radius, height, 7),
  );
}

function sphere(radius: number): THREE.BufferGeometry {
  return cached(
    `sphere:${radius}`,
    () => new THREE.SphereGeometry(radius, 10, 7),
  );
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * Optional repaint. A rival operator is the same articulated body with a
 * different paint job, which is cheaper to maintain than a second humanoid
 * builder and keeps every enemy on one animation path.
 */
export interface RigPalette {
  body: number;
  trim: number;
}

export function buildZombieVisual(
  kind: ZombieKind,
  palette?: RigPalette,
): ZombieVisual {
  const config = ZOMBIE_CONFIG[kind];
  const bodyColor = palette?.body ?? config.color;
  const trimColor = palette?.trim ?? config.coreColor;
  const profile = PROFILES[kind];
  const group = new THREE.Group();
  group.name = `zombie-${kind}`;
  const owned: THREE.Material[] = [];

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    emissive: trimColor,
    emissiveIntensity: 0.18,
    roughness: 0.82,
    metalness: 0.12,
    flatShading: true,
  });
  owned.push(shellMaterial);
  const deadMaterial = new THREE.MeshStandardMaterial({
    color: 0x252b24,
    emissive: bodyColor,
    emissiveIntensity: 0.08,
    roughness: 0.95,
    metalness: 0.04,
    flatShading: true,
  });
  owned.push(deadMaterial);
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: trimColor,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(wireMaterial);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: trimColor,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(coreMaterial);
  const woundMaterial = new THREE.MeshBasicMaterial({
    color: trimColor,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(woundMaterial);

  const body = new THREE.Group();
  body.name = 'torso-pivot';
  group.add(body);

  const torsoGeometry =
    kind === 'bloater'
      ? sphere(0.5)
      : box(profile.torsoWidth, profile.torsoHeight, profile.torsoDepth);
  const torsoY = kind === 'bloater' ? 1.37 : 1.36;
  const shell = addMesh(body, torsoGeometry, shellMaterial, 0, torsoY, 0);
  shell.name = 'torso';
  if (kind === 'bloater') {
    shell.scale.set(
      profile.torsoWidth,
      profile.torsoHeight,
      profile.torsoDepth,
    );
  }

  const wire = addMesh(body, torsoGeometry, wireMaterial, 0, torsoY, 0);
  wire.name = 'torso-detail';
  if (kind === 'bloater') {
    wire.scale.copy(shell.scale).multiplyScalar(1.025);
  } else {
    wire.scale.setScalar(1.025);
  }

  // A ragged luminous wound breaks up the torso and identifies each subtype.
  const wound = addMesh(
    body,
    box(profile.torsoWidth * 0.12, profile.torsoHeight * 0.5, 0.018),
    woundMaterial,
    profile.torsoWidth * -0.13,
    torsoY + 0.03,
    profile.torsoDepth * 0.51,
  );
  wound.rotation.z = 0.24;

  const headY = kind === 'bloater' ? 2.08 : kind === 'stalker' ? 1.94 : 2.02;
  const core = addMesh(
    body,
    sphere(config.coreRadius),
    coreMaterial,
    kind === 'shambler' ? 0.07 : 0,
    headY,
    0.02,
  );
  core.name = 'head';
  core.scale.set(profile.headScaleX, profile.headScaleY, 0.92);

  // The dark jaw leaves the bright skull readable as the critical weak point.
  const jaw = addMesh(
    body,
    box(config.coreRadius * 1.15, config.coreRadius * 0.42, config.coreRadius),
    deadMaterial,
    kind === 'shambler' ? 0.08 : 0,
    headY - config.coreRadius * 0.68,
    config.coreRadius * 0.2,
  );
  jaw.rotation.x = kind === 'screamer' ? -0.48 : -0.18;

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.name = 'arm-left';
  rightArm.name = 'arm-right';
  leftArm.position.set(-profile.torsoWidth * 0.52, profile.shoulderY, 0);
  rightArm.position.set(profile.torsoWidth * 0.52, profile.shoulderY - 0.08, 0);
  body.add(leftArm, rightArm);

  const forearmLength = profile.armLength * 0.52;
  const upperArmLength = profile.armLength * 0.48;
  const leftElbow = new THREE.Group();
  const rightElbow = new THREE.Group();
  leftElbow.name = 'elbow-left';
  rightElbow.name = 'elbow-right';
  leftElbow.position.y = -upperArmLength;
  rightElbow.position.y = -upperArmLength;
  leftArm.add(leftElbow);
  rightArm.add(rightElbow);
  addMesh(
    leftArm,
    cylinder(profile.armThickness, upperArmLength),
    shellMaterial,
    0,
    -upperArmLength * 0.5,
    0,
  );
  addMesh(
    rightArm,
    cylinder(profile.armThickness, upperArmLength),
    deadMaterial,
    0,
    -upperArmLength * 0.5,
    0,
  );
  addMesh(
    leftElbow,
    cylinder(profile.armThickness * 0.82, forearmLength),
    deadMaterial,
    0,
    -forearmLength * 0.5,
    0,
  );
  addMesh(
    rightElbow,
    cylinder(profile.armThickness * 0.82, forearmLength),
    shellMaterial,
    0,
    -forearmLength * 0.5,
    0,
  );
  addMesh(
    leftElbow,
    sphere(profile.armThickness * 1.12),
    shellMaterial,
    0,
    -forearmLength,
    0,
  );
  addMesh(
    rightElbow,
    sphere(profile.armThickness * 1.12),
    deadMaterial,
    0,
    -forearmLength,
    0,
  );

  // Front is +Z, matching the enemy runtime's facing convention.
  const leftArmBase = -1.23 - profile.baseLean * 0.35;
  const rightArmBase = -1.08 - profile.baseLean * 0.35;
  leftArm.rotation.set(leftArmBase, -0.08, -0.12);
  rightArm.rotation.set(rightArmBase, 0.1, 0.18);
  leftElbow.rotation.x = -0.32;
  rightElbow.rotation.x = -0.48;

  const hipsY = profile.legLength;
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.name = 'leg-left';
  rightLeg.name = 'leg-right';
  leftLeg.position.set(-profile.torsoWidth * 0.22, hipsY, 0);
  rightLeg.position.set(profile.torsoWidth * 0.22, hipsY, 0);
  group.add(leftLeg, rightLeg);

  const thighLength = profile.legLength * 0.52;
  const shinLength = profile.legLength * 0.48;
  const leftKnee = new THREE.Group();
  const rightKnee = new THREE.Group();
  leftKnee.name = 'knee-left';
  rightKnee.name = 'knee-right';
  leftKnee.position.y = -thighLength;
  rightKnee.position.y = -thighLength;
  leftLeg.add(leftKnee);
  rightLeg.add(rightKnee);
  addMesh(
    leftLeg,
    cylinder(profile.legThickness, thighLength),
    shellMaterial,
    0,
    -thighLength * 0.5,
    0,
  );
  addMesh(
    rightLeg,
    cylinder(profile.legThickness, thighLength),
    deadMaterial,
    0,
    -thighLength * 0.5,
    0,
  );
  addMesh(
    leftKnee,
    cylinder(profile.legThickness * 0.82, shinLength),
    deadMaterial,
    0,
    -shinLength * 0.5,
    0,
  );
  addMesh(
    rightKnee,
    cylinder(profile.legThickness * 0.82, shinLength),
    shellMaterial,
    0,
    -shinLength * 0.5,
    0,
  );
  addMesh(
    leftKnee,
    box(profile.legThickness * 1.7, 0.1, profile.legThickness * 2.5),
    deadMaterial,
    0,
    -shinLength + 0.04,
    0.05,
  );
  addMesh(
    rightKnee,
    box(profile.legThickness * 1.7, 0.1, profile.legThickness * 2.5),
    shellMaterial,
    0,
    -shinLength + 0.04,
    0.05,
  );

  const orbiters: THREE.Mesh[] = [];
  let elapsed = 0;
  const headBaseY = core.position.y;
  const jawBaseY = jaw.position.y;
  const torsoBaseY = shell.position.y;
  const wireBaseY = wire.position.y;
  const woundBaseY = wound.position.y;

  return {
    group,
    shell,
    wire,
    core,
    shellMaterial,
    wireMaterial,
    coreMaterial,
    orbiters,
    shield: null,
    shieldMaterial: null,
    animate: (dt: number, moveSpeed: number, phase: number): void => {
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      const speed = Number.isFinite(moveSpeed) ? Math.max(0, moveSpeed) : 0;
      const suppliedPhase = Number.isFinite(phase) ? phase : 0;
      elapsed += step * (1.7 + Math.min(speed, 10) * 0.42);
      const gait = elapsed + suppliedPhase;
      const stride = Math.min(0.82, speed * 0.095);
      const swing = Math.sin(gait);
      const drag = Math.sin(gait + 0.62);
      const bob = Math.abs(Math.sin(gait * 0.5)) * 0.035 * stride;
      const sway = Math.sin(gait * 0.5) * (0.035 + stride * 0.055);

      // One shortened stride and a stiff knee create the dragging gait.
      leftLeg.rotation.x = swing * stride;
      rightLeg.rotation.x = -drag * stride * 0.48 + stride * 0.1;
      leftKnee.rotation.x = Math.max(0, -swing) * stride * 0.9;
      rightKnee.rotation.x = 0.16 + Math.max(0, drag) * stride * 0.28;

      leftArm.rotation.x = leftArmBase - swing * stride * 0.16;
      rightArm.rotation.x = rightArmBase + drag * stride * 0.11;
      leftArm.rotation.z = -0.12 + sway * 0.7;
      rightArm.rotation.z = 0.18 + sway;
      leftElbow.rotation.x = -0.32 + Math.max(0, swing) * stride * 0.18;
      rightElbow.rotation.x = -0.48 + Math.max(0, -drag) * stride * 0.12;

      body.rotation.x = profile.baseLean;
      body.rotation.z = sway;
      shell.position.y = torsoBaseY + bob * 0.45;
      wire.position.y = wireBaseY + bob * 0.45;
      wound.position.y = woundBaseY + bob * 0.45;
      core.position.y = headBaseY + bob + Math.sin(gait * 1.35) * 0.018;
      jaw.position.y = jawBaseY + bob + Math.sin(gait * 1.35) * 0.018;
      core.rotation.z = -sway * 1.7;
      jaw.rotation.z = -sway * 1.7;
    },
    dispose: (): void => {
      for (const material of owned) material.dispose();
    },
  };
}

export function disposeZombieGeometry(): void {
  geometryCache.forEach((geometry) => geometry.dispose());
  geometryCache.clear();
}