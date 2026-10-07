import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { AudioEngine } from './audio';
import {
  arenaMeta,
  DEFAULT_ARENA_ID,
  surfaceHeightAt,
  type Arena,
} from './arena';
import {
  buildEnemyVisual,
  disposeEnemyGeometry,
  ENEMY_CONFIG,
  rollWave,
  type EnemyConfig,
  type EnemyKind,
  type EnemyVisual,
} from './enemies';
import {
  DamageNumbers,
  ParticleField,
  RingField,
  TracerField,
} from './particles';
import {
  applyRunModifiers,
  baseTuning,
  type RunTuning,
} from './progression';
import {
  CharacterRig,
  LOCAL_PALETTE,
  REMOTE_PALETTE,
  type CharacterPose,
} from './character';
import { MODE_TUNING } from './modes';
import { ModeRuntime, type ModeHost } from './mode-runtime';
import { SpatialHash } from './spatial-hash';
import { baseStats, UpgradePool, type PlayerStats } from './upgrades';
import { ViewModel } from './viewmodel';
import {
  createSnapshot,
  DEFAULT_SETTINGS,
  emptyKillTally,
  LOADOUT_SLOTS,
  STARTER_LOADOUT,
  weaponInfo,
  WEAPONS,
  type EnemyKindId,
  type FeedTone,
  type GameModeId,
  type GamePhase,
  type GameSettings,
  type GameSnapshot,
  type HuntRole,
  type MarkerKind,
  type QualityLevel,
  type RunConfig,
  type RunModifierId,
  type UpgradeOption,
  type WeaponId,
} from './contract';

/* --------------------------------------------------------------------- */
/* Tuning                                                                  */
/* --------------------------------------------------------------------- */

const EYE_HEIGHT = 1.68;
const PLAYER_HEIGHT = 1.78;
const PLAYER_RADIUS = 0.42;
const GRAVITY = -32;
const JUMP_SPEED = 11.2;
const GROUND_ACCEL = 78;
const AIR_ACCEL = 26;
const GROUND_FRICTION = 11;
const STEP_HEIGHT = 0.95;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.13;
const FALL_RECOVERY_Y = -12;
const COLLISION_EPSILON = 1e-6;
const ENEMY_SURFACE_TOLERANCE = 0.25;
const DASH_DURATION = 0.16;
const DASH_IFRAMES = 0.3;
/* Slide & boost. A slide pays its speed up front and then bleeds, so chaining
 * slides is slower than simply running -- the burst has to be spent on
 * something. Boost trades the same key in the air for height and reach. */
const SLIDE_DURATION = 1;
const SLIDE_IMPULSE = 5.4;
const SLIDE_FRICTION = 1.4;
const SLIDE_MIN_SPEED = 4.2;
const SLIDE_COOLDOWN = 0.35;
/** Seconds of continuous thrust a full tank buys. */
const BOOST_SECONDS = 1.5;
const BOOST_REFILL_SECONDS = 2.4;
/* Thrust is applied before gravity in the same step, so it has to clear
 * GRAVITY outright to lift at all -- half of it just slows the fall. */
const BOOST_LIFT = 52;
const BOOST_MAX_RISE = 7.4;
const BOOST_PUSH = 30;
const OVERDRIVE_DURATION = 7;
const SNAPSHOT_INTERVAL = 1 / 30;

/**
 * The simulation runs on a fixed step and the renderer interpolates between
 * the last two steps. Two reasons this matters beyond feel:
 *
 *  - Weapon cadence, movement acceleration and knockback are no longer tied to
 *    display refresh, so the game plays identically at 30fps and 240fps.
 *  - A deterministic fixed step is a prerequisite for network play: the server
 *    and every client must advance the world in identical increments.
 */
const SIM_STEP = 1 / 60;
/** Beyond this many steps in one frame we drop the backlog instead of
 *  spiralling -- catching up would take longer than the frame that caused it. */
const MAX_SIM_STEPS = 3;
const MAX_PITCH = Math.PI / 2 - 0.02;

/**
 * Third-person rig. The camera hangs this far behind the eye along the aim
 * ray and looks back through it. Anything that shortens the follow distance
 * -- wall pull-in, the floor cap -- moves the camera ALONG that ray, never
 * off it, so the rendered center ray and the third-person fire ray stay
 * collinear and the crosshair never lies. A hit closer than the margin
 * collapses the distance toward zero (camera at the eye); it must never
 * place the camera beyond a hit.
 */
const THIRD_PERSON_DISTANCE = 3.4;
const THIRD_PERSON_MARGIN = 0.22;
/** The open floor plane is not a collider; the distance cap keeps the
 *  camera at or above this height without leaving the aim ray. */
const THIRD_PERSON_MIN_CAMERA_Y = 0.18;
/** Below this camera distance the avatar's own head fills the lens. */
const THIRD_PERSON_AVATAR_HIDE = 1.05;

const AXES = ['x', 'y', 'z'] as const;

const PULSE_COLOR = 0x9fe9ff;
const PLASMA_COLOR = 0xff5ad0;
const SCATTER_COLOR = 0xffc46b;
const ARC_COLOR = 0xb69dff;

/** Shard burst pellets stop being worth firing past about this range. */
const SCATTER_FALLOFF = { start: 9, end: 30, min: 0.16 };
/** Arc tether jump distance and how many targets one shot can link. */
const ARC_CHAIN_RANGE = 9.5;
const ARC_CHAIN_MAX = 4;

interface WeaponRuntime {
  id: WeaponId;
  name: string;
  baseMagazine: number;
  baseDamage: number;
  baseInterval: number;
  baseReload: number;
  chargeable: boolean;
  ammo: number;
  cooldown: number;
  reloading: boolean;
  reloadTimer: number;
  charge: number;
  spread: number;
  /** Scope magnification while aiming down sights. 1 = no scope fitted. */
  zoom: number;
}

/** Fixed tuning per weapon. The runtime copy carried into a run is built
 *  from this, so only the weapons in the player's loadout exist during play. */
const WEAPON_TUNING: Record<
  WeaponId,
  Pick<
    WeaponRuntime,
    | 'baseMagazine'
    | 'baseDamage'
    | 'baseInterval'
    | 'baseReload'
    | 'chargeable'
    | 'spread'
    | 'zoom'
  >
> = {
  pulse: {
    baseMagazine: 28,
    baseDamage: 13,
    baseInterval: 0.086,
    baseReload: 1.05,
    chargeable: false,
    spread: 0.008,
    zoom: 1.9,
  },
  plasma: {
    baseMagazine: 5,
    baseDamage: 48,
    baseInterval: 0.44,
    baseReload: 1.65,
    chargeable: true,
    spread: 0,
    zoom: 1.6,
  },
  // Burst damage that falls off hard with range, so it rewards closing on a
  // brute instead of kiting it.
  scatter: {
    baseMagazine: 6,
    baseDamage: 11,
    baseInterval: 0.62,
    baseReload: 1.5,
    chargeable: false,
    spread: 0.055,
    zoom: 1.3,
  },
  // Low per-hit damage that chains between nearby targets: the answer to a
  // packed wave rather than to any single enemy.
  arc: {
    baseMagazine: 40,
    baseDamage: 7,
    baseInterval: 0.075,
    baseReload: 1.9,
    chargeable: false,
    spread: 0.02,
    zoom: 1.45,
  },
};
interface Enemy {
  config: EnemyConfig;
  visual: EnemyVisual;
  position: THREE.Vector3;
  /** Position at the end of the previous simulation step, for render lerp. */
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
  /** Yaw the unit is facing, in radians. Drives the warden's shield arc. */
  facing: number;
  /** Seconds the frontal shield stays down after firing. */
  shieldDown: number;
  /** Anchor used to detect units trapped behind geometry rather than advancing. */
  stuckAnchor: THREE.Vector3;
  stuckTimer: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  /** Position at the end of the previous simulation step, for render lerp. */
  prevPosition: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  damage: number;
  radius: number;
  splash: number;
  fromPlayer: boolean;
  charge: number;
  active: boolean;
}

interface FeedItem {
  id: number;
  text: string;
  tone: FeedTone;
  expires: number;
}

export interface EngineHandle {
  /** Starts a run. Omitting the config replays the last one. */
  start: (config?: RunConfig) => void;
  resume: () => void;
  restart: () => void;
  quitToMenu: () => void;
  chooseUpgrade: (id: string) => void;
  applySettings: (settings: GameSettings) => void;
  dispose: () => void;
}

export interface NetworkPlayerState {
  id: string;
  callsign: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  maxHealth: number;
  dead: boolean;
}

/** A hit this client resolved against another operator, awaiting send. */
export interface OutgoingHit {
  targetId: string;
  damage: number;
  headshot: boolean;
}

/** Damage another operator reported against this client. */
export interface IncomingDamage {
  fromId: string;
  fromCallsign: string;
  damage: number;
  headshot: boolean;
}

interface RemotePlayer {
  id: string;
  rig: CharacterRig;
  group: THREE.Group;
  target: THREE.Vector3;
  yaw: number;
  callsign: string;
  /** Last value from the wire, corrected by local prediction between packets. */
  health: number;
  /**
   * The raw previous wire value, kept so a genuine heal or a fresh duel round
   * can be told apart from a stale packet. Without it the prediction clamp
   * below is permanent and a healed rival reads as damaged forever.
   */
  wireHealth: number;
  maxHealth: number;
  dead: boolean;
  /** The wire protocol carries position and yaw only, so squadmate animation
   *  is inferred from how far their interpolated body actually moved. */
  forwardSpeed: number;
  strafeSpeed: number;
  verticalSpeed: number;
  lastX: number;
  lastY: number;
  lastZ: number;
}

/** Waist height of a standing operator, for the body hit sphere. */
const REMOTE_BODY_Y = 1.0;
const REMOTE_BODY_RADIUS = 0.55;
/** Head centre and radius, for the headshot sphere. */
const REMOTE_HEAD_Y = 1.62;
const REMOTE_HEAD_RADIUS = 0.28;

function emptyPose(): CharacterPose {
  return {
    forwardSpeed: 0,
    strafeSpeed: 0,
    verticalSpeed: 0,
    grounded: true,
    aimPitch: 0,
    scoped: 0,
    dashing: false,
    sliding: 0,
    boosting: false,
    reloading: false,
    dead: false,
  };
}

export class GameEngine implements EngineHandle {
  /* ----------------------------- rendering ---------------------------- */
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly environment: THREE.Texture;
  private readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private arena: Arena;
  private arenaId: string;
  private readonly viewModel: ViewModel;
  private readonly remotePlayers = new Map<string, RemotePlayer>();
  /** 'first' aims down the weapon; 'third' orbits behind a visible body.
   *  Third person is the default so the operator is on screen from the first
   *  frame; V swaps for players who prefer aiming down the weapon. */
  private viewMode: 'first' | 'third' = 'third';
  /** Distance the third-person camera actually got last frame, post-clamp. */
  private tpDistance = THIRD_PERSON_DISTANCE;
  /** True while the scope button (right mouse) is held. The camera reads it
   *  through `scopeBlend`, so scoping glides instead of snapping. */
  private scoping = false;
  /** Smoothed 0..1 scope engagement driving FOV, camera pull-in, aim
   *  sensitivity and spread. */
  private scopeBlend = 0;
  /** The operator's own body: a full articulated rig, on screen whenever the
   *  third-person camera is far enough back to see it. */
  private readonly localRig = new CharacterRig(LOCAL_PALETTE);
  /** Prototypes kept alive so their linked shader programs stay cached. */
  private prewarmGroup: THREE.Group | null = null;
  private readonly prewarmVisuals: EnemyVisual[] = [];

  /* ------------------------------- modes ------------------------------ */
  private mode: GameModeId = 'horde';
  private huntRole: HuntRole = 'hider';
  private modeRuntime: ModeRuntime | null = null;
  /** Blackout hiders carry nothing. */
  private playerArmed = true;
  /** Running estimate of what the run has earned, for the HUD. */
  private runCredits = 0;
  /** Shop trail colour for this run, or null for the weapon default. */
  private runTrail: number | null = null;
  /** True once a mode has declared the run won rather than lost. */
  private modeVictory = false;
  private zoneMesh: THREE.Mesh | null = null;
  private readonly lightBaselines = new Map<string, number>();
  private baseEnvIntensity = 0.24;
  /** Dedicated so zone damage never borrows a shared scratch vector. */
  private readonly zoneHurtFrom = new THREE.Vector3();
  /** Owned by `damageRemote`, which runs inside loops that use v1..v4. */
  private readonly remoteHitAt = new THREE.Vector3();
  /** Body-sphere impact, held while the head sphere reuses `remoteHitAt`. */
  private readonly remoteBodyAt = new THREE.Vector3();
  /** Hits landed on other operators, drained by the network layer. */
  private readonly pendingHits: OutgoingHit[] = [];
  private readonly localPose = emptyPose();
  private readonly remoteRigPose = emptyPose();

  /**
   * Fixed pool of dynamic point lights shared by enemies and projectiles.
   *
   * Lights are part of three.js' shader program cache key, so *adding* one
   * recompiles every material in the scene. Giving each enemy and each
   * projectile its own light meant a spawn wave triggered a recompile storm
   * mid-fight -- the single worst hitch in the game. The pool is built once
   * per quality tier and never grows or shrinks; slots are re-pointed at
   * whatever is most worth lighting each frame. For the same reason a spare
   * slot is dimmed to zero intensity rather than hidden: `visible = false`
   * would drop it from the light list and recompile everything again.
   */
  private readonly dynamicLights: THREE.PointLight[] = [];
  private dynamicLightScores = new Float32Array(0);

  /**
   * Adaptive render scale. Pixel count is the dominant cost on the integrated
   * GPUs this runs on, so a sustained slow frame average trades resolution
   * for framerate and a sustained fast one hands it back.
   */
  private renderScale = 1;
  private frameAverage = 1 / 60;
  private scaleCooldown = 3;

  /* ------------------------------ systems ----------------------------- */
  private readonly audio = new AudioEngine();
  private readonly particles = new ParticleField(3600);
  private readonly tracers = new TracerField(96);
  private readonly rings = new RingField(20);
  private readonly numbers = new DamageNumbers(30);
  private readonly upgrades = new UpgradePool();

  /* ------------------------------- state ------------------------------ */
  private readonly emit: (snapshot: GameSnapshot) => void;
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private phase: GamePhase = 'menu';
  private stats: PlayerStats = baseStats();

  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private grounded = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private health = 100;
  private shield = 50;
  private sinceDamage = 99;
  private dashCharges = 2;
  private dashRecharge = 0;
  private dashTimer = 0;
  private iframes = 0;
  /** 0 to 1. Spends on boost, refills on the ground. */
  private boostFuel = 1;
  private sliding = false;
  private slideTimer = 0;
  private slideCooldown = 0;
  /** Eased 0 to 1 so the camera ducks into a slide instead of snapping. */
  private slideCrouch = 0;
  /** Seconds left of the boost burn. */
  private boostTimer = 0;
  private lastConfig: RunConfig | null = null;
  private wasGrounded = true;

  /** Only the weapons carried this run, in loadout slot order. */
  private weapons: WeaponRuntime[] = [];
  private loadout: WeaponId[] = [...STARTER_LOADOUT];
  private activeWeapon: WeaponId = 'pulse';
  private modifiers: RunModifierId[] = [];
  /** Run-wide knobs the armed modifiers moved. Rebuilt every run. */
  private tuning: RunTuning = baseTuning();

  private wave = 0;
  private pendingWave = 1;
  private waveQueue: EnemyKind[] = [];
  private waveTotal = 0;
  private waveKilled = 0;
  private waveCountdown = 0;
  private spawnTimer = 0;
  private clearing = false;
  private clearTimer = 0;

  private score = 0;
  private chain = 0;
  private comboTimer = 0;
  private bestCombo = 1;
  private kills = 0;
  private killsByKind: Record<EnemyKindId, number> = emptyKillTally();
  private shotsFired = 0;
  private shotsHit = 0;
  private runTime = 0;

  private overdrive = 0;
  private overdriveTimer = 0;

  private readonly enemies: Enemy[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly projectilePool: Projectile[] = [];
  private ownedUpgrades: UpgradeOption[] = [];
  private upgradeChoices: UpgradeOption[] = [];

  private feed: FeedItem[] = [];
  private feedId = 0;
  private announcement: string | null = null;
  private announcementSub: string | null = null;
  private announcementExpires = 0;
  private markerId = 0;
  private markerKind: MarkerKind = 'hit';
  private damageId = 0;
  private damageAngle = 0;

  private shake = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private slowmo = 1;
  private slowmoTarget = 1;
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private pointerLocked = false;

  private readonly keys = new Set<string>();
  private firing = false;
  private charging = false;

  private raf = 0;
  private lastTime = 0;
  private snapshotAccumulator = 0;
  /** Unconsumed wall-clock time carried between fixed simulation steps. */
  private simAccumulator = 0;
  private elapsed = 0;
  /** Player position at the end of the previous simulation step. */
  private readonly prevPlayerPosition = new THREE.Vector3();
  /** Interpolated player position; drives the camera, never the simulation. */
  private readonly renderPosition = new THREE.Vector3();
  /**
   * Camera-only scratch. Presentation runs after the simulation pass, but it
   * still owns its vectors: hitscan and the enemy AI hold scratchBox/v1..v4
   * across calls, and borrowing them here would corrupt whichever pass runs
   * next (see slamDir for how that failure looks).
   */
  private readonly extrapolation = new THREE.Vector3();
  private readonly extrapolationBox = new THREE.Box3();
  private readonly tpAim = new THREE.Vector3();
  private readonly tpRay = new THREE.Ray();
  private readonly tpHit = new THREE.Vector3();
  /**
   * Broadphase for enemy separation. Cell size must exceed the largest
   * separation radius (biggest enemy diameter plus margin) or neighbours in
   * non-adjacent cells would be missed.
   */
  private readonly enemyGrid = new SpatialHash<Enemy>(4);
  private disposed = false;

  /* ------------------------------ scratch ----------------------------- */
  private readonly scratchBox = new THREE.Box3();
  private readonly projectileSweepBox = new THREE.Box3();
  private readonly scratchRay = new THREE.Ray();
  private readonly scratchSphere = new THREE.Sphere();
  /** Scratch reserved for hasLineOfSight so it never borrows v3/v4. */
  private readonly losDir = new THREE.Vector3();
  private readonly losHit = new THREE.Vector3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  /**
   * Brute slam knockback. Must not be v4: the slam fires from inside the enemy
   * AI switch, where v4 is the desired velocity, so writing v4 here steered the
   * brute along the player's knockback vector for the rest of the step.
   */
  private readonly slamDir = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  private readonly projectileGeo = new THREE.IcosahedronGeometry(1, 1);
  /** Aim direction held across a multi-pellet volley. */
  private readonly aimBase = new THREE.Vector3();
  /** Per-pellet / per-link direction, so `forward` survives the volley. */
  private readonly pelletDir = new THREE.Vector3();
  /** Orthonormal basis around the aim ray, used to scatter pellets evenly. */
  private readonly aimRight = new THREE.Vector3();
  private readonly aimUp = new THREE.Vector3();
  /**
   * Player eye position, held for the whole enemy pass. This cannot live in
   * the shared v1..v4 scratch: a seeker detonating mid-pass kills enemies,
   * and killEnemy reuses that scratch to place splitter children.
   */
  private readonly playerCenter = new THREE.Vector3();
  /** Blast scratch, isolated for the same reason. */
  private readonly blastOrigin = new THREE.Vector3();
  private readonly blastRing = new THREE.Vector3();
  private readonly projectileDir = new THREE.Vector3();
  private readonly projectileHit = new THREE.Vector3();
  private readonly projectileBestHit = new THREE.Vector3();
  private readonly childSpawn = new THREE.Vector3();
  private readonly enemyRecoverySpawn = new THREE.Vector3();
  private readonly enemyUpdateSnapshot: Enemy[] = [];
  /** Endpoints while walking an arc chain. */
  private readonly chainFrom = new THREE.Vector3();
  private readonly chainTo = new THREE.Vector3();

  private readonly plasmaMat = new THREE.MeshBasicMaterial({
    color: PLASMA_COLOR,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly orbMat = new THREE.MeshBasicMaterial({
    color: 0x4be0ff,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly bruteOrbMat = new THREE.MeshBasicMaterial({
    color: 0xffa33c,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  constructor(
    canvas: HTMLCanvasElement,
    emit: (snapshot: GameSnapshot) => void,
    arenaId: string = DEFAULT_ARENA_ID,
  ) {
    this.canvas = canvas;
    this.emit = emit;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.pixelRatioFor(this.settings.quality));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    // Light enough that the far side of a 72-unit arena still reads as a place
    // rather than a black wall.
    this.scene.fog = new THREE.FogExp2(0x0a1420, 0.009);

    // Standard materials need something to reflect, otherwise every non-emissive
    // surface in the arena reads as pure black and only the neon trim survives.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.24;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(84, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.arenaId = arenaId;
    this.arena = arenaMeta(arenaId).build();
    this.scene.add(this.arena.group);
    this.applyTheme();
    this.scene.add(this.particles.points);
    this.scene.add(this.tracers.lines);
    this.scene.add(this.rings.group);
    this.scene.add(this.numbers.group);

    this.viewModel = new ViewModel();
    this.camera.add(this.viewModel.group);

    // Operator body, only visible in third person. Squadmates wear the same
    // rig in cyan, so self and team read as the same species while the colour
    // keeps them apart mid-fight.
    this.localRig.group.visible = false;
    this.scene.add(this.localRig.group);

    this.buildDynamicLights();

    this.applyLoadout(STARTER_LOADOUT);

    this.buildComposer();
    this.buildZoneMesh();
    this.resize();
    this.resetRun();
    this.bindEvents();

    this.prewarmShaders();

    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__arena = this;
    }
  }

  /* =================================================================== */
  /* Setup                                                               */
  /* =================================================================== */

  /**
   * Render scale per quality tier. Halving the pixel count is the single
   * biggest win available on an integrated GPU, so `low` pins it to 1.
   */
  private pixelRatioFor(quality: QualityLevel): number {
    const device = window.devicePixelRatio || 1;
    if (quality === 'low') return 1;
    if (quality === 'medium') return Math.min(device, 1.5);
    return Math.min(device, 2);
  }

  /** Scales particle counts so a weak machine emits fewer of them. */
  private get particleBudget(): number {
    if (this.settings.quality === 'low') return 0.45;
    if (this.settings.quality === 'medium') return 0.7;
    return 1;
  }

  private buildComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;

    // `low` skips the composer entirely and renders straight to the canvas:
    // no bloom pass, no extra full-screen buffers.
    if (this.settings.quality === 'low') return;

    const medium = this.settings.quality === 'medium';
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(this.canvas.clientWidth, this.canvas.clientHeight),
      medium ? 0.3 : 0.62,
      medium ? 0.3 : 0.45,
      medium ? 0.95 : 0.85,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloomPass = bloom;
    this.resize();
  }

  private readonly onResize = () => this.resize();

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      // The composer caches the pixel ratio it was built with, and adaptive
      // scaling changes that under it.
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(width, height);
    }
    // Bloom is a blur, so running its pyramid at half the framebuffer costs a
    // quarter of the fill for a difference nobody can see. This has to come
    // after `composer.setSize`, which resizes every pass to full resolution.
    if (this.bloomPass) {
      this.bloomPass.setSize(
        Math.max(1, Math.round((width * ratio) / 2)),
        Math.max(1, Math.round((height * ratio) / 2)),
      );
    }
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindEvents(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  /* =================================================================== */
  /* Input                                                               */
  /* =================================================================== */

  private readonly onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const code = event.code;

    if (code === 'Escape') {
      if (this.phase === 'playing') this.pause();
      return;
    }

    if (
      code === 'Space' ||
      code === 'Tab' ||
      code.startsWith('Arrow') ||
      (code === 'KeyR' && this.phase === 'playing')
    ) {
      event.preventDefault();
    }

    if (this.keys.has(code)) return;
    this.keys.add(code);

    // Upgrades can be taken with 1/2/3 as well as the mouse. Reaching for the
    // pointer right after a wave is the slowest part of the loop, and the
    // cursor has to be re-acquired anyway once the lock drops.
    if (this.phase === 'intermission' && code.startsWith('Digit')) {
      const index = Number.parseInt(code.slice(5), 10) - 1;
      const choice = this.upgradeChoices[index];
      if (choice) this.chooseUpgrade(choice.id);
      return;
    }

    if (this.phase !== 'playing') return;

    if (code === 'Space') this.jumpBuffer = JUMP_BUFFER;
    // Q dashes; Shift is the held sprint (read in updatePlayer). The scroll
    // wheel still cycles weapons, so Q leaving that job costs nothing.
    if (code === 'KeyQ') this.tryDash();
    if (code === 'KeyR') this.tryReload();
    // Number keys address loadout slots, not fixed weapons: which weapon sits
    // in slot 1 is decided before the run.
    if (code.startsWith('Digit')) {
      this.selectSlot(Number.parseInt(code.slice(5), 10) - 1);
    }
    if (code === 'KeyE') this.tryOverdrive();
    if (code === 'KeyV') this.toggleViewMode();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.firing = false;
    this.scoping = false;
    this.releaseCharge();
    if (this.phase === 'playing') this.pause();
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (!this.pointerLocked || this.phase !== 'playing') return;
    // Scoped aim slows with magnification, so a flick covers the same
    // on-screen arc whether or not the scope is up.
    const scale = (0.0021 * this.settings.sensitivity) / this.zoomFactor();
    const dx = event.movementX * scale;
    const dy = event.movementY * scale * (this.settings.invertY ? -1 : 1);
    this.yaw -= dx;
    // Browser movementY is negative when the mouse moves up. A negative
    // pitch is the upward-looking direction for this camera, so the normal
    // (non-inverted) control follows the mouse instead of looking down.
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -MAX_PITCH, MAX_PITCH);
    this.lookDeltaX += dx;
    this.lookDeltaY += dy;
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    if (this.phase !== 'playing') return;
    if (!this.pointerLocked) {
      this.requestLock();
      return;
    }
    if (event.button === 0) this.firing = true;
    // Right mouse scopes every weapon; the plasma lance additionally charges
    // while scoped, so its alt fire keeps working exactly as before.
    if (event.button === 2) {
      this.scoping = true;
      this.tryStartCharge();
    }
  };

  private readonly onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) this.firing = false;
    if (event.button === 2) {
      this.scoping = false;
      this.releaseChargedShot();
    }
  };

  private readonly onWheel = (event: WheelEvent) => {
    if (this.phase !== 'playing') return;
    event.preventDefault();
    this.cycleWeapon();
  };

  private readonly onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked && this.phase === 'playing') this.pause();
  };

  private requestLock(): void {
    const failed = () => {
      if (this.phase === 'playing' && document.pointerLockElement !== this.canvas) {
        this.pause();
      }
    };
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(failed);
    } catch {
      failed();
    }
  }

  /* =================================================================== */
  /* Public control surface                                              */
  /* =================================================================== */

  /**
   * Begins a run. The config is remembered, so `restart()` redeploys with the
   * same loadout and modifiers rather than resetting to the starting kit.
   */
  start(config?: RunConfig): void {
    if (config) {
      this.applyLoadout(config.loadout);
      this.modifiers = [...config.modifiers];
      this.mode = config.mode ?? 'horde';
      this.huntRole = config.huntRole ?? 'hider';
      this.lastConfig = config;
    }
    // Cosmetics are a starting condition like perks: read once, here, so the
    // shop actually shows up in the arena.
    const skin = this.lastConfig?.skin;
    this.localRig.setPalette(skin ?? { body: LOCAL_PALETTE.body, trim: LOCAL_PALETTE.emissive });
    this.runTrail = this.lastConfig?.trail ?? null;

    this.audio.resume();
    this.audio.setVolume(this.settings.volume);
    this.audio.setEffectsVolume(this.settings.effectsVolume);
    this.resetRun();
    this.applyPerks(this.lastConfig?.perks ?? []);
    this.audio.startAmbient();
    this.setPhase('playing');
    this.requestLock();

    // The mode owns what happens next -- horde starts its wave countdown from
    // in here, the others drop rivals in instead.
    this.modeRuntime = new ModeRuntime(
      this.mode,
      this.huntRole,
      this.modeHost(),
      this.remotePlayers.size,
    );
    this.modeRuntime.start();
  }

  /**
   * Shop perks are folded into the run's stats once, at the start, exactly
   * where run modifiers are: they are a starting condition, not a live effect.
   */
  private applyPerks(perks: string[]): void {
    for (const perk of perks) {
      switch (perk) {
        case 'overshield':
          this.stats.maxShield += 40;
          this.shield = this.stats.maxShield;
          break;
        case 'extradash':
          this.stats.maxDashCharges += 1;
          this.dashCharges = this.stats.maxDashCharges;
          break;
        case 'scavenger':
          this.stats.scoreMul *= 1.1;
          break;
        case 'headstart':
          this.score += 500;
          break;
      }
    }
  }

  getNetworkState(): Omit<NetworkPlayerState, 'id' | 'callsign'> & {
    kills: number;
    wave: number;
  } {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.yaw,
      health: Math.max(0, this.health),
      maxHealth: Math.max(1, this.stats.maxHealth),
      dead: this.phase === 'dead' || this.health <= 0,
      kills: this.kills,
      wave: this.wave,
    };
  }

  /**
   * Hits this client resolved against other operators since the last call.
   *
   * The shooter resolves the hit and reports it; the victim applies it to
   * their own health. Draining here means the network layer owns delivery and
   * a dropped request costs at most one poll's worth of damage.
   */
  drainHits(): OutgoingHit[] {
    if (this.pendingHits.length === 0) return [];
    const out = this.pendingHits.slice(0, 32);
    this.pendingHits.length = 0;
    return out;
  }

  /** Applies damage other operators reported against this player. */
  applyIncomingDamage(hits: readonly IncomingDamage[]): void {
    for (const hit of hits) {
      if (this.phase !== 'playing') return;
      const from = this.remotePlayers.get(hit.fromId);
      const source = from
        ? this.v4.copy(from.group.position)
        : this.v4.copy(this.position).add(this.forward);
      const before = this.health;
      this.damagePlayer(hit.damage, source);
      if (before > 0 && this.health <= 0) {
        this.pushFeed(`DOWNED BY ${hit.fromCallsign}`, 'wave');
      }
    }
  }

  /** Remote operators currently in the match, for the mode's rival count. */
  get humanOpponents(): number {
    return this.remotePlayers.size;
  }

  setRemotePlayers(players: NetworkPlayerState[]): void {
    const active = new Set(players.map((player) => player.id));
    for (const [id, remote] of this.remotePlayers) {
      if (active.has(id)) continue;
      this.scene.remove(remote.group);
      remote.rig.dispose();
      this.remotePlayers.delete(id);
      // They were counted as an opponent when the match started, so the mode
      // has to be told or its objective can never be satisfied.
      this.modeRuntime?.onHumanLeft();
    }

    for (const player of players) {
      let remote = this.remotePlayers.get(player.id);
      if (!remote) {
        const rig = new CharacterRig(REMOTE_PALETTE);
        rig.group.position.set(player.x, player.y, player.z);
        rig.group.rotation.y = player.yaw;
        this.scene.add(rig.group);
        remote = {
          id: player.id,
          rig,
          group: rig.group,
          target: new THREE.Vector3(player.x, player.y, player.z),
          yaw: player.yaw,
          callsign: player.callsign,
          health: player.health,
          wireHealth: player.health,
          maxHealth: player.maxHealth,
          dead: player.dead,
          forwardSpeed: 0,
          strafeSpeed: 0,
          verticalSpeed: 0,
          lastX: player.x,
          lastY: player.y,
          lastZ: player.z,
        };
        this.remotePlayers.set(player.id, remote);
      } else {
        remote.target.set(player.x, player.y, player.z);
        remote.yaw = player.yaw;
        remote.callsign = player.callsign;
        remote.maxHealth = player.maxHealth;
        // The owner is authoritative for their own health, but their packet
        // is up to a poll old. Local prediction may already have taken them
        // lower off hits we landed since; keep the lower of the two so the
        // bar never jumps back up between our shot and their acknowledgement.
        // A wire value that has risen is a real heal or a new round, though,
        // and has to be taken at face value or the clamp never lets go.
        const healed = player.health > remote.wireHealth;
        remote.wireHealth = player.health;
        remote.health = player.dead
          ? 0
          : healed
            ? player.health
            : Math.min(remote.health, player.health);
        remote.dead = player.dead || remote.health <= 0;
      }
    }
  }

  /** Swaps between aiming down the weapon and orbiting behind the operator. */
  toggleViewMode(): void {
    this.setViewMode(this.viewMode === 'first' ? 'third' : 'first');
  }

  setViewMode(mode: 'first' | 'third'): void {
    this.viewMode = mode;
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.setPhase('playing');
    this.audio.resume();
    this.requestLock();
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.firing = false;
    this.scoping = false;
    this.releaseCharge();
    this.keys.clear();
    this.setPhase('paused');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  restart(): void {
    this.start();
  }

  quitToMenu(): void {
    this.firing = false;
    this.releaseCharge();
    this.audio.stopAmbient();
    this.resetRun();
    this.setPhase('menu');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  chooseUpgrade(id: string): void {
    if (this.phase !== 'intermission') return;
    // Only ever accept one of the offers currently on screen, otherwise the
    // draft can be bypassed to stack any upgrade in the pool.
    if (!this.upgradeChoices.some((choice) => choice.id === id)) return;
    const taken = this.upgrades.take(id, this.stats);
    if (!taken) return;

    this.ownedUpgrades = [...this.ownedUpgrades, taken];
    this.upgradeChoices = [];

    // Plating and weave immediately top the player back up.
    this.health = Math.min(this.stats.maxHealth, this.health + 30);
    if (taken.id === 'kinetic-plating') this.health = this.stats.maxHealth;
    this.shield = this.stats.maxShield;
    this.dashCharges = this.stats.maxDashCharges;
    this.weapons.forEach((w) => {
      w.ammo = this.magazineOf(w);
      w.reloading = false;
      w.reloadTimer = 0;
    });

    this.audio.upgradePick();
    this.pushFeed(`${taken.name} INSTALLED`, 'buff');
    this.setPhase('playing');
    this.beginCountdown(this.wave + 1, 3);
  }

  applySettings(settings: GameSettings): void {
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = { ...settings };
    this.audio.setVolume(settings.volume);
    this.audio.setEffectsVolume(settings.effectsVolume);
    if (qualityChanged) {
      // A tier change is the one moment a recompile is acceptable, so it is
      // also when the light pool resizes.
      this.renderScale = 1;
      this.scaleCooldown = 3;
      this.buildDynamicLights();
      this.renderer.setPixelRatio(this.pixelRatioFor(settings.quality));
      this.buildComposer();
      // `buildComposer` only resizes when it built something, and dropping to
      // `low` also changes the pixel ratio the renderer has to honour.
      this.resize();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbindEvents();
    this.audio.dispose();

    this.enemies.forEach((e) => {
      this.scene.remove(e.visual.group);
      e.visual.dispose();
    });
    this.enemies.length = 0;

    [...this.projectiles, ...this.projectilePool].forEach((p) => {
      this.scene.remove(p.mesh);
    });

    this.particles.dispose();
    this.tracers.dispose();
    this.rings.dispose();
    this.numbers.dispose();
    this.viewModel.dispose();
    this.remotePlayers.forEach((remote) => {
      this.scene.remove(remote.group);
      remote.rig.dispose();
    });
    this.remotePlayers.clear();
    this.scene.remove(this.localRig.group);
    this.localRig.dispose();
    this.dynamicLights.forEach((light) => this.scene.remove(light));
    this.dynamicLights.length = 0;
    this.arena.dispose();
    disposeEnemyGeometry();

    this.projectileGeo.dispose();
    this.plasmaMat.dispose();
    this.orbMat.dispose();
    this.bruteOrbMat.dispose();

    this.composer?.dispose();
    this.environment.dispose();
    this.renderer.dispose();
  }

  /* =================================================================== */
  /* Run lifecycle                                                       */
  /* =================================================================== */

  private resetRun(): void {
    this.stats = baseStats();
    this.tuning = baseTuning();
    // Modifiers are folded in before anything reads the stats, so the run
    // starts on the handicapped numbers rather than patching them later.
    applyRunModifiers(this.modifiers, this.stats, this.tuning);
    this.upgrades.reset();
    this.ownedUpgrades = [];
    this.upgradeChoices = [];

    this.position.copy(this.arena.playerSpawn);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = -0.05;
    this.grounded = false;
    this.health = this.stats.maxHealth;
    this.shield = this.stats.maxShield;
    this.sinceDamage = 99;
    this.dashCharges = this.stats.maxDashCharges;
    this.dashRecharge = 0;
    this.dashTimer = 0;
    this.iframes = 0;
    this.scoping = false;
    this.scopeBlend = 0;

    this.weapons.forEach((w) => {
      w.ammo = this.magazineOf(w);
      w.cooldown = 0;
      w.reloading = false;
      w.reloadTimer = 0;
      w.charge = 0;
    });
    this.activeWeapon = this.loadout[0]!;
    this.viewModel.setWeapon(this.activeWeapon);
    this.localRig.setWeapon(this.activeWeapon);
    this.viewModel.setCharge(0);

    this.wave = 0;
    this.pendingWave = 1;
    this.waveQueue = [];
    this.waveTotal = 0;
    this.waveKilled = 0;
    this.waveCountdown = 0;
    this.clearing = false;
    this.clearTimer = 0;

    this.score = 0;
    this.chain = 0;
    this.comboTimer = 0;
    this.bestCombo = 1;
    this.kills = 0;
    this.killsByKind = emptyKillTally();
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.runTime = 0;
    this.overdrive = 0;
    this.overdriveTimer = 0;

    this.shake = 0;
    this.slowmo = 1;
    this.slowmoTarget = 1;
    this.feed = [];
    this.announcement = null;
    this.announcementSub = null;

    this.enemies.forEach((e) => {
      this.scene.remove(e.visual.group);
      e.visual.dispose();
    });
    this.enemies.length = 0;
    this.projectiles.forEach((p) => this.retireProjectile(p));
    this.projectiles.length = 0;
    this.tracers.clear();
    this.rings.reset();
    this.numbers.reset();

    // Everything a mode or the mobility style can leave behind. Without this
    // a won run makes the next death report a victory, and a royale run
    // leaves its ring hanging over a horde arena.
    this.modeRuntime = null;
    this.modeVictory = false;
    this.runCredits = 0;
    // Hits resolved in the previous run must never be reported into the next
    // one -- the target ids are still valid, so they would land.
    this.pendingHits.length = 0;
    for (const remote of this.remotePlayers.values()) {
      remote.health = remote.maxHealth;
      remote.wireHealth = remote.maxHealth;
      remote.dead = false;
    }
    if (this.zoneMesh) this.zoneMesh.visible = false;
    this.setLightLevel(1);
    this.playerArmed = true;
    this.sliding = false;
    this.slideTimer = 0;
    this.slideCrouch = 0;
    this.boostFuel = 1;
    this.boostTimer = 0;
  }

  /* =================================================================== */
  /* Modes                                                               */
  /* =================================================================== */

  /**
   * The only surface a mode is allowed to touch. Modes decide what happens;
   * the engine decides how. Nothing here hands out a mesh, a material or the
   * physics state, so a new set of rules can never quietly become a second
   * copy of the simulation.
   */
  private modeHost(): ModeHost {
    return {
      playerRadius: () => Math.hypot(this.position.x, this.position.z),
      playerSpeed: () => Math.hypot(this.velocity.x, this.velocity.z),
      playerFiring: () => this.firing,
      nearestEnemyDistance: () => {
        let best = Infinity;
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          const distance = enemy.position.distanceTo(this.position);
          if (distance < best) best = distance;
        }
        return best;
      },
      operatorCount: () =>
        this.enemies.reduce(
          (n, e) => (e.alive && e.config.kind === 'operator' ? n + 1 : n),
          0,
        ),
      spawnOperator: (minDistance) => this.spawnOperator(minDistance),
      eliminateRandomOperator: () => {
        const live = this.enemies.filter(
          (e) => e.alive && e.config.kind === 'operator',
        );
        // Never take the rival the player is currently fighting: an opponent
        // vanishing mid-fight reads as a bug, not as someone else getting them.
        const distant = live.filter(
          (e) => e.position.distanceTo(this.position) > 30,
        );
        const pick = (distant.length > 0 ? distant : live)[0];
        if (!pick) return false;
        this.killEnemy(pick, false);
        return true;
      },
      damagePlayer: (amount) => {
        // Comes from everywhere at once, so the indicator points outward
        // rather than at a spot the player could turn to face.
        this.zoneHurtFrom.set(this.position.x * 2, this.position.y, this.position.z * 2);
        this.damagePlayer(amount, this.zoneHurtFrom);
      },
      announce: (title, sub, seconds) =>
        this.setAnnouncement(title, sub ?? '', seconds),
      feed: (text) => this.pushFeed(text, 'wave'),
      finishRun: (victory) => this.finishRun(victory),
      resetRound: () => this.resetRound(),
      setZoneRadius: (radius) => this.setZoneRadius(radius),
      setLightLevel: (level) => this.setLightLevel(level),
      setPlayerArmed: (armed) => {
        this.playerArmed = armed;
        this.viewModel.group.visible = armed;
      },
      startWaveFlow: () => this.beginCountdown(1, 2.2),
    };
  }

  private spawnOperator(minDistance: number): boolean {
    const at = this.v1;
    let found = false;
    // A few attempts, because a rival landing on top of the player is worse
    // than one that arrives from further out.
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!this.findSpawnPoint('operator', at)) continue;
      found = true;
      if (at.distanceTo(this.position) >= minDistance) break;
    }
    // The caller counts opponents, so a failed placement has to be told apart
    // from a successful one -- otherwise a royale can never be won.
    if (!found) return false;
    this.createEnemy('operator', at, 0);
    this.rings.spawn(
      this.v3.set(at.x, 0.06, at.z),
      ENEMY_CONFIG.operator.color,
      0.4,
      3.4,
      0.85,
      true,
    );
    return true;
  }

  /** Wipes the field and puts the player back on the spawn, for a new round. */
  private resetRound(): void {
    this.enemies.forEach((e) => {
      this.scene.remove(e.visual.group);
      e.visual.dispose();
    });
    this.enemies.length = 0;
    this.projectiles.forEach((p) => this.retireProjectile(p));
    this.projectiles.length = 0;

    this.position.copy(this.arena.playerSpawn);
    this.velocity.set(0, 0, 0);
    this.health = this.stats.maxHealth;
    this.shield = this.stats.maxShield;
    this.dashCharges = this.stats.maxDashCharges;
    this.boostFuel = 1;
    // A moment of grace so the next round does not open with a free hit.
    this.iframes = 1.6;
    this.weapons.forEach((w) => {
      w.ammo = this.magazineOf(w);
      w.cooldown = 0;
      w.reloading = false;
      w.reloadTimer = 0;
      w.charge = 0;
    });
  }

  /** Ends the run. Victory and defeat share a screen, parted by one flag. */
  private finishRun(victory: boolean): void {
    this.modeVictory = victory;
    if (!victory) {
      this.die();
      return;
    }
    if (this.phase === 'dead') return;
    this.firing = false;
    this.scoping = false;
    this.releaseCharge();
    this.audio.stopAmbient();
    this.audio.waveClear();
    this.slowmoTarget = 0.4;
    this.setPhase('dead');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /**
   * Built once at construction, not when a royale starts: a material created
   * mid-run costs a shader compile, which is exactly the hitch the prewarm
   * pass exists to prevent.
   */
  private buildZoneMesh(): void {
    const geometry = new THREE.CylinderGeometry(1, 1, 30, 72, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff3d71,
      transparent: true,
      opacity: 0.14,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.zoneMesh = new THREE.Mesh(geometry, material);
    this.zoneMesh.position.y = 14;
    this.zoneMesh.frustumCulled = false;
    this.zoneMesh.visible = false;
    this.scene.add(this.zoneMesh);
  }

  private setZoneRadius(radius: number): void {
    if (!this.zoneMesh) return;
    if (radius <= 0) {
      this.zoneMesh.visible = false;
      return;
    }
    this.zoneMesh.visible = true;
    this.zoneMesh.scale.set(radius, 1, radius);
  }

  /**
   * Blackout runs the arena dark. Baselines are captured once so repeated
   * calls cannot compound, and only arena lights are touched -- the dynamic
   * effect pool rewrites its own intensities every frame.
   */
  private setLightLevel(level: number): void {
    if (this.lightBaselines.size === 0) {
      this.arena.group.traverse((object) => {
        const light = object as THREE.Light;
        if (light.isLight) this.lightBaselines.set(light.uuid, light.intensity);
      });
      this.baseEnvIntensity = this.scene.environmentIntensity;
    }
    this.arena.group.traverse((object) => {
      const base = this.lightBaselines.get(object.uuid);
      if (base !== undefined) (object as THREE.Light).intensity = base * level;
    });
    this.scene.environmentIntensity =
      this.baseEnvIntensity * Math.max(0.12, level);
  }

  private setPhase(next: GamePhase): void {
    if (this.phase === next) return;
    this.phase = next;
    // The upgrade draft is a mouse screen. Dropping the lock here rather than
    // at each call site is why the cards became reliably clickable: the
    // intermission used to be entered from the wave loop with the pointer
    // still captured, so the first click only released the lock.
    if (next === 'intermission') {
      this.firing = false;
      this.scoping = false;
      this.keys.clear();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    this.publish();
  }

  private beginCountdown(wave: number, seconds: number): void {
    this.pendingWave = wave;
    this.waveCountdown = seconds;
    this.setAnnouncement(
      `WAVE ${wave}`,
      wave === 1 ? 'HOSTILES INBOUND' : 'BRACE FOR CONTACT',
      2.4,
    );
  }

  private startWave(wave: number): void {
    this.wave = wave;
    this.waveQueue = rollWave(
      wave,
      this.tuning.waveBudgetMul,
      this.modeRuntime?.infected ? 'infected' : 'construct',
    );
    this.waveTotal = this.waveQueue.length;
    this.waveKilled = 0;
    this.spawnTimer = 0;
    this.clearing = false;
    this.audio.waveStart(wave);
    this.audio.setIntensity(Math.min(1, (wave - 1) / 11));
    this.pushFeed(`WAVE ${wave} ENGAGED`, 'wave');
  }

  private completeWave(): void {
    this.clearing = true;
    this.clearTimer = 1.7;
    this.slowmoTarget = 0.32;
    this.audio.waveClear();
    this.setAnnouncement('WAVE CLEARED', 'SELECT AN UPGRADE', 1.7);
    this.pushFeed(`WAVE ${this.wave} CLEARED`, 'wave');
  }

  private die(): void {
    if (this.phase === 'dead') return;
    // A duel turns death into a lost round rather than a lost run, so ask the
    // mode before writing the run off.
    if (this.modeRuntime && this.modeRuntime.onPlayerDied() === 'round') return;
    this.firing = false;
    this.scoping = false;
    this.releaseCharge();
    this.audio.stopAmbient();
    this.audio.gameOver();
    this.explosion(
      this.v1.copy(this.position).setY(this.position.y + 1),
      2.4,
      0xff2d78,
    );
    this.shake = 1.4;
    this.slowmoTarget = 0.35;
    this.setPhase('dead');
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /* =================================================================== */
  /* Weapons                                                             */
  /* =================================================================== */

  private get weapon(): WeaponRuntime {
    return this.weapons.find((w) => w.id === this.activeWeapon) ?? this.weapons[0]!;
  }

  private magazineOf(weapon: WeaponRuntime): number {
    return Math.max(1, Math.round(weapon.baseMagazine * this.stats.magazineMul));
  }

  /** Current magnification: 1 unscoped, gliding to the active weapon's zoom.
   *  Safe before a loadout exists (menu), when it reads as no scope. */
  private zoomFactor(): number {
    const zoom = this.weapons.length > 0 ? this.weapon.zoom : 1;
    return 1 + (zoom - 1) * this.scopeBlend;
  }

  /**
   * Rebuilds the carried weapons from a loadout. Unknown or duplicated ids are
   * dropped and an empty loadout falls back to the starting kit, so a stale
   * value in storage can never leave the player unarmed.
   */
  private applyLoadout(loadout: readonly WeaponId[]): void {
    const ids: WeaponId[] = [];
    for (const id of loadout) {
      if (ids.length >= LOADOUT_SLOTS) break;
      if (ids.includes(id)) continue;
      if (!WEAPONS.some((w) => w.id === id)) continue;
      ids.push(id);
    }
    for (const id of STARTER_LOADOUT) {
      if (ids.length >= LOADOUT_SLOTS) break;
      if (!ids.includes(id)) ids.push(id);
    }

    this.loadout = ids;
    this.weapons = ids.map(createWeapon);
    this.activeWeapon = ids[0]!;
    this.viewModel.setWeapon(this.activeWeapon);
    this.localRig.setWeapon(this.activeWeapon);
    this.viewModel.setCharge(0);
  }

  private selectSlot(index: number): void {
    const weapon = this.weapons[index];
    if (weapon) this.swapWeapon(weapon.id);
  }

  private swapWeapon(id: WeaponId): void {
    if (this.activeWeapon === id) return;
    this.releaseCharge();
    this.activeWeapon = id;
    this.viewModel.setWeapon(id);
    this.localRig.setWeapon(id);
    this.viewModel.setCharge(0);
    this.audio.reload();
    // A held scope follows the swap, and no new mousedown will arrive while
    // the button stays down -- so landing on the plasma lance must begin its
    // charge right here or RMB-charge silently stops working after a swap.
    if (this.scoping) this.tryStartCharge();
  }

  /**
   * Spool up the plasma lance if its state allows it. Shared by the RMB press
   * and by a weapon swap that lands on the lance while the scope button is
   * already held.
   */
  private tryStartCharge(): void {
    if (this.activeWeapon !== 'plasma' || this.charging) return;
    // Do not let a charge start during a reload or cooldown; it used to be
    // possible to spool up mid-reload and release the instant it finished.
    if (this.weapon.reloading || this.weapon.cooldown > 0) return;
    this.charging = true;
    this.audio.startCharge();
  }

  private cycleWeapon(step = 1): void {
    const index = this.weapons.findIndex((w) => w.id === this.activeWeapon);
    const next =
      (index + step + this.weapons.length) % this.weapons.length;
    this.swapWeapon(this.weapons[next]!.id);
  }

  private tryReload(): void {
    const w = this.weapon;
    if (w.reloading || w.ammo >= this.magazineOf(w)) return;
    if (this.overdriveTimer > 0) return;
    w.reloading = true;
    w.reloadTimer = w.baseReload * this.stats.reloadMul;
    this.audio.reload();
  }

  private releaseCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    this.weapon.charge = 0;
    this.viewModel.setCharge(0);
    this.audio.stopCharge();
  }

  private releaseChargedShot(): void {
    if (!this.charging) return;
    const w = this.weapon;
    const charge = w.charge;
    this.charging = false;
    w.charge = 0;
    this.viewModel.setCharge(0);
    this.audio.stopCharge();

    if (charge <= 0.12 || this.phase !== 'playing') return;
    // The charged path used to call fire() directly, which skipped the reload
    // and cooldown gates the automatic path enforces -- holding right-click
    // through a reload fired anyway, and faster than the weapon's interval.
    if (w.reloading || w.cooldown > 0) return;

    const rate = this.stats.fireRateMul * (this.overdriveActive ? 1.55 : 1);
    w.cooldown = w.baseInterval / rate;
    this.fire(charge);
  }

  private tryOverdrive(): void {
    if (this.overdrive < 1 || this.overdriveTimer > 0) return;
    this.overdrive = 0;
    this.overdriveTimer = OVERDRIVE_DURATION;
    this.audio.overdriveStart();
    this.setAnnouncement('OVERDRIVE', 'SYSTEMS UNCHAINED', 1.6);
    this.pushFeed('OVERDRIVE ONLINE', 'buff');
    this.shake = 0.7;
    this.rings.spawn(
      this.v1.copy(this.position).setY(this.position.y + 0.1),
      0xffd166,
      1,
      22,
      0.7,
      true,
    );
    this.weapons.forEach((w) => {
      w.reloading = false;
      w.reloadTimer = 0;
      w.ammo = this.magazineOf(w);
    });
  }

  private get overdriveActive(): boolean {
    return this.overdriveTimer > 0;
  }

  /**
   * Orthonormal basis around an aim direction. Spreading along it keeps the
   * cone circular no matter where the player is looking; perturbing raw x/y/z
   * biases the pattern as the pitch approaches vertical.
   */
  private aimBasis(direction: THREE.Vector3): void {
    this.aimRight.set(direction.z, 0, -direction.x);
    if (this.aimRight.lengthSq() < 1e-6) this.aimRight.set(1, 0, 0);
    this.aimRight.normalize();
    this.aimUp.crossVectors(direction, this.aimRight).normalize();
  }

  private fire(charge: number): void {
    // Blackout hiders have no weapon at all -- the mode took it away.
    if (!this.playerArmed) return;
    const w = this.weapon;
    const infinite = this.overdriveActive;

    if (!infinite && w.ammo <= 0) {
      this.audio.dryFire();
      this.tryReload();
      return;
    }
    if (!infinite) w.ammo -= 1;

    this.shotsFired += 1;
    const damageMul = this.stats.damageMul * (infinite ? 1.75 : 1);
    // Scoping tightens the cone: a fully scoped shot keeps 30% of its spread.
    const steady = 1 - 0.7 * this.scopeBlend;

    this.camera.getWorldDirection(this.forward);
    if (this.viewMode === 'third') {
      // The third-person camera looks straight back through the eye point, so
      // a shot leaving the head travels exactly along the crosshair ray. The
      // muzzle would be wrong here: it hangs off the hidden viewmodel behind
      // the camera, metres away from the visible body.
      this.v4.copy(this.position);
      this.v4.y += EYE_HEIGHT;
    } else {
      this.viewModel.muzzleWorld(this.v4);
    }

    switch (w.id) {
      case 'pulse': {
        const spread = w.spread * steady * (this.grounded ? 1 : 1.9);
        this.forward.x += (Math.random() - 0.5) * spread;
        this.forward.y += (Math.random() - 0.5) * spread;
        this.forward.z += (Math.random() - 0.5) * spread;
        this.forward.normalize();

        if (this.hitscan(this.v4, this.forward, w.baseDamage * damageMul)) {
          this.shotsHit += 1;
        }
        this.audio.pulseShot(infinite);
        this.viewModel.kick(1, PULSE_COLOR);
        this.localRig.fire(1);
        this.recoilPitch += 0.016 + Math.random() * 0.006;
        this.recoilYaw += (Math.random() - 0.5) * 0.011;
        this.shake = Math.min(this.shake + 0.045, 0.5);
        break;
      }

      case 'scatter': {
        // One volley counts as one shot for accuracy, however many pellets
        // connect, otherwise the stat reads above 100%.
        const spread = w.spread * steady * (this.grounded ? 1 : 1.5);
        this.aimBase.copy(this.forward);
        this.aimBasis(this.aimBase);
        let connected = false;
        for (let i = 0; i < 9; i++) {
          this.pelletDir
            .copy(this.aimBase)
            .addScaledVector(this.aimRight, (Math.random() - 0.5) * spread * 2)
            .addScaledVector(this.aimUp, (Math.random() - 0.5) * spread * 2)
            .normalize();
          const hit = this.hitscan(
            this.v4,
            this.pelletDir,
            w.baseDamage * damageMul,
            { falloff: SCATTER_FALLOFF, tracerColor: SCATTER_COLOR },
          );
          connected = connected || hit;
        }
        if (connected) this.shotsHit += 1;
        this.audio.plasmaShot(0.24);
        this.viewModel.kick(2.2, SCATTER_COLOR);
        this.localRig.fire(1.6);
        this.recoilPitch += 0.062 + Math.random() * 0.01;
        this.recoilYaw += (Math.random() - 0.5) * 0.026;
        this.shake = Math.min(this.shake + 0.2, 0.75);
        break;
      }

      case 'arc': {
        const spread = w.spread * steady * (this.grounded ? 1 : 1.6);
        this.aimBasis(this.forward);
        this.pelletDir
          .copy(this.forward)
          .addScaledVector(this.aimRight, (Math.random() - 0.5) * spread)
          .addScaledVector(this.aimUp, (Math.random() - 0.5) * spread)
          .normalize();
        if (this.arcChain(this.v4, this.pelletDir, w.baseDamage * damageMul)) {
          this.shotsHit += 1;
        }
        this.audio.pulseShot(infinite);
        this.viewModel.kick(0.7, ARC_COLOR);
        this.localRig.fire(0.7);
        this.recoilPitch += 0.009 + Math.random() * 0.004;
        this.recoilYaw += (Math.random() - 0.5) * 0.014;
        this.shake = Math.min(this.shake + 0.03, 0.4);
        break;
      }

      case 'plasma': {
        const power = 1 + charge * 1.9;
        this.spawnProjectile({
          origin: this.v4,
          direction: this.forward,
          speed: 52 + charge * 26,
          damage: w.baseDamage * damageMul * power,
          radius: 0.32 + charge * 0.42,
          splash: (3.1 + charge * 2.4) * this.stats.splashMul,
          fromPlayer: true,
          charge,
          material: this.plasmaMat,
          life: 3,
        });
        this.audio.plasmaShot(charge);
        this.viewModel.kick(1.8 + charge * 1.6, PLASMA_COLOR);
        this.localRig.fire(1.4 + charge);
        this.recoilPitch += 0.05 + charge * 0.05;
        this.recoilYaw += (Math.random() - 0.5) * 0.02;
        this.shake = Math.min(this.shake + 0.16 + charge * 0.18, 0.8);
        break;
      }
    }

    if (!infinite && w.ammo <= 0) this.tryReload();
  }

  /* =================================================================== */
  /* Player versus player                                                */
  /* =================================================================== */

  /** True when the current mode lets operators shoot each other. */
  private get pvpEnabled(): boolean {
    return MODE_TUNING[this.mode].pvp;
  }

  /** Remote operators that are valid targets right now. */
  private *pvpTargets(): Generator<RemotePlayer> {
    if (!this.pvpEnabled) return;
    for (const remote of this.remotePlayers.values()) {
      if (!remote.dead) yield remote;
    }
  }

  /**
   * Ray against a remote operator: a body capsule approximated by a sphere,
   * plus a smaller head sphere that counts as a crit.
   *
   * Uses the interpolated render position rather than the last packet, so
   * what you shoot at is what you see.
   */
  private remoteRayHit(
    remote: RemotePlayer,
    origin: THREE.Vector3,
    worldDistance: number,
  ): { distance: number; crit: boolean; point: THREE.Vector3 } | null {
    const base = remote.group.position;

    // Both spheres are tested independently, and the nearer one wins.
    // Gating the head on a body hit silently drops the most common shot in
    // the game: standing eye height (1.68) sits above the top of the body
    // sphere (1.55), so a level shot at a rival grazes only the head. That
    // read in play as "bullets do nothing to other players".
    this.scratchSphere.center.set(base.x, base.y + REMOTE_BODY_Y, base.z);
    this.scratchSphere.radius = REMOTE_BODY_RADIUS;
    const bodyHit = this.scratchRay.intersectSphere(
      this.scratchSphere,
      this.remoteHitAt,
    );
    const bodyDistance = bodyHit ? bodyHit.distanceTo(origin) : Infinity;
    if (bodyHit) this.remoteBodyAt.copy(bodyHit);

    this.scratchSphere.center.set(base.x, base.y + REMOTE_HEAD_Y, base.z);
    this.scratchSphere.radius = REMOTE_HEAD_RADIUS;
    const headHit = this.scratchRay.intersectSphere(
      this.scratchSphere,
      this.remoteHitAt,
    );
    const headDistance = headHit ? headHit.distanceTo(origin) : Infinity;

    const crit = headDistance <= bodyDistance;
    const distance = crit ? headDistance : bodyDistance;
    if (!Number.isFinite(distance) || distance > worldDistance) return null;

    return {
      distance,
      crit,
      point: (crit ? this.remoteHitAt : this.remoteBodyAt).clone(),
    };
  }

  /**
   * Registers a hit this client landed on another operator.
   *
   * Damage is predicted locally so the hit marker, the damage number and the
   * health bar all react on the frame you pulled the trigger, and it is also
   * queued for the server so the victim can apply it to their own health.
   * The victim stays the only writer of their health -- prediction here only
   * ever runs it down early, never brings it back up.
   */
  private damageRemote(
    remote: RemotePlayer,
    amount: number,
    crit: boolean,
    point: THREE.Vector3,
  ): void {
    if (remote.dead || amount <= 0) return;
    const dealt = crit ? amount * this.stats.critMul : amount;

    this.pendingHits.push({
      targetId: remote.id,
      damage: dealt,
      headshot: crit,
    });

    remote.health = Math.max(0, remote.health - dealt);

    this.numbers.spawn(
      this.remoteHitAt.copy(point).setY(point.y + 0.4),
      dealt,
      crit,
    );
    this.particles.burst(point, {
      count: crit ? 16 : 8,
      color: crit ? 0xffd166 : 0xff5f8f,
      speed: crit ? 11 : 7,
      size: 0.17,
      life: 0.32,
      gravity: -12,
      drag: 2.4,
    });

    // Same hit marker path the enemies use, so a hit on a player reads
    // exactly like a hit on anything else.
    this.markerId += 1;
    this.markerKind = crit ? 'crit' : 'hit';
    this.audio.hit(crit);
    this.overdrive = Math.min(
      1,
      this.overdrive + (dealt / 1500) * this.stats.overdriveGainMul,
    );

    if (remote.health <= 0) {
      remote.dead = true;
      this.kills += 1;
      this.chain += 1;
      this.comboTimer = this.stats.comboWindow;
      this.score += Math.round(
        420 * this.currentCombo() * this.stats.scoreMul *
          MODE_TUNING[this.mode].scoreMul,
      );
      this.runCredits += 12;
      this.audio.kill();
      this.pushFeed(`${remote.callsign} ELIMINATED`, 'wave');
      this.setAnnouncement('OPERATOR DOWN', remote.callsign, 1.4);
      this.explosion(
        this.remoteHitAt.copy(remote.group.position).setY(
          remote.group.position.y + 1,
        ),
        1.8,
        0xff2d78,
      );
      this.modeRuntime?.onOperatorKilled(true);
    }
  }

  /** Returns true when the shot struck at least one enemy. */
  private hitscan(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number,
    options?: {
      /** Linear damage falloff between two ranges, down to `min`. */
      falloff?: { start: number; end: number; min: number };
      tracerColor?: number;
    },
  ): boolean {
    this.scratchRay.set(origin, direction);

    // Nearest world surface caps the shot.
    let worldDistance = 220;
    for (const box of this.arena.colliders) {
      const point = this.scratchRay.intersectBox(box, this.v1);
      if (!point) continue;
      const d = point.distanceTo(origin);
      if (d < worldDistance) worldDistance = d;
    }

    interface Candidate {
      enemy: Enemy | null;
      remote: RemotePlayer | null;
      distance: number;
      crit: boolean;
      point: THREE.Vector3;
    }
    const candidates: Candidate[] = [];

    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.spawnTimer > 0) continue;

      this.scratchSphere.set(enemy.position, enemy.radius);
      const hit = this.scratchRay.intersectSphere(this.scratchSphere, this.v2);
      if (!hit) continue;
      const distance = hit.distanceTo(origin);
      if (distance > worldDistance) continue;

      this.scratchSphere.set(
        enemy.position,
        enemy.config.coreRadius * enemy.scale,
      );
      const crit = this.scratchRay.intersectsSphere(this.scratchSphere);
      candidates.push({ enemy, remote: null, distance, crit, point: hit.clone() });
    }

    // Other operators are targets in every mode except co-op horde, where a
    // squadmate is on your side and shots pass straight through them.
    for (const remote of this.pvpTargets()) {
      const hit = this.remoteRayHit(remote, origin, worldDistance);
      if (!hit) continue;
      candidates.push({
        enemy: null,
        remote,
        distance: hit.distance,
        crit: hit.crit,
        point: hit.point,
      });
    }

    candidates.sort((a, b) => a.distance - b.distance);
    const maxTargets = 1 + this.stats.pierce;
    const struck = candidates.slice(0, maxTargets);

    const end = this.v3
      .copy(origin)
      .addScaledVector(
        direction,
        struck.length > 0
          ? Math.max(struck[struck.length - 1]!.distance, 1)
          : worldDistance,
      );
    this.tracers.add(
      origin,
      end,
      options?.tracerColor ??
        (this.overdriveActive
          ? 0xffd166
          : (this.runTrail ?? PULSE_COLOR)),
    );

    if (struck.length === 0) {
      if (worldDistance < 220) {
        this.particles.burst(end, {
          count: 7,
          color: 0x8fd8ff,
          speed: 5,
          size: 0.14,
          life: 0.3,
          gravity: -8,
        });
      }
      return false;
    }

    const range = options?.falloff;
    struck.forEach((c, index) => {
      const pierceFalloff = index === 0 ? 1 : 0.7;
      const rangeFalloff = range
        ? THREE.MathUtils.clamp(
            1 - (c.distance - range.start) / (range.end - range.start),
            range.min,
            1,
          )
        : 1;
      const dealt = damage * pierceFalloff * rangeFalloff;
      if (c.enemy) this.damageEnemy(c.enemy, dealt, c.crit, c.point);
      else if (c.remote) this.damageRemote(c.remote, dealt, c.crit, c.point);
    });
    return true;
  }

  /**
   * Arc tether: grabs a primary target along the aim ray, then walks outward
   * to nearby enemies, losing damage on every jump. Firing into a cluster is
   * the point -- against a lone target it is the weakest gun in the kit.
   */
  private arcChain(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number,
  ): boolean {
    this.scratchRay.set(origin, direction);

    let worldDistance = 220;
    for (const box of this.arena.colliders) {
      const point = this.scratchRay.intersectBox(box, this.v1);
      if (!point) continue;
      const d = point.distanceTo(origin);
      if (d < worldDistance) worldDistance = d;
    }

    // The tether treats enemies and rival operators as the same kind of node
    // so a chain can walk from a zombie to a player and back.
    type ChainNode = { enemy: Enemy; remote: null } | { enemy: null; remote: RemotePlayer };
    const nodes: ChainNode[] = [];
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.spawnTimer > 0) continue;
      nodes.push({ enemy, remote: null });
    }
    for (const remote of this.pvpTargets()) nodes.push({ enemy: null, remote });

    const positionOf = (node: ChainNode): THREE.Vector3 =>
      node.enemy ? node.enemy.position : node.remote.group.position;

    // Slightly generous pick radius: the tether should feel like it grabs,
    // not like it snipes.
    let current: ChainNode | null = null;
    let best = Infinity;
    for (const node of nodes) {
      if (node.enemy) {
        this.scratchSphere.set(node.enemy.position, node.enemy.radius * 1.3);
      } else {
        const base = node.remote.group.position;
        this.scratchSphere.center.set(base.x, base.y + REMOTE_BODY_Y, base.z);
        this.scratchSphere.radius = REMOTE_BODY_RADIUS * 1.3;
      }
      const hit = this.scratchRay.intersectSphere(this.scratchSphere, this.v2);
      if (!hit) continue;
      const distance = hit.distanceTo(origin);
      if (distance > worldDistance || distance >= best) continue;
      best = distance;
      current = node;
    }

    if (!current) {
      this.chainTo.copy(origin).addScaledVector(direction, worldDistance);
      this.tracers.add(origin, this.chainTo, ARC_COLOR);
      return false;
    }

    const struck: ChainNode[] = [];
    this.chainFrom.copy(origin);

    for (let link = 0; link < ARC_CHAIN_MAX && current; link++) {
      const here = positionOf(current);
      this.chainTo.copy(here);
      this.tracers.add(this.chainFrom, this.chainTo, ARC_COLOR);
      struck.push(current);
      // Damage is applied after the whole chain is resolved, so a kill part
      // way along cannot cut the tether short.
      this.chainFrom.copy(here);

      let next: ChainNode | null = null;
      let nextDistSq = ARC_CHAIN_RANGE * ARC_CHAIN_RANGE;
      for (const other of nodes) {
        if (struck.includes(other)) continue;
        const there = positionOf(other);
        const dx = there.x - here.x;
        const dy = there.y - here.y;
        const dz = there.z - here.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= nextDistSq) continue;
        if (!this.hasLineOfSight(here, there)) continue;
        nextDistSq = distSq;
        next = other;
      }
      current = next;
    }

    struck.forEach((node, index) => {
      const dealt = damage * Math.pow(0.78, index);
      if (node.enemy) {
        this.damageEnemy(node.enemy, dealt, false, node.enemy.position);
      } else {
        this.damageRemote(node.remote, dealt, false, node.remote.group.position);
      }
    });
    return true;
  }

  /* =================================================================== */
  /* Projectiles                                                         */
  /* =================================================================== */

  private spawnProjectile(options: {
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
  }): void {
    let projectile = this.projectilePool.pop();
    if (!projectile) {
      const mesh = new THREE.Mesh(this.projectileGeo, options.material);
      mesh.frustumCulled = false;
      // No light of its own -- the shared pool in `updateDynamicLights`
      // decides which bolts are worth lighting the room with.
      projectile = {
        mesh,
        position: new THREE.Vector3(),
        prevPosition: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        damage: 0,
        radius: 0.3,
        splash: 0,
        fromPlayer: true,
        charge: 0,
        active: true,
      };
    }

    projectile.mesh.material = options.material;
    projectile.mesh.scale.setScalar(options.radius);
    projectile.position.copy(options.origin);
    projectile.prevPosition.copy(options.origin);
    projectile.mesh.position.copy(options.origin);
    projectile.velocity.copy(options.direction).multiplyScalar(options.speed);
    projectile.life = options.life;
    projectile.damage = options.damage;
    projectile.radius = options.radius;
    projectile.splash = options.splash;
    projectile.fromPlayer = options.fromPlayer;
    projectile.charge = options.charge;
    projectile.active = true;

    this.scene.add(projectile.mesh);
    this.projectiles.push(projectile);
  }

  private retireProjectile(projectile: Projectile): void {
    projectile.active = false;
    this.scene.remove(projectile.mesh);
    this.projectilePool.push(projectile);
  }

  private updateProjectiles(dt: number): void {
    const playerCenter = this.playerCenter
      .copy(this.position)
      .setY(this.position.y + PLAYER_HEIGHT * 0.55);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      p.life -= dt;

      p.prevPosition.copy(p.position);
      const step = this.projectileDir.copy(p.velocity).multiplyScalar(dt);
      p.position.add(step);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 7;

      let detonated = false;
      const stepLength = step.length();
      let hitDistance = stepLength;
      this.projectileBestHit.copy(p.position);
      if (stepLength > COLLISION_EPSILON) {
        this.projectileDir.divideScalar(stepLength);
        this.scratchRay.set(p.prevPosition, this.projectileDir);

        // Ground plane.
        if (p.prevPosition.y > p.radius && p.position.y <= p.radius) {
          const distance =
            ((p.prevPosition.y - p.radius) /
              (p.prevPosition.y - p.position.y)) *
            stepLength;
          hitDistance = distance;
          this.projectileBestHit
            .copy(p.prevPosition)
            .addScaledVector(this.projectileDir, distance);
          detonated = true;
        }

        // Sweep the projectile sphere through world geometry.
        for (const box of this.arena.colliders) {
          this.projectileSweepBox.copy(box).expandByScalar(p.radius);
          const point = this.scratchRay.intersectBox(
            this.projectileSweepBox,
            this.projectileHit,
          );
          if (!point) continue;
          const distance = point.distanceTo(p.prevPosition);
          if (distance <= hitDistance + COLLISION_EPSILON) {
            hitDistance = distance;
            this.projectileBestHit.copy(point);
            detonated = true;
          }
        }

        // Actor collision.
        if (p.fromPlayer) {
          for (const enemy of this.enemies) {
            if (!enemy.alive || enemy.spawnTimer > 0) continue;
            this.scratchSphere.set(enemy.position, enemy.radius + p.radius);
            const point = this.scratchRay.intersectSphere(
              this.scratchSphere,
              this.projectileHit,
            );
            if (!point) continue;
            const distance = point.distanceTo(p.prevPosition);
            if (distance <= hitDistance + COLLISION_EPSILON) {
              hitDistance = distance;
              this.projectileBestHit.copy(point);
              detonated = true;
            }
          }
          // Rival operators stop a plasma bolt too. The damage itself comes
          // from the splash in `detonate`, so this only has to make the bolt
          // stop at the body rather than sail through it.
          for (const remote of this.pvpTargets()) {
            const base = remote.group.position;
            this.scratchSphere.center.set(
              base.x,
              base.y + REMOTE_BODY_Y,
              base.z,
            );
            this.scratchSphere.radius = REMOTE_BODY_RADIUS + p.radius;
            const point = this.scratchRay.intersectSphere(
              this.scratchSphere,
              this.projectileHit,
            );
            if (!point) continue;
            const distance = point.distanceTo(p.prevPosition);
            if (distance <= hitDistance + COLLISION_EPSILON) {
              hitDistance = distance;
              this.projectileBestHit.copy(point);
              detonated = true;
            }
          }
        } else {
          this.scratchSphere.set(playerCenter, 0.75 + p.radius);
          const point = this.scratchRay.intersectSphere(
            this.scratchSphere,
            this.projectileHit,
          );
          if (point) {
            const distance = point.distanceTo(p.prevPosition);
            if (distance <= hitDistance + COLLISION_EPSILON) {
              hitDistance = distance;
              this.projectileBestHit.copy(point);
              this.damagePlayer(p.damage, point);
              detonated = true;
            }
          }
        }
      }

      if (detonated) p.position.copy(this.projectileBestHit);

      if (detonated || p.life <= 0) {
        // Plasma should not silently disappear at maximum range.
        if (detonated || p.fromPlayer) this.detonate(p);
        this.projectiles.splice(i, 1);
        this.retireProjectile(p);
      }
    }
  }

  private detonate(p: Projectile): void {
    const color = p.fromPlayer ? PLASMA_COLOR : 0x4be0ff;
    const scale = p.fromPlayer ? 0.9 + p.charge : 0.6;
    this.explosion(p.position, scale, color);

    if (!p.fromPlayer || p.splash <= 0) return;

    this.shotsHit += 1;
    // Collect first, same as the seeker blast: damaging can kill a splitter,
    // which splices this array and appends its children. Iterating it live both
    // skipped shifted enemies and let newborns take a blast that predates them.
    const caught: Enemy[] = [];
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.spawnTimer > 0) continue;
      const distance = enemy.position.distanceTo(p.position);
      if (distance > p.splash + enemy.radius) continue;
      caught.push(enemy);
    }
    for (const enemy of caught) {
      const distance = enemy.position.distanceTo(p.position);
      const falloff = 1 - Math.min(1, distance / (p.splash + enemy.radius));
      this.damageEnemy(
        enemy,
        p.damage * (0.42 + falloff * 0.68),
        false,
        p.position,
      );
    }

    // Rival operators catch the same blast. Snapshot first for the same
    // reason as above: damageRemote can mark one dead mid-loop.
    const caughtRemotes = [...this.pvpTargets()].filter((remote) => {
      this.remoteHitAt.copy(remote.group.position).setY(
        remote.group.position.y + REMOTE_BODY_Y,
      );
      return (
        this.remoteHitAt.distanceTo(p.position) <=
        p.splash + REMOTE_BODY_RADIUS
      );
    });
    for (const remote of caughtRemotes) {
      this.remoteHitAt.copy(remote.group.position).setY(
        remote.group.position.y + REMOTE_BODY_Y,
      );
      const distance = this.remoteHitAt.distanceTo(p.position);
      const falloff =
        1 - Math.min(1, distance / (p.splash + REMOTE_BODY_RADIUS));
      this.damageRemote(
        remote,
        p.damage * (0.42 + falloff * 0.68),
        false,
        p.position,
      );
    }
  }

  private explosion(
    at: THREE.Vector3,
    scale: number,
    color: THREE.ColorRepresentation,
  ): void {
    const budget = this.particleBudget;
    this.particles.burst(at, {
      count: Math.round(46 * scale * budget),
      color,
      speed: 15 * scale,
      size: 0.34 * scale,
      life: 0.62,
      gravity: -16,
      drag: 2.1,
    });
    this.particles.burst(at, {
      count: Math.round(14 * scale * budget),
      color: 0xffffff,
      speed: 8 * scale,
      size: 0.2 * scale,
      life: 0.28,
      gravity: -4,
      drag: 3,
    });
    this.rings.spawn(
      at,
      color,
      0.4 * scale,
      4.4 * scale,
      0.38,
      false,
      this.camera.position,
    );
    this.audio.explode(Math.min(1.6, scale));

    const distance = at.distanceTo(this.camera.position);
    this.shake = Math.min(
      1.2,
      this.shake + (scale * 0.6) / Math.max(1, distance * 0.25),
    );
  }

  /* =================================================================== */
  /* Damage                                                              */
  /* =================================================================== */

  private damageEnemy(
    enemy: Enemy,
    amount: number,
    crit: boolean,
    point: THREE.Vector3,
  ): void {
    if (!enemy.alive) return;

    // Frontal shields are judged against where the player is standing rather
    // than the hit point: chain and splash damage carry no meaningful impact
    // direction, and flanking -- not aim -- is meant to be the counter.
    let incoming = amount;
    let blocked = false;
    const arc = enemy.config.shieldArc;
    if (arc && enemy.shieldDown <= 0) {
      let delta =
        Math.atan2(
          this.position.x - enemy.position.x,
          this.position.z - enemy.position.z,
        ) - enemy.facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) < arc) {
        incoming = amount * (enemy.config.shieldLeak ?? 0.15);
        blocked = true;
        if (enemy.visual.shieldMaterial) {
          enemy.visual.shieldMaterial.opacity = 0.9;
        }
      }
    }

    const dealt = crit && !blocked ? incoming * this.stats.critMul : incoming;
    enemy.health -= dealt;
    enemy.hitFlash = 1;

    this.numbers.spawn(
      this.v1.copy(point).setY(point.y + enemy.radius * 0.6),
      dealt,
      crit,
    );
    this.particles.burst(point, {
      count: crit ? 16 : 8,
      color: crit ? 0xffd166 : enemy.config.color,
      speed: crit ? 11 : 7,
      size: 0.17,
      life: 0.32,
      gravity: -12,
      drag: 2.4,
    });

    this.markerId += 1;
    this.markerKind = crit && !blocked ? 'crit' : 'hit';
    this.audio.hit(crit && !blocked);

    this.overdrive = Math.min(
      1,
      this.overdrive + (dealt / 1500) * this.stats.overdriveGainMul,
    );

    if (enemy.health <= 0) this.killEnemy(enemy);
  }

  /**
   * `credit` is false when a unit removed itself -- a seeker that lands its
   * dive still has to count toward the wave, but the player did not earn it
   * and should not get combo for being bombed.
   */
  private killEnemy(enemy: Enemy, credit = true): void {
    enemy.alive = false;
    if (credit && enemy.config.kind === 'operator') {
      this.modeRuntime?.onOperatorKilled();
    }
    this.kills += 1;
    this.killsByKind[enemy.config.kind] += 1;
    this.waveKilled += 1;

    if (credit) {
      this.chain += 1;
      this.comboTimer = this.stats.comboWindow;
    }
    const combo = this.currentCombo();
    this.bestCombo = Math.max(this.bestCombo, combo);

    const gained = credit
      ? Math.round(
          enemy.config.score *
            combo *
            this.stats.scoreMul *
            MODE_TUNING[this.mode].scoreMul *
            enemy.scale,
        )
      : 0;
    this.score += gained;
    // A live credit estimate, so the HUD can show what the run is worth
    // before the game over screen banks it.
    if (credit) this.runCredits += Math.max(1, Math.round(gained / 100) + 5);

    this.markerId += 1;
    if (credit) {
      this.markerKind = 'kill';
      this.audio.kill();
    }

    this.explosion(enemy.position, 0.55 + enemy.radius * 0.42, enemy.config.color);
    this.particles.burst(enemy.position, {
      count: 26,
      color: enemy.config.coreColor,
      speed: 13,
      size: 0.22,
      life: 0.9,
      gravity: -20,
      drag: 1.2,
    });

    if (credit && this.stats.lifesteal > 0) {
      this.health = Math.min(
        this.stats.maxHealth,
        this.health + this.stats.lifesteal,
      );
    }
    if (credit) {
      this.overdrive = Math.min(
        1,
        this.overdrive + 0.045 * this.stats.overdriveGainMul,
      );
    }

    this.pushFeed(
      credit
        ? `${enemy.config.name} DOWN  +${gained.toLocaleString()}`
        : `${enemy.config.name} DETONATED`,
      credit && combo >= 2 ? 'crit' : 'kill',
    );

    // Splitters break apart into a pair of fast chaff units.
    if (enemy.config.kind === 'splitter' && enemy.generation === 0) {
      // Children are born outside the wave queue, so the wave total has to
      // grow with them -- otherwise "remaining" climbed past "total" and the
      // HUD counter read e.g. 14/12.
      let spawned = 0;
      for (let i = 0; i < 3; i++) {
        if (!this.findChildSpawn(enemy.position, i, this.childSpawn)) continue;
        const child = this.createEnemy('skitter', this.childSpawn, 1);
        child.spawnTimer = 0.22;
        child.scale = 0.72;
        child.radius = child.config.radius * 0.72;
        child.maxHealth *= 0.55;
        child.health = child.maxHealth;
        child.visual.group.scale.setScalar(0.72);
        spawned += 1;
      }
      this.waveTotal += spawned;
      if (spawned > 0) this.pushFeed('SPLITTER FRAGMENTED', 'warn');
    }

    this.scene.remove(enemy.visual.group);
    enemy.visual.dispose();

    const index = this.enemies.indexOf(enemy);
    if (index >= 0) this.enemies.splice(index, 1);

    // Last kill of a wave gets a moment of slow motion.
    if (this.waveQueue.length === 0 && this.enemies.length === 0) {
      this.completeWave();
    }
  }

  private currentCombo(): number {
    return Math.min(8, 1 + this.chain * 0.2);
  }

  private damagePlayer(amount: number, from: THREE.Vector3): void {
    if (this.phase !== 'playing' || this.iframes > 0) return;

    this.sinceDamage = 0;
    let remaining = amount;

    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
      if (this.shield <= 0) this.audio.shieldBreak();
    }

    if (remaining > 0) {
      this.health -= remaining;
      this.audio.hurt();
    }

    // Where did it come from, relative to where the player is looking?
    this.v1.subVectors(from, this.position).setY(0);
    if (this.v1.lengthSq() > 0.0001) {
      this.v1.normalize();
      const relative = Math.atan2(this.v1.x, this.v1.z) - (this.yaw + Math.PI);
      this.damageAngle = Math.atan2(Math.sin(relative), Math.cos(relative));
    }
    this.damageId += 1;
    this.shake = Math.min(1, this.shake + 0.3);

    // Combo does not survive taking a hit cleanly.
    this.chain = Math.max(0, Math.floor(this.chain * 0.5));

    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
  }

  /* =================================================================== */
  /* Enemies                                                             */
  /* =================================================================== */

  private createEnemy(
    kind: EnemyKind,
    at: THREE.Vector3,
    generation: number,
  ): Enemy {
    const config = ENEMY_CONFIG[kind];
    const visual = buildEnemyVisual(kind);
    const scaling = 1 + Math.max(0, this.wave - 1) * 0.135;

    const enemy: Enemy = {
      config,
      visual,
      position: at.clone(),
      prevPosition: at.clone(),
      velocity: new THREE.Vector3(),
      health: config.health * scaling,
      maxHealth: config.health * scaling,
      radius: config.radius,
      scale: 1,
      spawnTimer: 0.85,
      attackTimer: 0.6 + Math.random() * 0.8,
      telegraph: 0,
      hitFlash: 0,
      spin: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      strafeSign: Math.random() > 0.5 ? 1 : -1,
      alive: true,
      generation,
      // Face the player on arrival, so a warden never spawns presenting its
      // unshielded back for free.
      facing: Math.atan2(this.position.x - at.x, this.position.z - at.z),
      shieldDown: 0,
      stuckAnchor: at.clone(),
      stuckTimer: 0,
    };

    visual.group.position.copy(at);
    visual.group.scale.setScalar(0.01);
    this.scene.add(visual.group);
    this.enemies.push(enemy);
    return enemy;
  }

  /** True when a sphere at `at` would be inside any arena collider. */
  private overlapsGeometry(at: THREE.Vector3, radius: number): boolean {
    for (const box of this.arena.colliders) {
      if (
        at.x > box.min.x - radius &&
        at.x < box.max.x + radius &&
        at.z > box.min.z - radius &&
        at.z < box.max.z + radius &&
        at.y > box.min.y - radius &&
        at.y < box.max.y + radius
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Finds a spawn position that is actually clear.
   *
   * The previous version jittered a fixed ring point by +/-2.5 and used the
   * result unconditionally. The spawn ring clips the north and south perches,
   * so enemies regularly materialised inside that geometry and spent the rest
   * of the wave stuck in a wall. Jitter shrinks with each failed attempt so we
   * converge back onto the known-good ring point.
   */
  private findSpawnPoint(kind: EnemyKind, out: THREE.Vector3): boolean {
    const points = this.arena.spawnPoints;
    const { hover, radius } = ENEMY_CONFIG[kind];
    const ceiling = this.position.y + 5;
    if (points.length === 0) return false;

    for (let attempt = 0; attempt < 12; attempt++) {
      const spawn = points[Math.floor(Math.random() * points.length)]!;
      const jitter = 2.5 * (1 - attempt / 12);
      out.set(
        spawn.x + (Math.random() - 0.5) * jitter * 2,
        0,
        spawn.z + (Math.random() - 0.5) * jitter * 2,
      );

      // Never materialise in the player's lap.
      const dx = out.x - this.position.x;
      const dz = out.z - this.position.z;
      if (dx * dx + dz * dz < 64) continue;

      out.y = surfaceHeightAt(this.arena.colliders, out.x, out.z, ceiling) + hover;
      if (!this.overlapsGeometry(out, radius)) return true;
    }
    return false;
  }

  private findChildSpawn(
    origin: THREE.Vector3,
    childIndex: number,
    out: THREE.Vector3,
  ): boolean {
    const scale = 0.72;
    const config = ENEMY_CONFIG.skitter;
    const radius = config.radius * scale;
    const limit = this.arena.half - radius - 0.1;

    for (let attempt = 0; attempt < 12; attempt++) {
      const ring = 1.4 + Math.floor(attempt / 3) * 0.8;
      const angle =
        ((childIndex + (attempt % 3) / 3) / 3) * Math.PI * 2;
      out.set(
        THREE.MathUtils.clamp(origin.x + Math.cos(angle) * ring, -limit, limit),
        0,
        THREE.MathUtils.clamp(origin.z + Math.sin(angle) * ring, -limit, limit),
      );
      out.y =
        surfaceHeightAt(
          this.arena.colliders,
          out.x,
          out.z,
          origin.y + config.hover + 4,
        ) +
        config.hover * scale;
      if (!this.overlapsGeometry(out, radius)) return true;
    }
    return false;
  }

  private spawnFromQueue(): void {
    const cap = Math.min(26, 12 + this.wave * 1.5);
    if (this.enemies.length >= cap) return;

    const kind = this.waveQueue.shift();
    if (!kind) return;

    const at = this.v1;
    if (!this.findSpawnPoint(kind, at)) {
      // Nowhere clear this instant (usually the player is camping the ring).
      // Requeue and retry shortly rather than spawning into a wall.
      this.waveQueue.unshift(kind);
      this.spawnTimer = 0.15;
      return;
    }

    this.createEnemy(kind, at, 0);
    this.audio.enemySpawn();
    this.rings.spawn(
      this.v3.set(at.x, 0.06, at.z),
      ENEMY_CONFIG[kind].color,
      0.4,
      3.4,
      0.85,
      true,
    );
  }

  /**
   * Uses dedicated scratch vectors rather than the shared v3/v4 pair. It is
   * called from inside the enemy AI switch, where v3 holds the flattened
   * direction to the player and v4 holds the desired velocity -- borrowing
   * them here silently corrupted spectre and brute steering on every frame
   * that ran a visibility check.
   */
  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    this.losDir.subVectors(to, from);
    const distance = this.losDir.length();
    if (distance < 0.001) return true;
    this.losDir.divideScalar(distance);
    this.scratchRay.set(from, this.losDir);

    for (const box of this.arena.colliders) {
      const point = this.scratchRay.intersectBox(box, this.losHit);
      if (point && point.distanceTo(from) < distance - 0.4) return false;
    }
    return true;
  }

  /** Keeps hovering units from burrowing into tall geometry. */
  /**
   * Highest surface under the enemy's whole footprint rather than just its
   * centre point. Sampling the centre alone made units pop upward the instant
   * their midpoint crossed a platform edge, with the body clipping the lip on
   * the way up.
   */
  private surfaceUnder(enemy: Enemy, ceiling: number): number {
    const r = enemy.radius;
    const { x, z } = enemy.position;
    const c = this.arena.colliders;
    return Math.max(
      surfaceHeightAt(c, x, z, ceiling),
      surfaceHeightAt(c, x + r, z, ceiling),
      surfaceHeightAt(c, x - r, z, ceiling),
      surfaceHeightAt(c, x, z + r, ceiling),
      surfaceHeightAt(c, x, z - r, ceiling),
    );
  }

  /**
   * Pushes an enemy out of any solid it has entered, along its shallowest axis.
   *
   * Runs several passes rather than one. The corner bunkers are L-shaped -- two
   * overlapping boxes -- so resolving against one arm regularly shoves the unit
   * straight into the other. With a single pass the second arm had often
   * already been visited, so the enemy stayed welded inside the elbow for the
   * rest of the wave. Repeating until nothing moves settles every shape in the
   * arena, and the early exit keeps the common (untouched) case at one pass.
   */
  private pushOutOfWalls(enemy: Enemy, ceiling: number): void {
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;

      for (const box of this.arena.colliders) {
        if (box.max.y <= ceiling) continue;
        if (
          enemy.position.x < box.min.x - enemy.radius ||
          enemy.position.x > box.max.x + enemy.radius ||
          enemy.position.z < box.min.z - enemy.radius ||
          enemy.position.z > box.max.z + enemy.radius
        ) {
          continue;
        }
        if (enemy.position.y > box.max.y + enemy.radius) continue;
        if (
          enemy.position.y - enemy.radius >=
          box.max.y - ENEMY_SURFACE_TOLERANCE
        ) {
          continue;
        }

        const dxMin = enemy.position.x - (box.min.x - enemy.radius);
        const dxMax = box.max.x + enemy.radius - enemy.position.x;
        const dzMin = enemy.position.z - (box.min.z - enemy.radius);
        const dzMax = box.max.z + enemy.radius - enemy.position.z;
        const min = Math.min(dxMin, dxMax, dzMin, dzMax);

        if (min === dxMin) enemy.position.x = box.min.x - enemy.radius;
        else if (min === dxMax) enemy.position.x = box.max.x + enemy.radius;
        else if (min === dzMin) enemy.position.z = box.min.z - enemy.radius;
        else enemy.position.z = box.max.z + enemy.radius;
        moved = true;
      }

      if (!moved) break;
    }
  }

  private enemyInsideWall(enemy: Enemy, ceiling: number): boolean {
    for (const box of this.arena.colliders) {
      if (box.max.y <= ceiling) continue;
      if (enemy.position.y > box.max.y + enemy.radius) continue;
      if (
        enemy.position.y - enemy.radius >=
        box.max.y - ENEMY_SURFACE_TOLERANCE
      ) {
        continue;
      }
      if (
        enemy.position.x > box.min.x - enemy.radius + COLLISION_EPSILON &&
        enemy.position.x < box.max.x + enemy.radius - COLLISION_EPSILON &&
        enemy.position.z > box.min.z - enemy.radius + COLLISION_EPSILON &&
        enemy.position.z < box.max.z + enemy.radius - COLLISION_EPSILON
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Seeker payload. Damage falls off toward the edge so backing away mid-dive
   * still pays, and it hurts other enemies too -- baiting a seeker into a pack
   * is meant to be a real play rather than a bug.
   */
  private seekerDetonate(enemy: Enemy): void {
    const radius = enemy.config.blastRadius ?? 4;
    const origin = this.blastOrigin.copy(enemy.position);

    this.rings.spawn(
      this.blastRing.set(origin.x, 0.08, origin.z),
      enemy.config.color,
      1,
      radius * 2,
      0.45,
      false,
    );
    this.particles.burst(origin, {
      count: 34,
      color: enemy.config.color,
      speed: 17,
      size: 0.26,
      life: 0.5,
      gravity: -10,
      drag: 1.8,
    });
    this.audio.explode(1);
    this.shake = Math.min(this.shake + 0.4, 0.9);

    const playerDist = origin.distanceTo(this.playerCenter);
    if (playerDist < radius) {
      const falloff = 1 - playerDist / radius;
      this.damagePlayer(
        enemy.config.contactDamage * (0.35 + falloff * 0.65),
        origin,
      );
    }

    // Collect first: damaging can spawn splitter children mid-iteration, and
    // newborns must not be caught by a blast that predates them.
    const caught: Enemy[] = [];
    for (const other of this.enemies) {
      if (other === enemy || !other.alive || other.spawnTimer > 0) continue;
      if (other.position.distanceTo(origin) <= radius) caught.push(other);
    }
    for (const other of caught) {
      const d = other.position.distanceTo(origin);
      this.damageEnemy(other, 30 * (1 - d / radius), false, other.position);
    }

    this.killEnemy(enemy, false);
  }

  private updateEnemies(dt: number, visualDt: number): void {
    const playerCenter = this.playerCenter
      .copy(this.position)
      .setY(this.position.y + PLAYER_HEIGHT * 0.55);
    const limit = this.arena.half - 2;

    // Rebuild the broadphase once per step; separation then only inspects the
    // 3x3 cell neighbourhood instead of every other enemy in the wave.
    this.enemyGrid.clear();
    for (const e of this.enemies) {
      if (e.alive && e.spawnTimer <= 0) this.enemyGrid.insert(e);
    }

    this.enemyUpdateSnapshot.length = 0;
    this.enemyUpdateSnapshot.push(...this.enemies);
    for (const enemy of this.enemyUpdateSnapshot) {
      if (!enemy.alive) continue;
      const visual = enemy.visual;
      // Snapshot the pre-step position so the renderer can interpolate.
      enemy.prevPosition.copy(enemy.position);
      enemy.spin += visualDt * (enemy.config.kind === 'brute' ? 0.5 : 1.9);
      enemy.phase += visualDt * 2.4;

      if (enemy.spawnTimer > 0) {
        enemy.spawnTimer -= dt;
        const t = 1 - Math.max(0, enemy.spawnTimer) / 0.85;
        const eased = 1 - Math.pow(1 - Math.min(1, t), 3);
        visual.group.scale.setScalar(Math.max(0.01, eased * enemy.scale));
        visual.group.rotation.y = enemy.spin * 3;
        continue;
      }

      const toPlayer = this.v2.subVectors(playerCenter, enemy.position);
      const distance = toPlayer.length();
      const flat = this.v3.set(toPlayer.x, 0, toPlayer.z);
      const flatDistance = flat.length() || 1;
      flat.divideScalar(flatDistance);

      const speed =
        enemy.config.speed *
        (1 + Math.min(0.35, this.wave * 0.02)) *
        this.tuning.enemySpeedMul;
      const desired = this.v4.set(0, 0, 0);

      switch (enemy.config.kind) {
        case 'skitter':
        case 'splitter': {
          desired.copy(flat).multiplyScalar(speed);
          // Weave so a line of chargers is not a straight conga line.
          desired.x += -flat.z * Math.sin(enemy.phase) * speed * 0.34;
          desired.z += flat.x * Math.sin(enemy.phase) * speed * 0.34;
          if (distance < enemy.config.attackRange + enemy.radius) {
            if (enemy.attackTimer <= 0) {
              enemy.attackTimer = enemy.config.attackCooldown;
              this.damagePlayer(enemy.config.contactDamage, enemy.position);
              this.particles.burst(enemy.position, {
                count: 14,
                color: enemy.config.color,
                speed: 9,
                size: 0.2,
                life: 0.3,
              });
              desired.multiplyScalar(-1.4);
            }
          }
          break;
        }
        case 'spectre': {
          const visible = this.hasLineOfSight(enemy.position, playerCenter);
          if (!visible || flatDistance > 22) {
            desired.copy(flat).multiplyScalar(speed);
          } else if (flatDistance < 11) {
            desired.copy(flat).multiplyScalar(-speed);
          }
          // Constant orbit makes them awkward to track.
          desired.x += -flat.z * enemy.strafeSign * speed * 0.95;
          desired.z += flat.x * enemy.strafeSign * speed * 0.95;

          if (visible && enemy.attackTimer <= 0 && flatDistance < 30) {
            enemy.attackTimer = enemy.config.attackCooldown;
            this.fireEnemyOrb(enemy, playerCenter, this.orbMat, 0.28);
          }
          break;
        }
        case 'brute': {
          if (enemy.telegraph > 0) {
            enemy.telegraph -= dt;
            visual.coreMaterial.opacity = 0.4 + Math.random() * 0.6;
            if (enemy.telegraph <= 0) this.bruteSlam(enemy, playerCenter);
            break;
          }

          if (flatDistance > enemy.config.attackRange) {
            desired.copy(flat).multiplyScalar(speed);
            if (
              enemy.attackTimer <= 0 &&
              this.hasLineOfSight(enemy.position, playerCenter)
            ) {
              enemy.attackTimer = enemy.config.attackCooldown;
              this.fireEnemyOrb(enemy, playerCenter, this.bruteOrbMat, 0.5);
            }
          } else if (enemy.attackTimer <= 0) {
            enemy.attackTimer = enemy.config.attackCooldown;
            enemy.telegraph = 0.85;
            this.rings.spawn(
              this.v1.set(enemy.position.x, 0.08, enemy.position.z),
              0xffb020,
              1,
              9,
              0.85,
              true,
            );
          }
          break;
        }
        case 'seeker': {
          // Accelerates the whole way in, so ignoring one gets worse the
          // longer it is ignored. The commitment cuts both ways: at full
          // speed it can no longer course-correct around a sidestep.
          const commit = THREE.MathUtils.clamp(
            1 + (24 - flatDistance) / 16,
            1,
            2.1,
          );
          desired.copy(flat).multiplyScalar(speed * commit);
          enemy.telegraph = THREE.MathUtils.clamp(1 - flatDistance / 18, 0, 1);

          if (distance < enemy.config.attackRange + enemy.radius) {
            this.seekerDetonate(enemy);
            continue;
          }
          break;
        }
        case 'warden': {
          const targetFacing = Math.atan2(flat.x, flat.z);
          let turn = targetFacing - enemy.facing;
          while (turn > Math.PI) turn -= Math.PI * 2;
          while (turn < -Math.PI) turn += Math.PI * 2;
          // Deliberately slower than a player can strafe. A turret that
          // tracked instantly would make the shield unbeatable rather than
          // flankable.
          const turnRate = 1.5 * dt;
          enemy.facing += THREE.MathUtils.clamp(turn, -turnRate, turnRate);

          if (enemy.shieldDown > 0) enemy.shieldDown -= dt;

          if (flatDistance > enemy.config.attackRange) {
            desired.copy(flat).multiplyScalar(speed);
          } else {
            // Holds the line and sidesteps instead of closing, so it stays a
            // wall to work around rather than another charger.
            desired.x = -flat.z * enemy.strafeSign * speed * 0.6;
            desired.z = flat.x * enemy.strafeSign * speed * 0.6;
          }

          if (
            enemy.attackTimer <= 0 &&
            flatDistance < enemy.config.attackRange + 6 &&
            this.hasLineOfSight(enemy.position, playerCenter)
          ) {
            enemy.attackTimer = enemy.config.attackCooldown;
            // Opening to fire is the whole counterplay: the shield is down
            // for longer than the shot takes.
            enemy.shieldDown = 1.15;
            this.fireEnemyOrb(enemy, playerCenter, this.orbMat, 0.34);
          }
          break;
        }
      }

      enemy.attackTimer -= dt;

      // Separation so the swarm spreads across the arena.
      this.enemyGrid.forEachNear(
        enemy.position.x,
        enemy.position.z,
        (other) => {
          if (other === enemy) return;
          const minDistance = enemy.radius + other.radius + 0.35;
          let dx = enemy.position.x - other.position.x;
          let dz = enemy.position.z - other.position.z;
          let distSq = dx * dx + dz * dz;
          if (distSq > minDistance * minDistance) return;

          if (distSq < 0.0001) {
            // Exactly coincident units used to be skipped by this guard and
            // stayed welded together for the rest of the wave -- splitter
            // children spawn stacked, so this happened constantly. Break the
            // tie along each unit's own spin, which differs per enemy and
            // keeps the result deterministic.
            dx = Math.cos(enemy.spin) * 0.01;
            dz = Math.sin(enemy.spin) * 0.01;
            distSq = dx * dx + dz * dz;
          }

          const d = Math.sqrt(distSq);
          const push = (minDistance - d) / minDistance;
          desired.x += (dx / d) * push * speed * 2.2;
          desired.z += (dz / d) * push * speed * 2.2;
        },
      );

      enemy.velocity.lerp(desired, Math.min(1, dt * 6));
      enemy.position.addScaledVector(enemy.velocity, dt);

      // Stay inside the arena and out of solid walls.
      enemy.position.x = THREE.MathUtils.clamp(enemy.position.x, -limit, limit);
      enemy.position.z = THREE.MathUtils.clamp(enemy.position.z, -limit, limit);

      // Player height controls how high enemies may climb toward the player,
      // but a unit already on a taller platform must keep seeing that surface
      // or it will descend through the roof when the player returns to ground.
      const ceiling = Math.max(this.position.y + 5, enemy.position.y + 1);
      this.pushOutOfWalls(enemy, ceiling);
      // A correction at a perimeter can push the unit outside the legal extent.
      // Clamp and settle once more before testing whether the solver converged.
      enemy.position.x = THREE.MathUtils.clamp(enemy.position.x, -limit, limit);
      enemy.position.z = THREE.MathUtils.clamp(enemy.position.z, -limit, limit);
      this.pushOutOfWalls(enemy, ceiling);

      if (
        this.enemyInsideWall(enemy, ceiling) &&
        this.findSpawnPoint(enemy.config.kind, this.enemyRecoverySpawn)
      ) {
        enemy.position.copy(this.enemyRecoverySpawn);
        enemy.prevPosition.copy(enemy.position);
        enemy.velocity.set(0, 0, 0);
        enemy.stuckAnchor.copy(enemy.position);
        enemy.stuckTimer = 0;
        enemy.spawnTimer = 0.3;
        continue;
      }

      // Direct steering has no full navmesh. If an active unit spends several
      // seconds hidden behind geometry without leaving a small area, move it to
      // a validated spawn. This is a last-resort wave-softlock guard, not normal
      // pathing: visible enemies and units making progress never trigger it.
      const anchorDx = enemy.position.x - enemy.stuckAnchor.x;
      const anchorDz = enemy.position.z - enemy.stuckAnchor.z;
      const leftAnchor = anchorDx * anchorDx + anchorDz * anchorDz > 4;
      if (leftAnchor) {
        enemy.stuckAnchor.copy(enemy.position);
        enemy.stuckTimer = 0;
      } else if (desired.lengthSq() > 0.25) {
        enemy.stuckTimer += dt;
        if (enemy.stuckTimer >= 4) {
          if (this.hasLineOfSight(enemy.position, playerCenter)) {
            enemy.stuckAnchor.copy(enemy.position);
            enemy.stuckTimer = 0;
          } else if (
            this.findSpawnPoint(enemy.config.kind, this.enemyRecoverySpawn)
          ) {
            enemy.position.copy(this.enemyRecoverySpawn);
            enemy.prevPosition.copy(enemy.position);
            enemy.velocity.set(0, 0, 0);
            enemy.stuckAnchor.copy(enemy.position);
            enemy.stuckTimer = 0;
            enemy.spawnTimer = 0.3;
            continue;
          }
        }
      } else {
        enemy.stuckTimer = Math.max(0, enemy.stuckTimer - dt);
      }

      const surface = this.surfaceUnder(enemy, ceiling);
      // Only hovering units bob. A walking unit sits on its feet, so a
      // sine offset around the surface spends half its cycle underneath the
      // floor -- and its rig already animates its own gait.
      const bob =
        enemy.config.hover > 0
          ? Math.sin(enemy.phase) * (enemy.config.ranged ? 0.34 : 0.14)
          : 0;
      const targetY = surface + enemy.config.hover * enemy.scale + bob;
      // Hovering units have no jump arc. Ease downward when they leave a ledge,
      // but snap upward to a newly detected surface; interpolating that rise
      // moves the body through stacked containers for several frames.
      if (targetY > enemy.position.y) enemy.position.y = targetY;
      else {
        enemy.position.y +=
          (targetY - enemy.position.y) * Math.min(1, dt * 5);
      }

      /* ----------------------------- visuals ---------------------------- */
      // Position is applied by present() so it can interpolate between steps.
      visual.group.scale.setScalar(enemy.scale);

      if (enemy.config.kind === 'brute') {
        visual.group.rotation.y += visualDt * 0.6;
        visual.shell.rotation.x = enemy.spin * 0.3;
      } else if (enemy.config.shieldArc) {
        // The plate must track the real facing, not the aim direction, or the
        // visual lies about which side is soft.
        visual.group.rotation.y = enemy.facing;
        visual.shell.rotation.set(0, enemy.spin * 0.4, 0);
      } else if (enemy.config.kind === 'seeker') {
        // A dart only reads as a dart while it points where it is going.
        visual.group.rotation.y = Math.atan2(flat.x, flat.z);
        visual.shell.rotation.set(0, 0, enemy.spin * 2.4);
      } else {
        visual.group.rotation.y = Math.atan2(flat.x, flat.z);
        visual.shell.rotation.set(enemy.spin, enemy.spin * 1.3, 0);
      }

      if (visual.shieldMaterial) {
        // Fades while the shield is open; damageEnemy spikes the opacity so a
        // blocked shot flares instead of just reading as a small number.
        const target = enemy.shieldDown > 0 ? 0.04 : 0.3;
        visual.shieldMaterial.opacity +=
          (target - visual.shieldMaterial.opacity) * Math.min(1, visualDt * 7);
      }

      if (enemy.config.kind === 'seeker') {
        // Strobes faster the closer it gets -- the warning that a dive is
        // already committed.
        const rate = 5 + enemy.telegraph * 30;
        visual.coreMaterial.opacity =
          0.5 + Math.max(0, Math.sin(enemy.phase * rate)) * 0.5;
      }
      visual.wire.rotation.copy(visual.shell.rotation);
      visual.wire.scale.setScalar(1.09 + Math.sin(enemy.phase * 2) * 0.03);

      const pulse = 0.85 + Math.sin(enemy.phase * 3) * 0.15;
      visual.core.scale.setScalar(enemy.config.coreRadius * pulse);
      visual.core.rotation.set(-enemy.spin * 1.4, enemy.spin, 0);

      visual.orbiters.forEach((shard, index) => {
        const angle =
          enemy.spin * 1.6 + (index / visual.orbiters.length) * Math.PI * 2;
        const ring = enemy.config.radius * 1.4;
        shard.position.set(
          Math.cos(angle) * ring,
          Math.sin(angle * 1.7) * 0.4,
          Math.sin(angle) * ring,
        );
        shard.rotation.set(angle, angle * 1.4, 0);
      });

      if (enemy.hitFlash > 0) {
        enemy.hitFlash = Math.max(0, enemy.hitFlash - visualDt * 5);
        visual.shellMaterial.emissiveIntensity = 0.35 + enemy.hitFlash * 3.4;
        visual.wireMaterial.opacity = 0.85 + enemy.hitFlash * 0.15;
      }

      const healthFraction = enemy.health / enemy.maxHealth;
      if (enemy.telegraph <= 0) {
        visual.coreMaterial.opacity = 0.55 + (1 - healthFraction) * 0.45;
      }
    }
  }

  private fireEnemyOrb(
    enemy: Enemy,
    target: THREE.Vector3,
    material: THREE.MeshBasicMaterial,
    radius: number,
  ): void {
    // Lead the player a little so standing still is punished.
    const lead = this.v1
      .copy(this.velocity)
      .multiplyScalar(0.22)
      .add(target)
      .sub(enemy.position)
      .normalize();

    this.spawnProjectile({
      origin: enemy.position,
      direction: lead,
      speed: enemy.config.projectileSpeed,
      damage: enemy.config.projectileDamage * (1 + this.wave * 0.045),
      radius,
      splash: 0,
      fromPlayer: false,
      charge: 0,
      material,
      life: 5,
    });
    this.audio.enemyShot();
  }

  private bruteSlam(enemy: Enemy, playerCenter: THREE.Vector3): void {
    const radius = 9;
    this.rings.spawn(
      this.v1.set(enemy.position.x, 0.1, enemy.position.z),
      0xff6b2d,
      1,
      radius * 1.1,
      0.45,
      true,
    );
    this.particles.burst(
      this.v2.set(enemy.position.x, 0.4, enemy.position.z),
      {
        count: 60,
        color: 0xffb020,
        speed: 19,
        size: 0.3,
        life: 0.7,
        gravity: -22,
        direction: this.v3.set(0, 0.55, 0),
        spread: 1.5,
      },
    );
    this.audio.explode(1.4);
    this.shake = Math.min(1.3, this.shake + 0.55);

    const distance = playerCenter.distanceTo(enemy.position);
    if (distance < radius) {
      const falloff = 1 - distance / radius;
      this.damagePlayer(
        enemy.config.contactDamage * (0.5 + falloff * 0.9),
        enemy.position,
      );
      // Knock the player up and back so the hit reads physically.
      this.slamDir.subVectors(this.position, enemy.position).setY(0).normalize();
      this.velocity.addScaledVector(this.slamDir, 12 * falloff);
      this.velocity.y = Math.max(this.velocity.y, 7 * falloff);
    }
  }

  /* =================================================================== */
  /* Player                                                              */
  /* =================================================================== */

  private playerBox(target: THREE.Box3): THREE.Box3 {
    target.min.set(
      this.position.x - PLAYER_RADIUS,
      this.position.y,
      this.position.z - PLAYER_RADIUS,
    );
    target.max.set(
      this.position.x + PLAYER_RADIUS,
      this.position.y + PLAYER_HEIGHT,
      this.position.z + PLAYER_RADIUS,
    );
    return target;
  }

  private overlapsWorld(): boolean {
    const box = this.playerBox(this.scratchBox);
    for (const collider of this.arena.colliders) {
      if (box.intersectsBox(collider)) return true;
    }
    return false;
  }

  /**
   * Trims the camera look-ahead so it only enters space the player box could
   * actually occupy. Collision zeroes blocked velocity at the moment of
   * impact, but on the frame *before* impact the velocity still points into
   * the wall, and a dash-speed look-ahead would push the eye through the
   * face. Reads simulation state, never writes it.
   */
  private clampExtrapolation(): void {
    const box = this.playerBox(this.extrapolationBox);
    // Pull the faces in a hair so resting contact -- standing on a ledge,
    // sliding along a wall -- does not read as a hit on every axis.
    box.expandByScalar(-0.01);
    // The endpoint overlap test below is exhaustive only while the per-axis
    // step stays smaller than the shrunken box itself; a larger step could
    // jump clean over a thin collider. Top speed today produces about half
    // this cap -- enforce it so a future speed boost cannot start tunnelling.
    const maxStep = PLAYER_RADIUS * 2 - 0.04;
    for (const axis of AXES) {
      let amount = this.extrapolation[axis];
      if (amount === 0) continue;
      if (Math.abs(amount) > maxStep) {
        amount = Math.sign(amount) * maxStep;
        this.extrapolation[axis] = amount;
      }
      box.min[axis] += amount;
      box.max[axis] += amount;
      let blocked = false;
      for (const collider of this.arena.colliders) {
        if (box.intersectsBox(collider)) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        box.min[axis] -= amount;
        box.max[axis] -= amount;
        this.extrapolation[axis] = 0;
      }
    }
  }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number): void {
    if (amount === 0) return;

    const start = this.position[axis];
    const leadingExtent =
      axis === 'y'
        ? amount > 0
          ? PLAYER_HEIGHT
          : 0
        : amount > 0
          ? PLAYER_RADIUS
          : -PLAYER_RADIUS;
    let resolved = start + amount;
    let hit = false;
    const box = this.playerBox(this.scratchBox);

    for (const collider of this.arena.colliders) {
      const overlapsX =
        box.max.x > collider.min.x + COLLISION_EPSILON &&
        box.min.x < collider.max.x - COLLISION_EPSILON;
      const overlapsY =
        box.max.y > collider.min.y + COLLISION_EPSILON &&
        box.min.y < collider.max.y - COLLISION_EPSILON;
      const overlapsZ =
        box.max.z > collider.min.z + COLLISION_EPSILON &&
        box.min.z < collider.max.z - COLLISION_EPSILON;
      const overlapsOtherAxes =
        axis === 'x'
          ? overlapsY && overlapsZ
          : axis === 'y'
            ? overlapsX && overlapsZ
            : overlapsX && overlapsY;
      if (!overlapsOtherAxes) continue;

      if (amount > 0) {
        const face = collider.min[axis];
        const startEdge = start + leadingExtent;
        const endEdge = resolved + leadingExtent;
        if (
          startEdge <= face + COLLISION_EPSILON &&
          endEdge > face + COLLISION_EPSILON
        ) {
          resolved = Math.min(resolved, face - leadingExtent);
          hit = true;
        }
      } else {
        const face = collider.max[axis];
        const startEdge = start + leadingExtent;
        const endEdge = resolved + leadingExtent;
        if (
          startEdge >= face - COLLISION_EPSILON &&
          endEdge < face - COLLISION_EPSILON
        ) {
          resolved = Math.max(resolved, face - leadingExtent);
          hit = true;
        }
      }
    }

    this.position[axis] = resolved;
    if (hit) {
      this.velocity[axis] = 0;
      if (axis === 'y' && amount < 0) this.grounded = true;
    }
  }

  /**
   * Arena walls are visible collision geometry, but they are not the authority
   * for the playable area. A sufficiently high jump or knockback can put the
   * player on top of a wall, where an ordinary Box3 no longer blocks outward
   * movement. Keep this invariant separate from wall collision so every map is
   * sealed at every height.
   */
  private enforcePlayerBounds(): void {
    const limit = Math.max(0, this.arena.half - PLAYER_RADIUS);
    const clampedX = THREE.MathUtils.clamp(this.position.x, -limit, limit);
    const clampedZ = THREE.MathUtils.clamp(this.position.z, -limit, limit);

    if (clampedX !== this.position.x) {
      this.position.x = clampedX;
      if (Math.sign(this.velocity.x) === Math.sign(clampedX)) {
        this.velocity.x = 0;
      }
    }
    if (clampedZ !== this.position.z) {
      this.position.z = clampedZ;
      if (Math.sign(this.velocity.z) === Math.sign(clampedZ)) {
        this.velocity.z = 0;
      }
    }

    // Recover instead of leaving the run soft-locked if a future map or force
    // ever manages to put the player below the floor or into non-finite space.
    if (
      this.position.y < FALL_RECOVERY_Y ||
      !Number.isFinite(this.position.x) ||
      !Number.isFinite(this.position.y) ||
      !Number.isFinite(this.position.z)
    ) {
      this.position.copy(this.arena.playerSpawn);
      this.prevPlayerPosition.copy(this.position);
      this.velocity.set(0, 0, 0);
      this.grounded = false;
      this.wasGrounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.dashTimer = 0;
      this.iframes = 0;
    }
  }

  /**
   * The slide & boost movement style, in one place so the classic style keeps
   * running exactly the code it always did. Returns the ground friction the
   * step should use -- a slide is mostly the friction change.
   */
  private updateSlideBoost(
    dt: number,
    wish: THREE.Vector3,
    shift: boolean,
  ): number {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    if (this.sliding) {
      this.slideTimer -= dt;
      // A slide ends on its own terms: out of time, out of speed, off the
      // ground, or the key came up.
      if (!this.grounded || this.slideTimer <= 0 || speed < 3 || !shift) {
        this.sliding = false;
        this.slideCooldown = SLIDE_COOLDOWN;
      }
    } else if (
      shift &&
      this.grounded &&
      this.slideCooldown <= 0 &&
      speed > SLIDE_MIN_SPEED &&
      wish.lengthSq() > 0
    ) {
      this.sliding = true;
      this.slideTimer = SLIDE_DURATION;
      this.velocity.x += wish.x * SLIDE_IMPULSE;
      this.velocity.z += wish.z * SLIDE_IMPULSE;
      this.audio.dash();
      this.rings.spawn(
        this.v3.set(this.position.x, 0.05, this.position.z),
        0x38f8ff,
        0.45,
        2.8,
        0.45,
        true,
      );
    }

    const boosting =
      shift && !this.grounded && !this.sliding && this.boostFuel > 0;
    if (boosting) {
      this.boostFuel = Math.max(0, this.boostFuel - dt / BOOST_SECONDS);
      // Thrust sets a ceiling rather than adding without limit, so holding
      // boost lifts you to a height you can read, not into orbit.
      this.velocity.y = Math.min(
        this.velocity.y + BOOST_LIFT * dt,
        BOOST_MAX_RISE,
      );
      if (wish.lengthSq() > 0) {
        this.velocity.x += wish.x * BOOST_PUSH * dt;
        this.velocity.z += wish.z * BOOST_PUSH * dt;
      }
      if (this.boostTimer <= 0) {
        this.boostTimer = 0.06;
        this.particles.burst(
          this.v3.set(this.position.x, this.position.y + 0.2, this.position.z),
          {
            count: 3,
            color: 0x38f8ff,
            speed: 5,
            size: 0.14,
            life: 0.26,
            gravity: -4,
            drag: 3,
          },
        );
      }
    }
    this.boostTimer = Math.max(0, this.boostTimer - dt);

    if (this.grounded && !boosting) {
      this.boostFuel = Math.min(1, this.boostFuel + dt / BOOST_REFILL_SECONDS);
    }

    this.slideCrouch +=
      ((this.sliding ? 1 : 0) - this.slideCrouch) * Math.min(1, dt * 13);

    return this.sliding ? SLIDE_FRICTION : GROUND_FRICTION;
  }

  private updatePlayer(dt: number): void {
    // Snapshot the pre-step position so the camera can interpolate.
    this.prevPlayerPosition.copy(this.position);

    /* ------------------------------ intent ----------------------------- */
    // Screen-right is forward x up. With forward = (-sin yaw, 0, -cos yaw)
    // that is (-forward.z, 0, forward.x) = (cos yaw, 0, -sin yaw) -- the same
    // basis `readLocalPose` projects onto. Negating it swaps A and D.
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    this.right.set(-this.forward.z, 0, this.forward.x);

    const wish = this.v1.set(0, 0, 0);
    if (this.keys.has('KeyW')) wish.add(this.forward);
    if (this.keys.has('KeyS')) wish.sub(this.forward);
    if (this.keys.has('KeyD')) wish.add(this.right);
    if (this.keys.has('KeyA')) wish.sub(this.right);
    if (wish.lengthSq() > 0) wish.normalize();

    // Shift does one of two jobs depending on the movement style. Classic:
    // held sprint. Slide & boost: ground slide, air thruster -- same finger,
    // two verbs, which is what makes the style feel different rather than
    // just faster.
    const style = this.settings.movementStyle;
    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const sprinting = style === 'classic' && shift && this.keys.has('KeyW');

    let friction = GROUND_FRICTION;
    if (style === 'slide') {
      friction = this.updateSlideBoost(dt, wish, shift);
    } else if (this.sliding || this.boostFuel < 1) {
      this.sliding = false;
      this.boostFuel = 1;
    }

    const targetSpeed =
      this.stats.moveSpeed *
      (sprinting ? 1.35 : 1) *
      (this.overdriveActive ? 1.16 : 1);
    // (sprintMul below scales acceleration to make that target reachable.)

    /* ---------------------------- horizontal --------------------------- */
    // Ground friction caps steady speed near GROUND_ACCEL / GROUND_FRICTION,
    // so the sprint must scale acceleration as well as the target -- a higher
    // target alone would be unreachable and Shift would do nothing.
    const sprintMul = sprinting ? 1.35 : 1;
    // A slide steers, it does not accelerate: the speed already came from the
    // impulse, and full control would make it strictly better than running.
    const control = this.sliding ? 0.22 : 1;
    const accel =
      (this.grounded ? GROUND_ACCEL : AIR_ACCEL) * sprintMul * control;
    const horizontal = this.v2.set(this.velocity.x, 0, this.velocity.z);

    if (this.grounded && this.dashTimer <= 0) {
      const speed = horizontal.length();
      if (speed > 0) {
        const drop = speed * friction * dt;
        horizontal.multiplyScalar(Math.max(0, speed - drop) / speed);
      }
    }

    if (wish.lengthSq() > 0) {
      const current = horizontal.dot(wish);
      const add = Math.min(targetSpeed - current, accel * dt);
      if (add > 0) horizontal.addScaledVector(wish, add);
    }

    this.velocity.x = horizontal.x;
    this.velocity.z = horizontal.z;

    /* ------------------------------ vertical --------------------------- */
    this.velocity.y += GRAVITY * dt;

    if (this.grounded) this.coyote = COYOTE_TIME;
    else this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = JUMP_SPEED;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.audio.jump();
    }

    /* ------------------------------ movement --------------------------- */
    this.grounded = false;
    const startX = this.position.x;
    const startZ = this.position.z;
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    const intendedVX = this.velocity.x;
    const intendedVZ = this.velocity.z;

    this.moveAxis('x', dx);
    this.moveAxis('z', dz);

    const movedX = this.position.x - startX;
    const movedZ = this.position.z - startZ;
    const blocked =
      Math.abs(movedX - dx) > 1e-4 || Math.abs(movedZ - dz) > 1e-4;

    // Step up onto low ledges instead of catching on them.
    if (blocked && (this.wasGrounded || this.grounded)) {
      const savedX = this.position.x;
      const savedZ = this.position.z;
      const savedY = this.position.y;

      this.position.set(startX, savedY + STEP_HEIGHT, startZ);
      if (!this.overlapsWorld()) {
        this.velocity.x = intendedVX;
        this.velocity.z = intendedVZ;
        this.moveAxis('x', dx);
        this.moveAxis('z', dz);
        const gained = Math.hypot(
          this.position.x - startX,
          this.position.z - startZ,
        );
        if (gained > Math.hypot(movedX, movedZ) + 0.001) {
          this.moveAxis('y', -STEP_HEIGHT);
        } else {
          this.position.set(savedX, savedY, savedZ);
        }
      } else {
        this.position.set(savedX, savedY, savedZ);
      }
    }

    this.moveAxis('y', this.velocity.y * dt);

    if (this.position.y <= 0) {
      this.position.y = 0;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }

    // A descending player can be horizontally blocked by the lip they are
    // landing on because horizontal movement is resolved before vertical
    // support. Retry only the untravelled portion once the landing height is
    // known; touching the top face no longer counts as side overlap.
    if (blocked && !this.wasGrounded && this.grounded) {
      this.velocity.x = intendedVX;
      this.velocity.z = intendedVZ;
      this.moveAxis('x', dx - movedX);
      this.moveAxis('z', dz - movedZ);
    }

    this.enforcePlayerBounds();

    if (this.grounded && !this.wasGrounded && this.velocity.y <= 0) {
      this.audio.land();
      this.shake = Math.min(0.4, this.shake + 0.06);
    }
    this.wasGrounded = this.grounded;

    /* ------------------------------- dash ------------------------------ */
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.iframes = Math.max(0, this.iframes - dt);

    if (this.dashCharges < this.stats.maxDashCharges) {
      this.dashRecharge += dt / this.stats.dashCooldown;
      if (this.dashRecharge >= 1) {
        this.dashRecharge = 0;
        this.dashCharges += 1;
      }
    } else {
      this.dashRecharge = 0;
    }

    /* ------------------------------ shield ----------------------------- */
    this.sinceDamage += dt;
    if (
      this.sinceDamage > this.stats.shieldRegenDelay &&
      this.shield < this.stats.maxShield
    ) {
      this.shield = Math.min(
        this.stats.maxShield,
        this.shield + this.stats.shieldRegenRate * dt,
      );
    }

    /* ------------------------------ weapons ---------------------------- */
    for (const w of this.weapons) {
      w.cooldown = Math.max(0, w.cooldown - dt);
      if (w.reloading) {
        w.reloadTimer -= dt;
        if (w.reloadTimer <= 0) {
          w.reloading = false;
          w.reloadTimer = 0;
          w.ammo = this.magazineOf(w);
        }
      }
    }

    const weapon = this.weapon;
    if (this.charging && weapon.chargeable) {
      weapon.charge = Math.min(1, weapon.charge + dt / 1.05);
      this.viewModel.setCharge(weapon.charge);
      this.audio.updateCharge(weapon.charge);
    }

    if (
      this.firing &&
      !weapon.reloading &&
      weapon.cooldown <= 0 &&
      !(this.charging && weapon.chargeable)
    ) {
      const rate =
        this.stats.fireRateMul * (this.overdriveActive ? 1.55 : 1);
      weapon.cooldown = weapon.baseInterval / rate;
      this.fire(0);
    }

    /* ---------------------------- overdrive ---------------------------- */
    if (this.overdriveTimer > 0) {
      this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
      if (this.overdriveTimer === 0) {
        this.audio.overdriveEnd();
        this.pushFeed('OVERDRIVE DEPLETED', 'warn');
      }
    }

    /* ------------------------------ combo ------------------------------ */
    if (this.chain > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer === 0) this.chain = 0;
    }
  }

  private tryDash(): void {
    if (this.dashCharges <= 0 || this.dashTimer > 0) return;

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    this.right.set(-this.forward.z, 0, this.forward.x);

    const dir = this.v1.set(0, 0, 0);
    if (this.keys.has('KeyW')) dir.add(this.forward);
    if (this.keys.has('KeyS')) dir.sub(this.forward);
    if (this.keys.has('KeyD')) dir.add(this.right);
    if (this.keys.has('KeyA')) dir.sub(this.right);
    if (dir.lengthSq() === 0) dir.copy(this.forward);
    dir.normalize();

    this.dashCharges -= 1;
    this.dashTimer = DASH_DURATION;
    this.iframes = DASH_IFRAMES;
    this.velocity.x = dir.x * this.stats.dashPower;
    this.velocity.z = dir.z * this.stats.dashPower;
    this.velocity.y = Math.max(this.velocity.y, 2.6);

    this.audio.dash();
    this.shake = Math.min(0.6, this.shake + 0.22);

    const at = this.v2.copy(this.position).setY(this.position.y + 0.9);
    this.particles.burst(at, {
      count: 26,
      color: 0x22e0ff,
      speed: 9,
      size: 0.22,
      life: 0.4,
      gravity: -3,
      drag: 3,
      direction: this.v3.copy(dir).multiplyScalar(-1),
      spread: 0.9,
    });
    this.rings.spawn(at, 0x22e0ff, 0.4, 3.4, 0.35, false, this.camera.position);
  }

  /* =================================================================== */
  /* Presentation                                                        */
  /* =================================================================== */

  private updateCamera(dt: number, alpha = 0): void {
    this.recoilPitch *= Math.max(0, 1 - dt * 8);
    this.recoilYaw *= Math.max(0, 1 - dt * 8);
    this.shake *= Math.max(0, 1 - dt * 4.5);

    const shake = this.shake * this.shake;
    const shakeX = (Math.random() - 0.5) * shake * 0.5;
    const shakeY = (Math.random() - 0.5) * shake * 0.5;

    // The local camera follows the newest simulated position, then looks
    // *ahead* by the wall-clock time this frame has consumed but the fixed
    // step has not: without that, a 120/144Hz panel redraws a camera that
    // only moves in 60Hz increments, which players read as sluggish input.
    // Extrapolating with the current velocity is safe because collision
    // zeroes a blocked axis, and clampExtrapolation covers the one frame
    // where velocity still points into a wall it has not hit yet.
    this.renderPosition.copy(this.position);
    if (alpha > 0 && this.phase === 'playing') {
      // updatePlayer advances on its own slow-motion timescale; look ahead by
      // that same scaled time or the camera overshoots during wave-clear
      // slowmo and snaps back on the next step.
      const lookAhead = alpha * SIM_STEP * (0.45 + this.slowmo * 0.55);
      this.extrapolation.copy(this.velocity).multiplyScalar(lookAhead);
      this.clampExtrapolation();
      this.renderPosition.add(this.extrapolation);
      // Mirror the floor rule in updatePlayer, which is not a collider box.
      if (this.renderPosition.y < 0) this.renderPosition.y = 0;
    }

    const eyeX = this.renderPosition.x + shakeX;
    const eyeY =
      this.renderPosition.y + EYE_HEIGHT - this.slideCrouch * 0.52 + shakeY;
    const eyeZ = this.renderPosition.z;

    this.camera.rotation.set(
      this.pitch + this.recoilPitch,
      this.yaw + this.recoilYaw,
      (Math.random() - 0.5) * shake * 0.12 + this.velocity.x * 0.0006,
    );

    // Scope engagement glides rather than snaps, and it must settle before
    // the camera reads it so distance and FOV move together this frame.
    const scopeTarget = this.scoping && this.phase === 'playing' ? 1 : 0;
    this.scopeBlend += (scopeTarget - this.scopeBlend) * Math.min(1, dt * 9);
    if (Math.abs(this.scopeBlend - scopeTarget) < 0.001) {
      this.scopeBlend = scopeTarget;
    }

    if (this.viewMode === 'third' && this.phase !== 'menu') {
      // The camera hangs behind the eye along the aim ray and looks straight
      // back through it, so the center ray still passes through the head no
      // matter how far a wall pulls the camera in -- the crosshair never lies.
      // The ray is anchored at the UNSHAKEN eye (positional shake would both
      // displace it off the fire ray and let a shaken origin start inside the
      // wall margin); impact feedback still reads through the roll shake and
      // recoil, which rotate the view without moving the ray.
      const aimPitch = this.pitch + this.recoilPitch;
      const aimYaw = this.yaw + this.recoilYaw;
      const cosPitch = Math.cos(aimPitch);
      this.tpAim.set(
        -Math.sin(aimYaw) * cosPitch,
        Math.sin(aimPitch),
        -Math.cos(aimYaw) * cosPitch,
      );
      this.tpRay.origin.set(
        this.renderPosition.x,
        this.renderPosition.y + EYE_HEIGHT,
        this.renderPosition.z,
      );
      this.tpRay.direction.copy(this.tpAim).negate();
      // Scoping glides the camera up the aim ray into the eye: a fully
      // scoped third-person shot is aimed from first-person geometry, so
      // magnification never changes where the crosshair ray actually goes.
      let distance = THIRD_PERSON_DISTANCE * (1 - this.scopeBlend);
      for (const collider of this.arena.colliders) {
        const hit = this.tpRay.intersectBox(collider, this.tpHit);
        if (!hit) continue;
        distance = Math.min(
          distance,
          hit.distanceTo(this.tpRay.origin) - THIRD_PERSON_MARGIN,
        );
      }
      // The open floor plane is not a collider: cap the distance where the
      // ray would dip below the floor instead of clamping camera y after
      // placement, which would lift the camera off the aim ray and make the
      // crosshair miss where the head-anchored shot actually goes.
      if (this.tpAim.y > 0) {
        distance = Math.min(
          distance,
          (this.tpRay.origin.y - THIRD_PERSON_MIN_CAMERA_Y) / this.tpAim.y,
        );
      }
      // A hit inside the margin collapses toward the eye -- never past a hit.
      this.tpDistance = Math.max(0, distance);
      this.camera.position
        .copy(this.tpRay.origin)
        .addScaledVector(this.tpAim, -this.tpDistance);
    } else {
      this.tpDistance = THIRD_PERSON_DISTANCE;
      this.camera.position.set(eyeX, eyeY, eyeZ);
    }

    // Speed lines: field of view widens when moving fast or in Overdrive.
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    // The scope divides the whole target, speed widening included, so a
    // scoped sprint cannot quietly cancel the magnification.
    const targetFov =
      (82 +
        Math.min(9, planarSpeed * 0.55) +
        (this.overdriveActive ? 6 : 0) +
        (this.dashTimer > 0 ? 5 : 0)) /
      this.zoomFactor();
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();

    if (this.bloomPass) {
      const target = this.overdriveActive ? 1.35 : 0.72;
      this.bloomPass.strength +=
        (target - this.bloomPass.strength) * Math.min(1, dt * 3);
    }

    const speed01 = Math.min(1, planarSpeed / this.stats.moveSpeed);
    this.viewModel.update(
      dt,
      speed01,
      this.grounded,
      this.lookDeltaX,
      this.lookDeltaY,
    );
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  }

  /**
   * Current animation inputs for the operator's own body. The rig wants
   * body-local speeds, so world velocity is projected onto the facing basis
   * used by `updatePlayer`: forward is (-sin yaw, 0, -cos yaw), right is
   * (cos yaw, 0, -sin yaw).
   */
  private readLocalPose(): CharacterPose {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const pose = this.localPose;
    pose.forwardSpeed = -(this.velocity.x * sin + this.velocity.z * cos);
    pose.strafeSpeed = this.velocity.x * cos - this.velocity.z * sin;
    pose.verticalSpeed = this.velocity.y;
    pose.grounded = this.grounded;
    pose.aimPitch = this.pitch;
    pose.scoped = this.scopeBlend;
    pose.dashing = this.dashTimer > 0;
    pose.sliding = this.slideCrouch;
    pose.boosting = this.boostTimer > 0 && !this.grounded;
    pose.reloading = this.weapons.length > 0 && this.weapon.reloading;
    pose.dead = this.phase === 'dead';
    return pose;
  }

  /**
   * Squadmates arrive as position and yaw only, so their gait is
   * reconstructed from how far their interpolated body actually moved. The
   * result is smoothed because interpolation makes the raw delta jitter.
   */
  private animateRemote(remote: RemotePlayer, frameDt: number): void {
    if (frameDt <= 0) return;
    const body = remote.group.position;
    const vx = (body.x - remote.lastX) / frameDt;
    const vy = (body.y - remote.lastY) / frameDt;
    const vz = (body.z - remote.lastZ) / frameDt;
    remote.lastX = body.x;
    remote.lastY = body.y;
    remote.lastZ = body.z;

    const yaw = remote.group.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const blend = Math.min(1, frameDt * 10);
    remote.forwardSpeed += (-(vx * sin + vz * cos) - remote.forwardSpeed) * blend;
    remote.strafeSpeed += (vx * cos - vz * sin - remote.strafeSpeed) * blend;
    remote.verticalSpeed += (vy - remote.verticalSpeed) * blend;

    const pose = this.remoteRigPose;
    pose.forwardSpeed = remote.forwardSpeed;
    pose.strafeSpeed = remote.strafeSpeed;
    pose.verticalSpeed = remote.verticalSpeed;
    // No ground flag on the wire: treat a settled vertical speed as standing.
    pose.grounded = Math.abs(remote.verticalSpeed) < 0.6;
    pose.aimPitch = 0;
    pose.scoped = 0;
    pose.dashing = false;
    pose.reloading = false;
    pose.dead = false;
    remote.rig.update(frameDt, pose);
  }

  /**
   * Sizes the dynamic light pool for the active quality tier. Called once at
   * construction and again only on a quality change -- each rebuild costs one
   * shader recompile, which is the whole reason the pool exists.
   */
  private buildDynamicLights(): void {
    const target =
      this.settings.quality === 'low'
        ? 2
        : this.settings.quality === 'medium'
          ? 4
          : 6;
    while (this.dynamicLights.length > target) {
      this.scene.remove(this.dynamicLights.pop()!);
    }
    while (this.dynamicLights.length < target) {
      const light = new THREE.PointLight(0xffffff, 0, 12, 2);
      this.scene.add(light);
      this.dynamicLights.push(light);
    }
    if (this.dynamicLightScores.length !== target) {
      this.dynamicLightScores = new Float32Array(target);
    }
  }

  /** Claims a pool slot if this emitter outranks the weakest one held. */
  private considerLight(
    x: number,
    y: number,
    z: number,
    color: THREE.Color,
    intensity: number,
    range: number,
  ): void {
    const lights = this.dynamicLights;
    const scores = this.dynamicLightScores;
    const cam = this.camera.position;
    const dx = x - cam.x;
    const dy = y - cam.y;
    const dz = z - cam.z;
    // Near and bright wins: a plasma bolt at your feet matters more than a
    // dying grunt across the map.
    const score = intensity / (1 + dx * dx + dy * dy + dz * dz);

    let worst = 0;
    for (let i = 1; i < lights.length; i++) {
      if (scores[i]! < scores[worst]!) worst = i;
    }
    if (score <= scores[worst]!) return;

    scores[worst] = score;
    const light = lights[worst]!;
    light.position.set(x, y, z);
    light.color.copy(color);
    light.intensity = intensity;
    light.distance = range;
  }

  /**
   * Re-points the light pool at whatever is most worth lighting this frame.
   * Render-rate only; it writes nothing the simulation reads.
   */
  private updateDynamicLights(): void {
    const lights = this.dynamicLights;
    if (lights.length === 0) return;

    for (let i = 0; i < lights.length; i++) {
      this.dynamicLightScores[i] = -Infinity;
      // Dimmed, never hidden: dropping a light from the scene would change
      // the shader program key and recompile every material.
      lights[i]!.intensity = 0;
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const at = enemy.visual.group.position;
      const health =
        enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 1;
      this.considerLight(
        at.x,
        at.y,
        at.z,
        enemy.visual.shellMaterial.emissive,
        5 + (1 - health) * 7,
        11,
      );
    }

    for (const projectile of this.projectiles) {
      const at = projectile.mesh.position;
      const material = projectile.mesh.material as THREE.MeshBasicMaterial;
      // Matches the per-bolt lights this pool replaced. Brighter than that
      // and a bolt leaving the muzzle washes out the whole floor in front of
      // the player the instant the bloom pass gets hold of it.
      this.considerLight(
        at.x,
        at.y,
        at.z,
        material.color,
        projectile.fromPlayer ? 12 : 9,
        12,
      );
    }
  }

  /**
   * Trades resolution for framerate. The scale only moves after a sustained
   * run of slow (or fast) frames and never more than once per cooldown, so a
   * single GC pause or spawn spike cannot make the image pulse.
   */
  private adaptRenderScale(frameDt: number): void {
    // A frame this long is a stall, not a slow frame; it says nothing about
    // the resolution the machine can sustain.
    if (frameDt < 0.2) {
      this.frameAverage += (frameDt - this.frameAverage) * 0.05;
    }
    this.scaleCooldown -= frameDt;
    if (this.scaleCooldown > 0) return;

    if (this.frameAverage > 1 / 48 && this.renderScale > 0.6) {
      this.renderScale = Math.max(0.6, this.renderScale - 0.12);
      this.scaleCooldown = 1.5;
      this.applyRenderScale();
    } else if (this.frameAverage < 1 / 85 && this.renderScale < 1) {
      this.renderScale = Math.min(1, this.renderScale + 0.08);
      // Climb back slower than we drop, so a machine sitting near the
      // boundary settles instead of oscillating.
      this.scaleCooldown = 3;
      this.applyRenderScale();
    }
  }

  private applyRenderScale(): void {
    this.renderer.setPixelRatio(
      this.pixelRatioFor(this.settings.quality) * this.renderScale,
    );
    this.resize();
  }

  /** Pushes the active map's theme onto the scene. */
  private applyTheme(): void {
    const t = this.arena.theme;
    (this.scene.background as THREE.Color).set(t.background);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(t.fogColor);
    fog.density = t.fogDensity;
    this.scene.environmentIntensity = t.envIntensity;
  }

  /**
   * Swaps the active map. Only meaningful from the menu -- the arena owns the
   * collider set the simulation reads, so replacing it mid-run would teleport
   * every live enemy into whatever geometry now occupies its position.
   */
  setArena(id: string): void {
    if (id === this.arenaId || this.phase !== 'menu') return;

    const meta = arenaMeta(id);
    this.scene.remove(this.arena.group);
    this.arena.dispose();

    this.arenaId = meta.id;
    this.arena = meta.build();
    this.scene.add(this.arena.group);
    this.applyTheme();

    this.position.copy(this.arena.playerSpawn);
    this.prevPlayerPosition.copy(this.position);
    this.publish();
  }

  private pushFeed(text: string, tone: FeedTone): void {
    this.feedId += 1;
    this.feed.unshift({
      id: this.feedId,
      text,
      tone,
      expires: this.elapsed + 4.5,
    });
    if (this.feed.length > 6) this.feed.length = 6;
  }

  private setAnnouncement(
    text: string,
    sub: string | null,
    duration: number,
  ): void {
    this.announcement = text;
    this.announcementSub = sub;
    this.announcementExpires = this.elapsed + duration;
  }

  private publish(): void {
    const combo = this.currentCombo();
    const accuracy =
      this.shotsFired === 0
        ? 100
        : Math.min(100, (this.shotsHit / this.shotsFired) * 100);

    const snapshot: GameSnapshot = {
      ...createSnapshot(),
      phase: this.phase,
      arenaId: this.arenaId,
      health: Math.max(0, this.health),
      maxHealth: this.stats.maxHealth,
      shield: Math.max(0, this.shield),
      maxShield: this.stats.maxShield,
      dashCharges: this.dashCharges,
      maxDashCharges: this.stats.maxDashCharges,
      dashRecharge:
        this.dashCharges >= this.stats.maxDashCharges ? 1 : this.dashRecharge,
      weapons: this.weapons.map((w) => ({
        id: w.id,
        name: w.name,
        ammo: this.overdriveActive ? this.magazineOf(w) : Math.max(0, w.ammo),
        magazine: this.magazineOf(w),
        reloading: w.reloading,
        reloadProgress: w.reloading
          ? 1 - w.reloadTimer / (w.baseReload * this.stats.reloadMul)
          : 0,
        charge: w.charge,
        chargeable: w.chargeable,
      })),
      activeWeapon: this.activeWeapon,
      modifiers: [...this.modifiers],
      wave: this.wave === 0 ? this.pendingWave : this.wave,
      enemiesRemaining: this.enemies.length + this.waveQueue.length,
      enemiesTotal: this.waveTotal,
      waveCountdown: Math.max(0, this.waveCountdown),
      score: Math.round(this.score),
      combo,
      comboTimer:
        this.chain > 0
          ? Math.max(0, this.comboTimer / this.stats.comboWindow)
          : 0,
      bestCombo: this.bestCombo,
      kills: this.kills,
      rivals: [...this.remotePlayers.values()].map((remote) => ({
        callsign: remote.callsign,
        health: Math.max(0, remote.health),
        maxHealth: Math.max(1, remote.maxHealth),
        dead: remote.dead,
        hostile: this.pvpEnabled,
      })),
      killsByKind: { ...this.killsByKind },
      shotsFired: this.shotsFired,
      accuracy,
      timeSeconds: this.runTime,
      // Rounded off the same smoothed average the adaptive render scale uses,
      // so the number on screen matches the one driving quality decisions.
      fps: Math.min(999, Math.round(1 / Math.max(this.frameAverage, 1 / 999))),
      overdrive: this.overdrive,
      overdriveActive: this.overdriveActive,
      overdriveRemaining: this.overdriveTimer / OVERDRIVE_DURATION,
      markerId: this.markerId,
      markerKind: this.markerKind,
      damageId: this.damageId,
      damageAngle: this.damageAngle,
      announcement:
        this.elapsed < this.announcementExpires ? this.announcement : null,
      announcementSub:
        this.elapsed < this.announcementExpires ? this.announcementSub : null,
      feed: this.feed
        .filter((f) => f.expires > this.elapsed)
        .map((f) => ({ id: f.id, text: f.text, tone: f.tone })),
      upgradeChoices: this.upgradeChoices,
      ownedUpgrades: this.ownedUpgrades,
      pointerLocked: this.pointerLocked,
      scoped: this.scopeBlend > 0.5,
      zoomLevel: this.weapons.length > 0 ? this.weapon.zoom : 1,
      mode: this.mode,
      objective:
        this.modeRuntime?.objective(this.wave === 0 ? this.pendingWave : this.wave) ??
        '',
      opponents: this.modeRuntime?.opponents ?? 0,
      modeTimer: this.modeRuntime?.timer ?? 0,
      zoneRadius: this.modeRuntime?.zoneRadius ?? 0,
      zoneClosing: this.modeRuntime?.zoneClosing ?? false,
      outsideZone: this.modeRuntime?.outsideZone ?? false,
      duelScore: this.modeRuntime
        ? { ...this.modeRuntime.duelScore }
        : { player: 0, rival: 0 },
      duelRound: this.modeRuntime?.duelRound ?? 1,
      huntRole: this.huntRole,
      detection: this.modeRuntime?.detection ?? 0,
      hidersLeft: this.modeRuntime?.hidersLeft ?? 0,
      credits: this.runCredits,
      victory: this.modeVictory,
      boostFuel: this.boostFuel,
      sliding: this.sliding,
    };

    this.emit(snapshot);
  }

  /* =================================================================== */
  /* Frame                                                               */
  /* =================================================================== */

  private readonly tick = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);

    const now = performance.now();
    // Clamp wall-clock delta so a tab-out or long GC pause cannot inject a
    // backlog of hundreds of steps. Anything past this is time the world
    // skips. Held tight so one bad frame stays one bad frame: a looser clamp
    // let a hitch spend the whole next frame catching up, which is what a
    // stutter actually feels like.
    const frameDt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.adaptRenderScale(frameDt);

    this.simAccumulator += frameDt;
    let steps = 0;
    while (this.simAccumulator >= SIM_STEP && steps < MAX_SIM_STEPS) {
      this.simulate(SIM_STEP);
      this.simAccumulator -= SIM_STEP;
      steps += 1;
    }
    // Hitting the ceiling means the machine cannot keep up. Drop the remaining
    // backlog instead of accruing a debt that makes the next frame worse still.
    if (steps === MAX_SIM_STEPS) this.simAccumulator = 0;

    this.present(frameDt, this.simAccumulator / SIM_STEP);
  };

  /**
   * One fixed-size step of the world. Everything that affects gameplay state
   * belongs here and nowhere else -- that invariant is what keeps the game
   * identical across framerates and is the basis for network play.
   */
  private simulate(dt: number): void {
    this.elapsed += dt;

    this.slowmo += (this.slowmoTarget - this.slowmo) * Math.min(1, dt * 3.4);
    const worldDt = dt * this.slowmo;
    // The player stays comparatively crisp during slow motion.
    const playerDt = dt * (0.45 + this.slowmo * 0.55);

    if (this.phase === 'playing') {
      this.runTime += dt;

      this.modeRuntime?.tick(dt);

      if (this.waveCountdown > 0) {
        this.waveCountdown -= dt;
        if (this.waveCountdown <= 0) {
          this.waveCountdown = 0;
          this.startWave(this.pendingWave);
        }
      }

      if (this.clearing) {
        this.clearTimer -= dt;
        if (this.clearTimer <= 0) {
          this.clearing = false;
          this.slowmoTarget = 1;
          this.upgradeChoices = this.upgrades.roll(3);
          if (this.upgradeChoices.length > 0) {
            this.setPhase('intermission');
          } else {
            this.pushFeed('ALL SYSTEMS MAXED', 'buff');
            this.beginCountdown(this.wave + 1, 3);
          }
        }
      } else if (this.waveQueue.length > 0 && this.waveCountdown <= 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = Math.max(0.22, 0.85 - this.wave * 0.045);
          this.spawnFromQueue();
        }
      }

      this.updatePlayer(playerDt);
      this.updateEnemies(worldDt * (this.overdriveActive ? 0.62 : 1), dt);
      this.updateProjectiles(worldDt);
    } else if (this.phase === 'dead') {
      this.slowmoTarget = 1;
      this.updateEnemies(worldDt * 0.4, dt);
      this.updateProjectiles(worldDt * 0.4);
    }
  }

  /**
   * Render-rate presentation. Reads simulation state but never writes it, so
   * a dropped or doubled frame can never change the outcome of a run.
   *
   * `alpha` is how far we are between the last two simulation steps; bodies are
   * drawn at that point so 60Hz simulation still looks smooth on a 144Hz panel.
   */
  /**
   * Link every shader before the run starts.
   *
   * A material is not a GPU program until the first frame that draws it, and
   * that link costs tens of milliseconds. It is the whole explanation for the
   * stutters players reported: the first plasma bolt, the first time the body
   * appeared in third person and the first sight of a new archetype each paid
   * for their own compile mid-fight. Measured on this machine, the character
   * rig alone linked six programs the first time it was drawn.
   *
   * So: one throwaway 4x4 render with everything in the scene made visible,
   * plus a prototype of every archetype and projectile that is normally built
   * on demand. `compile()` does the frustum-independent pass, the render is
   * the belt to its braces.
   *
   * The prototypes are kept, invisible, for the lifetime of the engine on
   * purpose. Three reference-counts programs per material, so disposing them
   * here would delete the very programs this exists to build.
   */
  private prewarmShaders(): void {
    const group = new THREE.Group();
    group.name = 'prewarm';
    // Well below the floor, so a later frame that forgets to cull them still
    // draws nothing a player can see.
    group.position.set(0, -500, 0);

    for (const kind of Object.keys(ENEMY_CONFIG) as EnemyKind[]) {
      const visual = buildEnemyVisual(kind);
      group.add(visual.group);
      this.prewarmVisuals.push(visual);
    }
    for (const material of [this.plasmaMat, this.orbMat, this.bruteOrbMat]) {
      group.add(new THREE.Mesh(this.projectileGeo, material));
    }
    this.scene.add(group);
    this.prewarmGroup = group;

    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((object) => {
      if (!object.visible) {
        hidden.push(object);
        object.visible = true;
      }
    });

    try {
      this.renderer.compile(this.scene, this.camera);
      const target = new THREE.WebGLRenderTarget(4, 4);
      const previous = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(previous);
      target.dispose();
    } catch {
      // A prewarm failure is never worth taking the game down for: the worst
      // case is the stutter this method exists to remove.
    }

    for (const object of hidden) object.visible = false;
    group.visible = false;
  }

  private present(frameDt: number, alpha: number): void {
    for (const enemy of this.enemies) {
      enemy.visual.group.position.lerpVectors(
        enemy.prevPosition,
        enemy.position,
        alpha,
      );
    }
    for (const p of this.projectiles) {
      p.mesh.position.lerpVectors(p.prevPosition, p.position, alpha);
    }
    const remoteBlend = 1 - Math.exp(-frameDt * 16);
    for (const remote of this.remotePlayers.values()) {
      remote.group.position.lerp(remote.target, remoteBlend);
      let turn = remote.yaw - remote.group.rotation.y;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      remote.group.rotation.y += turn * remoteBlend;
      this.animateRemote(remote, frameDt);
    }

    this.particles.update(frameDt);
    this.tracers.update(frameDt);
    this.rings.update(frameDt);
    this.numbers.update(frameDt);
    this.numbers.group.children.forEach((child) => {
      if (child.visible) child.lookAt(this.camera.position);
    });

    this.updateCamera(frameDt, alpha);

    // Menus orbit the arena so the title screen is never a still image.
    if (this.phase === 'menu') {
      const orbit = this.arena.theme.menuOrbit;
      const t = this.elapsed * 0.09;
      this.camera.position.set(
        Math.cos(t) * orbit.radius,
        orbit.height + Math.sin(t * 1.6) * orbit.bob,
        Math.sin(t) * orbit.radius,
      );
      this.camera.lookAt(...orbit.lookAt);
      this.viewModel.group.visible = false;
    } else {
      // Scoped third person has pulled the camera into the eye, so the
      // first-person weapon is the thing that should be on screen there.
      this.viewModel.group.visible =
        this.phase !== 'dead' &&
        (this.viewMode === 'first' || this.scopeBlend > 0.6);
    }

    const showBody =
      this.viewMode === 'third' &&
      this.phase !== 'menu' &&
      this.tpDistance > THIRD_PERSON_AVATAR_HIDE;
    this.localRig.group.visible = showBody;
    if (showBody) {
      this.localRig.group.position.copy(this.renderPosition);
      // Yaw goes on before the update so the rig can measure how fast the
      // aim turned and let the hips trail it.
      this.localRig.group.rotation.y = this.yaw;
      this.localRig.update(frameDt, this.readLocalPose());
    }

    this.updateDynamicLights();

    this.arena.pulseMaterials.forEach((mat, index) => {
      const base = 1.15 + index * 0.12;
      mat.emissiveIntensity =
        base + Math.sin(this.elapsed * (1.4 + index * 0.4)) * 0.22;
    });

    this.snapshotAccumulator += frameDt;
    if (this.snapshotAccumulator >= SNAPSHOT_INTERVAL) {
      this.snapshotAccumulator = 0;
      this.publish();
    }

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

function createWeapon(id: WeaponId): WeaponRuntime {
  const tuning = WEAPON_TUNING[id];
  return {
    id,
    name: weaponInfo(id).name,
    ...tuning,
    ammo: tuning.baseMagazine,
    cooldown: 0,
    reloading: false,
    reloadTimer: 0,
    charge: 0,
  };
}
