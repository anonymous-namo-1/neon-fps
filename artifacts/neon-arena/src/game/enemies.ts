import * as THREE from 'three';

import type { EnemyKindId } from './contract';
import {
  ZOMBIE_CONFIG,
  buildZombieVisual,
  disposeZombieGeometry,
  type ZombieKind,
} from './zombies';

/** Re-exported from the contract so the interface and the engine agree on the
 *  set of archetypes. */
export type EnemyKind = EnemyKindId;

/**
 * Which opposition a run draws from. Constructs are the original arena
 * machines, infected are the zombie family, and operators are rival humans
 * used by Royale, Duel and Blackout. A run only ever spawns one family, which
 * is what keeps four modes from feeling like the same fight in new lighting.
 */
export type EnemyFamily = 'construct' | 'infected' | 'operator';

const INFECTED_KINDS: readonly ZombieKind[] = [
  'shambler',
  'runner',
  'bloater',
  'stalker',
  'screamer',
];

export function familyOf(kind: EnemyKind): EnemyFamily {
  if (kind === 'operator') return 'operator';
  return (INFECTED_KINDS as readonly string[]).includes(kind)
    ? 'infected'
    : 'construct';
}

export interface EnemyConfig {
  kind: EnemyKind;
  name: string;
  health: number;
  /** Collision and hit radius. */
  radius: number;
  /** Resting height above whatever surface is below. */
  hover: number;
  speed: number;
  color: number;
  coreColor: number;
  /** Radius of the weak point that scores critical hits. */
  coreRadius: number;
  score: number;
  /** Wave budget cost. */
  cost: number;
  /** Damage dealt on a successful melee lunge. */
  contactDamage: number;
  /** Distance at which the enemy commits to its attack. */
  attackRange: number;
  attackCooldown: number;
  ranged: boolean;
  projectileDamage: number;
  projectileSpeed: number;
  /** First wave this archetype can appear on. */
  minWave: number;
  /**
   * Half-angle, in radians, of a frontal arc that absorbs most incoming
   * damage. 0 means the archetype has no shield.
   */
  shieldArc?: number;
  /** Fraction of damage that survives the shield. */
  shieldLeak?: number;
  /** Blast radius when the archetype detonates on contact. 0 means none. */
  blastRadius?: number;
}

export const ENEMY_CONFIG: Record<EnemyKind, EnemyConfig> = {
  skitter: {
    kind: 'skitter',
    name: 'SKITTER',
    health: 34,
    radius: 0.62,
    hover: 0.95,
    speed: 8.4,
    color: 0xff2d78,
    coreColor: 0xffe66d,
    coreRadius: 0.3,
    score: 100,
    cost: 1,
    contactDamage: 11,
    attackRange: 2.0,
    attackCooldown: 1.05,
    ranged: false,
    projectileDamage: 0,
    projectileSpeed: 0,
    minWave: 1,
  },
  spectre: {
    kind: 'spectre',
    name: 'SPECTRE',
    health: 52,
    radius: 0.85,
    hover: 3.6,
    speed: 5.4,
    color: 0x22e0ff,
    coreColor: 0xffffff,
    coreRadius: 0.4,
    score: 175,
    cost: 2.2,
    contactDamage: 0,
    attackRange: 26,
    attackCooldown: 2.15,
    ranged: true,
    projectileDamage: 10,
    projectileSpeed: 23,
    minWave: 2,
  },
  splitter: {
    kind: 'splitter',
    name: 'SPLITTER',
    health: 96,
    radius: 1.0,
    hover: 1.2,
    speed: 5.6,
    color: 0xa855f7,
    coreColor: 0xff9df5,
    coreRadius: 0.44,
    score: 260,
    cost: 3.2,
    contactDamage: 15,
    attackRange: 2.4,
    attackCooldown: 1.3,
    ranged: false,
    projectileDamage: 0,
    projectileSpeed: 0,
    minWave: 4,
  },
  brute: {
    kind: 'brute',
    name: 'BRUTE',
    health: 420,
    radius: 1.8,
    hover: 1.5,
    speed: 3.5,
    color: 0xffb020,
    coreColor: 0xff4d2d,
    coreRadius: 0.62,
    score: 700,
    cost: 7,
    contactDamage: 26,
    attackRange: 7.5,
    attackCooldown: 2.6,
    ranged: true,
    projectileDamage: 16,
    projectileSpeed: 17,
    minWave: 5,
  },
  /**
   * Dive bomber. Fragile and fast, and its damage is all in the detonation, so
   * it converts standing still into a punish while dying harmlessly if you
   * spot it early. The counter is spacing, not aim.
   */
  seeker: {
    kind: 'seeker',
    name: 'SEEKER',
    health: 38,
    radius: 0.7,
    hover: 1.7,
    speed: 7.6,
    color: 0xff6b1a,
    coreColor: 0xfff3b0,
    coreRadius: 0.34,
    score: 210,
    cost: 2.6,
    contactDamage: 32,
    attackRange: 2.4,
    attackCooldown: 0.5,
    ranged: false,
    projectileDamage: 0,
    projectileSpeed: 0,
    minWave: 3,
    blastRadius: 5.2,
  },
  /**
   * Frontal-shield heavy. Shooting it head-on is nearly free damage for it,
   * so it asks the player to move rather than to out-DPS it. The shield drops
   * while it fires, which is the window.
   */
  warden: {
    kind: 'warden',
    name: 'WARDEN',
    health: 300,
    radius: 1.4,
    hover: 1.3,
    speed: 3.3,
    color: 0x3ddc84,
    coreColor: 0xd7ffe9,
    coreRadius: 0.5,
    score: 640,
    cost: 6,
    contactDamage: 20,
    attackRange: 17,
    attackCooldown: 2.5,
    ranged: true,
    projectileDamage: 14,
    projectileSpeed: 21,
    minWave: 6,
    shieldArc: Math.PI * 0.42,
    shieldLeak: 0.14,
  },

  ...ZOMBIE_CONFIG,

  /**
   * A rival human. Never rolled into a wave (`minWave` is past any reachable
   * wave) -- Royale, Duel and Blackout place them deliberately instead.
   */
  operator: {
    kind: 'operator',
    name: 'OPERATOR',
    health: 140,
    radius: 0.68,
    hover: 0,
    speed: 7.6,
    color: 0x2b3242,
    coreColor: 0xff4d6d,
    coreRadius: 0.28,
    score: 850,
    cost: 5,
    contactDamage: 0,
    attackRange: 34,
    attackCooldown: 1.05,
    ranged: true,
    projectileDamage: 13,
    projectileSpeed: 42,
    minWave: 999,
  },
};

export interface EnemyVisual {
  group: THREE.Group;
  shell: THREE.Mesh;
  wire: THREE.Mesh;
  core: THREE.Mesh;
  shellMaterial: THREE.MeshStandardMaterial;
  wireMaterial: THREE.MeshBasicMaterial;
  coreMaterial: THREE.MeshBasicMaterial;
  orbiters: THREE.Mesh[];
  /** Frontal barrier plate, present only on shielded archetypes. */
  shield: THREE.Mesh | null;
  shieldMaterial: THREE.MeshBasicMaterial | null;
  dispose: () => void;
}

/** Geometry is shared across every instance of a kind; materials are not. */
const geometryCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry) {
  const existing = geometryCache.get(key);
  if (existing) return existing;
  const geo = make();
  geometryCache.set(key, geo);
  return geo;
}

/** The original machine archetypes, the only ones built by this module. */
type ConstructKind = 'skitter' | 'spectre' | 'splitter' | 'brute' | 'seeker' | 'warden';

function shellGeometry(kind: ConstructKind): THREE.BufferGeometry {
  switch (kind) {
    case 'skitter':
      return cached('skitter', () => new THREE.TetrahedronGeometry(0.78, 0));
    case 'spectre':
      return cached('spectre', () => new THREE.OctahedronGeometry(0.92, 0));
    case 'splitter':
      return cached('splitter', () => new THREE.IcosahedronGeometry(1.05, 0));
    case 'brute':
      return cached('brute', () => new THREE.DodecahedronGeometry(1.85, 0));
    case 'seeker':
      // A dart, so the direction it is committed to is readable at a glance.
      return cached('seeker', () => {
        const geo = new THREE.ConeGeometry(0.52, 1.6, 4);
        geo.rotateX(Math.PI / 2);
        return geo;
      });
    case 'warden':
      return cached('warden', () => new THREE.CylinderGeometry(1.0, 1.25, 1.9, 6));
  }
}

export function buildEnemyVisual(kind: EnemyKind): EnemyVisual {
  const family = familyOf(kind);
  if (family === 'infected') return buildZombieVisual(kind as ZombieKind);
  if (family === 'operator') {
    // A rival wears the same articulated body as the infected -- one humanoid
    // builder, one gait to maintain -- repainted in hostile chrome and red so
    // it never reads as one of the horde.
    return buildZombieVisual('stalker', { body: 0x2b3242, trim: 0xff4d6d });
  }

  const config = ENEMY_CONFIG[kind];
  const group = new THREE.Group();
  const owned: Array<{ dispose: () => void }> = [];

  const shellGeo = shellGeometry(kind as ConstructKind);

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d1119,
    emissive: config.color,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.85,
    flatShading: true,
  });
  owned.push(shellMaterial);

  const shell = new THREE.Mesh(shellGeo, shellMaterial);
  group.add(shell);

  // A slightly larger wireframe cage gives the neon silhouette.
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: config.color,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(wireMaterial);

  const wire = new THREE.Mesh(shellGeo, wireMaterial);
  wire.scale.setScalar(1.09);
  group.add(wire);

  // The weak point. Hitting this scores a critical.
  const coreGeo = cached(
    `core-${config.coreRadius.toFixed(2)}`,
    () => new THREE.IcosahedronGeometry(1, 1),
  );
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: config.coreColor,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(coreMaterial);

  const core = new THREE.Mesh(coreGeo, coreMaterial);
  core.scale.setScalar(config.coreRadius);
  group.add(core);

  // Orbiting shards for the bigger archetypes.
  const orbiters: THREE.Mesh[] = [];
  const orbiterCount =
    kind === 'brute' ? 5 : kind === 'warden' ? 4 : kind === 'splitter' ? 3 : 0;
  if (orbiterCount > 0) {
    const shardGeo = cached(
      'shard',
      () => new THREE.TetrahedronGeometry(0.3, 0),
    );
    for (let i = 0; i < orbiterCount; i++) {
      const shard = new THREE.Mesh(shardGeo, wireMaterial);
      orbiters.push(shard);
      group.add(shard);
    }
  }

  // Frontal barrier. Faces +Z, which is the direction the visual group is
  // rotated to point at the player.
  let shield: THREE.Mesh | null = null;
  let shieldMaterial: THREE.MeshBasicMaterial | null = null;
  if (config.shieldArc) {
    const arc = config.shieldArc;
    const shieldGeo = cached(
      `shield-${arc.toFixed(3)}-${config.radius.toFixed(2)}`,
      () =>
        new THREE.SphereGeometry(
          config.radius * 1.5,
          24,
          12,
          Math.PI / 2 - arc,
          arc * 2,
          Math.PI * 0.2,
          Math.PI * 0.6,
        ),
    );
    shieldMaterial = new THREE.MeshBasicMaterial({
      color: config.coreColor,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    owned.push(shieldMaterial);
    shield = new THREE.Mesh(shieldGeo, shieldMaterial);
    group.add(shield);
  }

  return {
    group,
    shell,
    wire,
    core,
    shellMaterial,
    wireMaterial,
    coreMaterial,
    orbiters,
    shield,
    shieldMaterial,
    dispose: () => owned.forEach((o) => o.dispose()),
  };
}

export function disposeEnemyGeometry(): void {
  disposeZombieGeometry();
  geometryCache.forEach((g) => g.dispose());
  geometryCache.clear();
}

/**
 * Builds the spawn list for a wave: a budget is spent on the archetypes
 * unlocked so far, always leaving a floor of fast chaff so waves stay busy.
 */
export function rollWave(
  wave: number,
  budgetMul = 1,
  family: EnemyFamily = 'construct',
): EnemyKind[] {
  const budget = (5 + wave * 2.7 + wave * wave * 0.17) * budgetMul;
  const unlocked = (Object.keys(ENEMY_CONFIG) as EnemyKind[]).filter(
    (k) => ENEMY_CONFIG[k].minWave <= wave && familyOf(k) === family,
  );

  const picks: EnemyKind[] = [];
  let remaining = budget;

  // Spend roughly a third of the budget on heavies once they unlock.
  const heavies = unlocked.filter((k) => ENEMY_CONFIG[k].cost >= 3);
  if (heavies.length > 0) {
    let heavyBudget = budget * 0.42;
    while (heavyBudget > 0) {
      const kind = heavies[Math.floor(Math.random() * heavies.length)]!;
      const cost = ENEMY_CONFIG[kind].cost;
      if (cost > heavyBudget) break;
      picks.push(kind);
      heavyBudget -= cost;
      remaining -= cost;
    }
  }

  const light = unlocked.filter((k) => ENEMY_CONFIG[k].cost < 3);
  let guard = 0;
  while (remaining > 0 && guard++ < 200) {
    const kind = light[Math.floor(Math.random() * light.length)]!;
    const cost = ENEMY_CONFIG[kind].cost;
    if (cost > remaining && picks.length > 0) break;
    picks.push(kind);
    remaining -= cost;
  }

  // Shuffle so heavies do not all arrive first.
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = picks[i]!;
    picks[i] = picks[j]!;
    picks[j] = a;
  }

  return picks;
}
