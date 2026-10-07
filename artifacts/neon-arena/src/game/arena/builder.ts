import * as THREE from 'three';

/**
 * Everything the renderer needs to dress a map. Kept as data on the arena so
 * the engine never hardcodes a look -- swapping maps swaps the whole mood.
 */
export interface ArenaTheme {
  /** Scene clear colour. */
  background: number;
  fogColor: number;
  fogDensity: number;
  /** Strength of the generated room environment reflection. */
  envIntensity: number;
  /** Idle camera path used on the title screen. */
  menuOrbit: {
    radius: number;
    height: number;
    bob: number;
    lookAt: [number, number, number];
  };
  /** Tint of the tracer/impact palette so effects match the map. */
  accent: number;
}

export interface Arena {
  id: string;
  name: string;
  group: THREE.Group;
  /** Solid world geometry the player, enemies and projectiles collide with. */
  colliders: THREE.Box3[];
  /** Where enemy waves materialise. */
  spawnPoints: THREE.Vector3[];
  playerSpawn: THREE.Vector3;
  /** Playable floor extent, half-width in X and Z. */
  half: number;
  theme: ArenaTheme;
  /** Emissive strips that pulse with the action. */
  pulseMaterials: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

export interface ArenaMeta {
  id: string;
  name: string;
  tagline: string;
  /** Two-colour swatch shown on the map select card. */
  swatch: [number, number];
  build: () => Arena;
}

/**
 * Procedural floor plating. Generated rather than shipped as an asset so each
 * map can retint it without another texture download.
 */
export function gridTexture(
  base: string,
  line: string,
  edge: string,
): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const p = (size / 4) * i;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }

    ctx.strokeStyle = edge;
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, size, size);

    // Worn plating speckle so the floor is not perfectly flat.
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.fillStyle = `rgba(140, 170, 200, ${Math.random() * 0.05})`;
      ctx.fillRect(x, y, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Accumulates map geometry and emits one InstancedMesh per material.
 *
 * Maps are built almost entirely from axis-aligned boxes. Adding each as its
 * own Mesh produced roughly 210 draw calls for a single arena, which dominated
 * the frame on integrated GPUs. Batching by material collapses that to one
 * call per material -- typically five or six for a whole map -- for identical
 * output.
 */
export class ArenaBuilder {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  readonly pulseMaterials: THREE.MeshStandardMaterial[] = [];
  readonly spawnPoints: THREE.Vector3[] = [];

  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly batches = new Map<THREE.Material, THREE.Matrix4[]>();
  private readonly boxGeo: THREE.BoxGeometry;
  private readonly scratch = new THREE.Matrix4();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3();

  constructor() {
    this.boxGeo = this.track(new THREE.BoxGeometry(1, 1, 1));
  }

  track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  /** Registers a material whose emissive intensity breathes with the action. */
  pulse<T extends THREE.MeshStandardMaterial>(mat: T): T {
    this.pulseMaterials.push(mat);
    return mat;
  }

  /**
   * A standard emissive trim material. Emissive stays near 1.0 on purpose:
   * push it much past that and ACES tonemapping desaturates the neon to white,
   * which the bloom pass then smears across the whole screen.
   */
  trim(color: number, intensity: number): THREE.MeshStandardMaterial {
    return this.track(
      new THREE.MeshStandardMaterial({
        color: 0x05070a,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.3,
        metalness: 0.1,
      }),
    );
  }

  /** Solid metal. Metalness stays low -- without an env map, metallic
   *  surfaces have nothing to reflect and render nearly black. */
  hull(color: number, roughness = 0.6, metalness = 0.22) {
    return this.track(
      new THREE.MeshStandardMaterial({ color, roughness, metalness }),
    );
  }

  /** Places a box and, unless told otherwise, registers its collider. */
  solid(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    collide = true,
  ): void {
    this.scratchPos.set(x, y + h / 2, z);
    this.scratchScale.set(w, h, d);
    this.scratch.compose(this.scratchPos, this.scratchQuat, this.scratchScale);

    let batch = this.batches.get(mat);
    if (!batch) {
      batch = [];
      this.batches.set(mat, batch);
    }
    batch.push(this.scratch.clone());

    if (collide) {
      this.colliders.push(
        new THREE.Box3(
          new THREE.Vector3(x - w / 2, y, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2),
        ),
      );
    }
  }

  /**
   * A glowing lip around the top face of a block: four thin bars rather than a
   * filled plate, so cover reads as a lit rectangle instead of a glowing slab.
   */
  capTrim(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    mat: THREE.Material,
  ): void {
    const t = 0.3;
    const h = 0.14;
    this.solid(x, y, z - d / 2, w + 0.24, h, t, mat, false);
    this.solid(x, y, z + d / 2, w + 0.24, h, t, mat, false);
    this.solid(x - w / 2, y, z, t, h, d + 0.24, mat, false);
    this.solid(x + w / 2, y, z, t, h, d + 0.24, mat, false);
  }

  /** Adds a free-form object that is not part of the box batching. */
  add(object: THREE.Object3D): void {
    this.group.add(object);
  }

  /** Ring of spawn points at a given radius, skipping blocked angles. */
  spawnRing(radius: number, count: number, y: number, offset = 0.31): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + offset;
      this.spawnPoints.push(
        new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
      );
    }
  }

  /**
   * Same overlap rule the engine uses when it validates a spawn, so a point
   * that passes here will not be rejected at runtime.
   */
  private clearAt(x: number, y: number, z: number, radius: number): boolean {
    for (const box of this.colliders) {
      if (
        x > box.min.x - radius &&
        x < box.max.x + radius &&
        z > box.min.z - radius &&
        z < box.max.z + radius &&
        y > box.min.y - radius &&
        y < box.max.y + radius
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Nudges spawn points out of the geometry authored on top of them.
   *
   * Hand-placed rings inevitably clip a pillar or a perch. The engine already
   * retries blocked spawns, but a map where half the ring is buried funnels
   * every wave through the surviving points, so waves arrive from the same two
   * angles. Resolving at build time costs nothing and keeps the ring honest.
   */
  private resolveSpawnPoints(half: number): void {
    const CLEARANCE = 1.0; // Largest enemy radius plus slack.
    const MIN_SEPARATION = 3;

    // Candidate offsets ordered by how far they move the point, so a spawn
    // shifts the least amount needed to become usable.
    const candidates: Array<[number, number]> = [];
    for (let r = 0; r <= 6; r++) {
      for (let a = 0; a <= 10; a++) {
        const dr = r * 1.5;
        const da = a * 0.11;
        candidates.push([da, dr], [-da, dr], [da, -dr], [-da, -dr]);
      }
    }

    const kept: THREE.Vector3[] = [];
    for (const p of this.spawnPoints) {
      const baseRadius = Math.hypot(p.x, p.z);
      const baseAngle = Math.atan2(p.z, p.x);
      const ordered = candidates
        .map(([da, dr]) => ({ da, dr, cost: Math.abs(da) * baseRadius + Math.abs(dr) }))
        .sort((l, r) => l.cost - r.cost);

      for (const { da, dr } of ordered) {
        const radius = baseRadius + dr;
        if (radius < 4 || radius > half - 2) continue;
        const angle = baseAngle + da;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (!this.clearAt(x, p.y, z, CLEARANCE)) continue;
        // Keep the ring spread out rather than collapsing several blocked
        // points onto the same clear pocket.
        if (kept.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < MIN_SEPARATION ** 2)) {
          continue;
        }
        kept.push(new THREE.Vector3(x, p.y, z));
        break;
      }
    }

    this.spawnPoints.length = 0;
    this.spawnPoints.push(...kept);
  }

  /** Drifting motes. Cheap atmosphere that hides the empty upper volume. */
  dust(count: number, half: number, height: number, color: number): void {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * half * 2;
      positions[i * 3 + 1] = Math.random() * height;
      positions[i * 3 + 2] = (Math.random() - 0.5) * half * 2;
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = this.track(
      new THREE.PointsMaterial({
        color,
        size: 0.09,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.group.add(new THREE.Points(geo, mat));
  }

  /** Flushes batched boxes into InstancedMeshes and seals the arena. */
  finish(config: {
    id: string;
    name: string;
    playerSpawn: THREE.Vector3;
    half: number;
    theme: ArenaTheme;
  }): Arena {
    for (const [mat, matrices] of this.batches) {
      const mesh = new THREE.InstancedMesh(this.boxGeo, mat, matrices.length);
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]!);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // The arena is always around the player; per-instance culling would cost
      // more than it saves.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      // InstancedMesh owns a GPU buffer of its own, separate from the shared
      // geometry and material, so it has to be released on map teardown.
      this.track(mesh);
    }
    this.batches.clear();
    this.resolveSpawnPoints(config.half);

    const disposables = this.disposables;
    return {
      id: config.id,
      name: config.name,
      group: this.group,
      colliders: this.colliders,
      spawnPoints: this.spawnPoints,
      playerSpawn: config.playerSpawn,
      half: config.half,
      theme: config.theme,
      pulseMaterials: this.pulseMaterials,
      dispose: () => disposables.forEach((d) => d.dispose()),
    };
  }
}

/** Highest solid surface directly under a world point, 0 if only floor. */
export function surfaceHeightAt(
  colliders: THREE.Box3[],
  x: number,
  z: number,
  ceiling: number,
): number {
  let best = 0;
  for (const box of colliders) {
    if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) {
      continue;
    }
    if (box.max.y > best && box.max.y <= ceiling) best = box.max.y;
  }
  return best;
}
