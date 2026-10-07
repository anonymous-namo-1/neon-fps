import * as THREE from 'three';

import type { Arena } from '@/game/arena';
import type {
  GameModeId,
  GamePhase,
  GameSettings,
  GameSnapshot,
  WeaponId,
} from '@/game/contract';
import { GameEngine } from '@/game/engine';
import type {
  IncomingDamage,
  NetworkPlayerState,
  OutgoingHit,
} from '@/game/engine';
import type { EnemyConfig, EnemyKind, EnemyVisual } from '@/game/enemies';
import type { PlayerStats } from '@/game/upgrades';

/**
 * Test-side mirrors of the engine-private records. They are structural copies
 * rather than imports because the engine deliberately keeps them internal;
 * `createTestEngine` casts once, here, so no test has to sprinkle `any`.
 */
export interface TestEnemy {
  config: EnemyConfig;
  visual: EnemyVisual;
  position: THREE.Vector3;
  prevPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  health: number;
  maxHealth: number;
  radius: number;
  scale: number;
  spawnTimer: number;
  attackTimer: number;
  telegraph: number;
  hitFlash: number;
  spin: number;
  phase: number;
  strafeSign: number;
  alive: boolean;
  generation: number;
  facing: number;
  shieldDown: number;
}

export interface TestProjectile {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  damage: number;
  radius: number;
  splash: number;
  fromPlayer: boolean;
  charge: number;
  active: boolean;
}

interface TestWeapon {
  id: WeaponId;
  baseDamage: number;
  spread: number;
  zoom: number;
  ammo: number;
  cooldown: number;
}

/** Test-side mirror of the engine's private remote-operator record. */
export interface TestRemotePlayer {
  id: string;
  group: THREE.Group;
  target: THREE.Vector3;
  yaw: number;
  callsign: string;
  health: number;
  maxHealth: number;
  dead: boolean;
}

export interface EngineInternals {
  /* ------------------------------- state ------------------------------- */
  arena: Arena;
  phase: GamePhase;
  mode: GameModeId;
  wave: number;
  waveQueue: EnemyKind[];
  waveTotal: number;
  waveKilled: number;
  waveCountdown: number;
  clearing: boolean;
  spawnTimer: number;
  score: number;
  chain: number;
  bestCombo: number;
  kills: number;
  health: number;
  shield: number;
  iframes: number;
  stats: PlayerStats;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  prevPlayerPosition: THREE.Vector3;
  renderPosition: THREE.Vector3;
  grounded: boolean;
  wasGrounded: boolean;
  yaw: number;
  pitch: number;
  keys: Set<string>;
  pointerLocked: boolean;
  dashCharges: number;
  dashTimer: number;
  settings: GameSettings;
  /** Slide & boost style state. */
  sliding: boolean;
  boostFuel: number;
  viewMode: 'first' | 'third';
  /** Post-clamp camera distance the third-person rig settled on. */
  tpDistance: number;
  /** True while the scope button is held. */
  scoping: boolean;
  charging: boolean;
  /** Smoothed 0..1 scope engagement. */
  scopeBlend: number;
  localRig: { group: THREE.Group };
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  viewModel: { muzzleWorld: (target: THREE.Vector3) => THREE.Vector3 };
  enemies: TestEnemy[];
  projectiles: TestProjectile[];
  activeWeapon: WeaponId;
  weapons: TestWeapon[];

  /* ------------------------- player versus player ---------------------- */
  remotePlayers: Map<string, TestRemotePlayer>;
  /** Hits landed on other operators, awaiting a send. */
  pendingHits: OutgoingHit[];
  setRemotePlayers: (players: NetworkPlayerState[]) => void;
  drainHits: () => OutgoingHit[];
  applyIncomingDamage: (hits: readonly IncomingDamage[]) => void;
  onMouseMove: (event: MouseEvent) => void;
  damageRemote: (
    remote: TestRemotePlayer,
    amount: number,
    crit: boolean,
    point: THREE.Vector3,
  ) => void;

  /* ---------------------- shared scratch vectors ----------------------- */
  v1: THREE.Vector3;
  v2: THREE.Vector3;
  v3: THREE.Vector3;
  v4: THREE.Vector3;
  /** Movement basis, refreshed at the top of `updatePlayer`. */
  forward: THREE.Vector3;
  right: THREE.Vector3;
  playerCenter: THREE.Vector3;

  /** Ring mesh for the royale zone. Null until a royale run creates it. */
  zoneMesh: THREE.Mesh | null;
  /** True once a run has been won; must not survive into the next run. */
  modeVictory: boolean;
  runTrail: number | null;

  /* ------------------------------ methods ------------------------------ */
  finishRun: (victory: boolean) => void;
  simulate: (dt: number) => void;
  present: (frameDt: number, alpha: number) => void;
  updatePlayer: (dt: number) => void;
  updateCamera: (dt: number, alpha?: number) => void;
  updateEnemies: (dt: number, visualDt: number) => void;
  startWave: (wave: number) => void;
  createEnemy: (
    kind: EnemyKind,
    at: THREE.Vector3,
    generation: number,
  ) => TestEnemy;
  killEnemy: (enemy: TestEnemy, credit?: boolean) => void;
  damageEnemy: (
    enemy: TestEnemy,
    amount: number,
    crit: boolean,
    point: THREE.Vector3,
  ) => void;
  seekerDetonate: (enemy: TestEnemy) => void;
  bruteSlam: (enemy: TestEnemy, playerCenter: THREE.Vector3) => void;
  hasLineOfSight: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
  hitscan: (
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number,
    options?: {
      falloff?: { start: number; end: number; min: number };
      tracerColor?: number;
    },
  ) => boolean;
  arcChain: (
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number,
  ) => boolean;
  detonate: (p: TestProjectile) => void;
  spawnProjectile: (options: {
    origin: THREE.Vector3;
    direction: THREE.Vector3;
    speed: number;
    damage: number;
    radius: number;
    splash: number;
    fromPlayer: boolean;
    charge: number;
    material: THREE.Material;
    life: number;
  }) => void;
  swapWeapon: (id: WeaponId) => void;
  applyLoadout: (ids: WeaponId[]) => void;
  fire: (charge: number) => void;
}

export interface TestEngine {
  engine: GameEngine;
  /** The engine's internals, for reaching past the public handle. */
  g: EngineInternals;
  snapshots: GameSnapshot[];
  dispose: () => void;
}

export function createTestEngine(arenaId?: string): TestEngine {
  const canvas = document.createElement('canvas');
  const snapshots: GameSnapshot[] = [];
  const engine = new GameEngine(
    canvas,
    (snapshot) => snapshots.push(snapshot),
    arenaId,
  );
  return {
    engine,
    g: engine as unknown as EngineInternals,
    snapshots,
    dispose: () => engine.dispose(),
  };
}

/**
 * Creates an enemy that is already awake and deterministic.
 *
 * `createEnemy` seeds spin, phase, strafe direction and attack timer from
 * `Math.random`, and holds the unit inert for 0.85s while it scales in --
 * none of which a damage or steering assertion wants to depend on.
 */
export function spawnEnemy(
  g: EngineInternals,
  kind: EnemyKind,
  at: THREE.Vector3,
  overrides: Partial<TestEnemy> = {},
): TestEnemy {
  const enemy = g.createEnemy(kind, at, 0);
  enemy.spawnTimer = 0;
  enemy.attackTimer = 99;
  enemy.spin = 0;
  enemy.phase = 0;
  enemy.strafeSign = 1;
  Object.assign(enemy, overrides);
  return enemy;
}

/** Replaces the map's solid geometry so a probe ray or blast is unobstructed. */
export function useColliders(
  g: EngineInternals,
  colliders: THREE.Box3[] = [],
): void {
  g.arena = { ...g.arena, colliders };
}

/** Mirrors the engine's private EYE_HEIGHT constant. */
const EYE_HEIGHT = 1.68;

/**
 * The ray `fire()` actually traces.
 *
 * Its origin follows the view mode exactly like `fire()` does: the head in
 * third person (the default -- the camera looks straight back through it),
 * the viewmodel muzzle in first person. It runs along the *camera's* world
 * direction. The engine's `forward` member is not it: `forward` is only
 * refreshed inside `fire()` and otherwise holds whatever the last movement
 * update left there, which can sit 90 degrees away. A target placed along
 * `forward` is simply missed, and a miss reads exactly like a broken weapon --
 * so every shooting test places its target on this ray instead.
 */
export function muzzleRay(g: EngineInternals): {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
} {
  const origin =
    g.viewMode === 'third'
      ? new THREE.Vector3(g.position.x, g.position.y + EYE_HEIGHT, g.position.z)
      : g.viewModel.muzzleWorld(new THREE.Vector3());
  return {
    origin,
    direction: g.camera.getWorldDirection(new THREE.Vector3()),
  };
}

/** A point `distance` metres down the muzzle ray. */
export function pointOnMuzzleRay(
  g: EngineInternals,
  distance: number,
): THREE.Vector3 {
  const { origin, direction } = muzzleRay(g);
  return origin.clone().addScaledVector(direction, distance);
}

/**
 * Swaps in a reproducible `Math.random`. Wave composition, spawn placement and
 * weapon spread are all random; a failure nobody can re-run is not a test.
 * Returns the restore function.
 */
export function seedRandom(seed: number): () => void {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    Math.random = original;
  };
}
