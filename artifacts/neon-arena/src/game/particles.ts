import * as THREE from 'three';

const PARTICLE_VERT = /* glsl */ `
  attribute vec3 pColor;
  attribute float pSize;
  attribute float pAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = pColor;
    vAlpha = pAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = pSize * (320.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float falloff = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * falloff * 1.6, vAlpha * falloff);
  }
`;

export interface BurstOptions {
  count: number;
  color: THREE.ColorRepresentation;
  /** Metres per second, randomised between min and max. */
  speed: number;
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  /** Bias the burst along this direction instead of a full sphere. */
  direction?: THREE.Vector3;
}

/** Pooled additive point sprites used for sparks, gibs, smoke and embers. */
export class ParticleField {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly velocity: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Color();
  /**
   * Slots `[0, liveCount)` hold live particles and nothing else. Expiring one
   * swaps the last live slot into its place, so the per-frame scan, the draw
   * range and the buffer upload all shrink the moment effects stop -- a
   * circular cursor would leave one straggler at a high index and keep the
   * whole buffer in play every frame.
   */
  private liveCount = 0;
  /** Rotates which live particle gets stolen when a burst overflows. */
  private overflowCursor = 0;

  constructor(capacity = 3000) {
    this.capacity = capacity;
    this.position = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);

    // Park unused particles far below the arena.
    for (let i = 0; i < capacity; i++) this.position[i * 3 + 1] = -1000;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.position, 3),
    );
    this.geometry.setAttribute(
      'pColor',
      new THREE.BufferAttribute(this.color, 3),
    );
    this.geometry.setAttribute('pSize', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute(
      'pAlpha',
      new THREE.BufferAttribute(this.alpha, 1),
    );
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      500,
    );

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  burst(origin: THREE.Vector3, options: BurstOptions): void {
    const {
      count,
      speed,
      spread = 1,
      size = 0.35,
      life = 0.6,
      gravity = -14,
      drag = 1.6,
      direction,
    } = options;

    this.tmp.set(options.color as THREE.ColorRepresentation);

    for (let n = 0; n < count; n++) {
      let i: number;
      if (this.liveCount < this.capacity) {
        i = this.liveCount++;
      } else {
        // Full: cut an existing particle short rather than dropping the new
        // one, rotating the victim so the same slot is not always robbed.
        i = this.overflowCursor;
        this.overflowCursor = (this.overflowCursor + 1) % this.capacity;
      }

      const i3 = i * 3;
      this.position[i3] = origin.x;
      this.position[i3 + 1] = origin.y;
      this.position[i3 + 2] = origin.z;

      // Uniform point on a sphere, optionally pulled toward a direction.
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      let dx = r * Math.cos(theta);
      let dy = u;
      let dz = r * Math.sin(theta);

      if (direction) {
        dx = dx * spread + direction.x;
        dy = dy * spread + direction.y;
        dz = dz * spread + direction.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len;
        dy /= len;
        dz /= len;
      }

      const v = speed * (0.35 + Math.random() * 0.85);
      this.velocity[i3] = dx * v;
      this.velocity[i3 + 1] = dy * v;
      this.velocity[i3 + 2] = dz * v;

      const jitter = 0.75 + Math.random() * 0.6;
      this.color[i3] = this.tmp.r * jitter;
      this.color[i3 + 1] = this.tmp.g * jitter;
      this.color[i3 + 2] = this.tmp.b * jitter;

      this.size[i] = size * (0.6 + Math.random() * 0.9);
      this.alpha[i] = 1;
      this.maxLife[i] = life * (0.65 + Math.random() * 0.7);
      this.life[i] = this.maxLife[i]!;
      this.gravity[i] = gravity;
      this.drag[i] = drag;
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.liveCount) {
      const next = this.life[i]! - dt;
      const i3 = i * 3;

      if (next <= 0) {
        // Swap-remove: the tail particle moves into this slot, so the same
        // index has to be revisited rather than stepped over.
        this.retireSlot(i);
        continue;
      }

      this.life[i] = next;
      const damping = Math.max(0, 1 - this.drag[i]! * dt);
      this.velocity[i3] *= damping;
      this.velocity[i3 + 1] =
        this.velocity[i3 + 1]! * damping + this.gravity[i]! * dt;
      this.velocity[i3 + 2] *= damping;

      this.position[i3] += this.velocity[i3]! * dt;
      this.position[i3 + 1] += this.velocity[i3 + 1]! * dt;
      this.position[i3 + 2] += this.velocity[i3 + 2]! * dt;

      // Bounce off the floor instead of sinking through it.
      if (this.position[i3 + 1]! < 0.05) {
        this.position[i3 + 1] = 0.05;
        this.velocity[i3 + 1] = Math.abs(this.velocity[i3 + 1]!) * 0.32;
        this.velocity[i3] *= 0.7;
        this.velocity[i3 + 2] *= 0.7;
      }

      this.alpha[i] = Math.min(1, (next / this.maxLife[i]!) * 1.6);
      i++;
    }

    this.geometry.setDrawRange(0, this.liveCount);
    if (this.liveCount === 0) return;

    // Everything live moved this frame and lives in one dense block, so a
    // single range per attribute covers the upload -- and it costs nothing
    // once the arena is quiet again.
    this.uploadRange('position', this.liveCount * 3);
    this.uploadRange('pColor', this.liveCount * 3);
    this.uploadRange('pAlpha', this.liveCount);
    this.uploadRange('pSize', this.liveCount);
  }

  private uploadRange(name: string, count: number): void {
    const attribute = this.geometry.attributes[name] as THREE.BufferAttribute;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count);
    attribute.needsUpdate = true;
  }

  /** Drops slot `i` by moving the last live particle into it. */
  private retireSlot(i: number): void {
    const last = --this.liveCount;
    if (i !== last) {
      const to = i * 3;
      const from = last * 3;
      for (let k = 0; k < 3; k++) {
        this.position[to + k] = this.position[from + k]!;
        this.color[to + k] = this.color[from + k]!;
        this.velocity[to + k] = this.velocity[from + k]!;
      }
      this.size[i] = this.size[last]!;
      this.alpha[i] = this.alpha[last]!;
      this.life[i] = this.life[last]!;
      this.maxLife[i] = this.maxLife[last]!;
      this.gravity[i] = this.gravity[last]!;
      this.drag[i] = this.drag[last]!;
    }
    // Park the vacated tail slot: it is outside the draw range now, but a
    // stale position would flash if the slot is reused before the next upload.
    this.life[last] = 0;
    this.alpha[last] = 0;
    this.position[last * 3 + 1] = -1000;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface Tracer {
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: THREE.Color;
  life: number;
  maxLife: number;
  sequence: number;
}

/** Short-lived additive lines for bullet trails. */
export class TracerField {
  readonly lines: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly active: Tracer[] = [];
  private readonly available: Tracer[] = [];
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private sequence = 0;

  constructor(capacity = 96) {
    this.positions = new Float32Array(capacity * 6);
    this.colors = new Float32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const tracer = {
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        color: new THREE.Color(),
        life: 0,
        maxLife: 0,
        sequence: 0,
      };
      this.available.push(tracer);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colors, 3),
    );
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
  }

  add(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: THREE.ColorRepresentation,
    life = 0.07,
  ): void {
    let tracer = this.available.pop();
    if (!tracer) {
      let oldest = 0;
      for (let i = 1; i < this.active.length; i++) {
        if (this.active[i]!.sequence < this.active[oldest]!.sequence) {
          oldest = i;
        }
      }
      tracer = this.removeActive(oldest);
    }
    tracer.from.copy(from);
    tracer.to.copy(to);
    tracer.color.set(color);
    tracer.life = life;
    tracer.maxLife = life;
    tracer.sequence = this.sequence++;
    this.active.push(tracer);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tracer = this.active[i]!;
      tracer.life -= dt;
      if (tracer.life <= 0) {
        this.available.push(this.removeActive(i));
      }
    }

    const count = this.active.length;
    for (let i = 0; i < count; i++) {
      const t = this.active[i]!;
      const o = i * 6;
      this.positions[o] = t.from.x;
      this.positions[o + 1] = t.from.y;
      this.positions[o + 2] = t.from.z;
      this.positions[o + 3] = t.to.x;
      this.positions[o + 4] = t.to.y;
      this.positions[o + 5] = t.to.z;

      const fade = Math.max(0, t.life / t.maxLife);
      const head = fade * 1.4;
      this.colors[o] = t.color.r * fade * 0.35;
      this.colors[o + 1] = t.color.g * fade * 0.35;
      this.colors[o + 2] = t.color.b * fade * 0.35;
      this.colors[o + 3] = t.color.r * head;
      this.colors[o + 4] = t.color.g * head;
      this.colors[o + 5] = t.color.b * head;
    }

    this.geometry.setDrawRange(0, count * 2);
    if (count > 0) {
      const position = this.geometry.attributes.position as THREE.BufferAttribute;
      const color = this.geometry.attributes.color as THREE.BufferAttribute;
      position.clearUpdateRanges();
      position.addUpdateRange(0, count * 6);
      position.needsUpdate = true;
      color.clearUpdateRanges();
      color.addUpdateRange(0, count * 6);
      color.needsUpdate = true;
    }
  }

  clear(): void {
    while (this.active.length > 0) {
      this.available.push(this.active.pop()!);
    }
    this.geometry.setDrawRange(0, 0);
  }

  private removeActive(index: number): Tracer {
    const removed = this.active[index]!;
    const last = this.active.pop()!;
    if (index < this.active.length) this.active[index] = last;
    return removed;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface Ring {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  scaleFrom: number;
  scaleTo: number;
  active: boolean;
}

/** Expanding shockwave rings for explosions and slams. */
export class RingField {
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly active: Ring[] = [];
  private readonly geometry: THREE.RingGeometry;
  private cursor = 0;

  constructor(capacity = 18) {
    this.geometry = new THREE.RingGeometry(0.72, 1, 48);
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.rings.push({
        mesh,
        material,
        life: 0,
        maxLife: 1,
        scaleFrom: 1,
        scaleTo: 2,
        active: false,
      });
    }
  }

  spawn(
    position: THREE.Vector3,
    color: THREE.ColorRepresentation,
    from: number,
    to: number,
    life: number,
    flat: boolean,
    facing?: THREE.Vector3,
  ): void {
    const ring = this.rings[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.rings.length;

    ring.mesh.position.copy(position);
    ring.mesh.visible = true;
    if (flat) {
      ring.mesh.rotation.set(-Math.PI / 2, 0, 0);
    } else if (facing) {
      ring.mesh.lookAt(facing);
    }
    ring.material.color.set(color);
    ring.material.opacity = 1;
    ring.scaleFrom = from;
    ring.scaleTo = to;
    ring.life = life;
    ring.maxLife = life;
    if (!ring.active) {
      ring.active = true;
      this.active.push(ring);
    }
    ring.mesh.scale.setScalar(from);
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ring = this.active[i]!;
      ring.life -= dt;
      if (ring.life <= 0) {
        ring.active = false;
        ring.mesh.visible = false;
        ring.material.opacity = 0;
        const last = this.active.pop()!;
        if (i < this.active.length) {
          this.active[i] = last;
        }
        continue;
      }
      const t = 1 - ring.life / ring.maxLife;
      const eased = 1 - Math.pow(1 - t, 3);
      ring.mesh.scale.setScalar(
        ring.scaleFrom + (ring.scaleTo - ring.scaleFrom) * eased,
      );
      ring.material.opacity = (1 - t) * 0.85;
    }
  }

  reset(): void {
    for (const ring of this.active) {
      ring.active = false;
      ring.mesh.visible = false;
    }
    this.active.length = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.rings.forEach((r) => r.material.dispose());
  }
}

interface FloatingNumber {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
  active: boolean;
}

/** Damage numbers that pop off enemies as they are hit. */
export class DamageNumbers {
  readonly group = new THREE.Group();
  private readonly pool: FloatingNumber[] = [];
  private readonly active: FloatingNumber[] = [];
  private readonly cache = new Map<string, THREE.Texture>();
  private cursor = 0;

  constructor(capacity = 28) {
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 6;
      this.group.add(sprite);
      this.pool.push({
        sprite,
        material,
        life: 0,
        maxLife: 1,
        velocity: new THREE.Vector3(),
        active: false,
      });
    }
  }

  private texture(value: number, crit: boolean): THREE.Texture {
    const key = `${value}:${crit ? 'c' : 'n'}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const text = String(value);
      ctx.font = `900 ${crit ? 86 : 68}px "Rajdhani", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = crit ? '#ff8a00' : '#00d5ff';
      ctx.shadowBlur = 22;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(4, 6, 10, 0.92)';
      ctx.strokeText(text, 128, 64);
      ctx.fillStyle = crit ? '#ffd166' : '#e8feff';
      ctx.fillText(text, 128, 64);
    }

    const tex = new THREE.CanvasTexture(canvas);
    // Bound the cache so a long run cannot leak textures.
    if (this.cache.size > 220) {
      const first = this.cache.keys().next();
      if (!first.done) {
        this.cache.get(first.value)?.dispose();
        this.cache.delete(first.value);
      }
    }
    this.cache.set(key, tex);
    return tex;
  }

  spawn(position: THREE.Vector3, value: number, crit: boolean): void {
    const entry = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.pool.length;

    entry.material.map = this.texture(Math.max(1, Math.round(value)), crit);
    entry.material.needsUpdate = true;
    entry.sprite.position.copy(position);
    entry.sprite.position.x += (Math.random() - 0.5) * 0.7;
    entry.sprite.position.z += (Math.random() - 0.5) * 0.7;
    const scale = crit ? 1.5 : 1.05;
    entry.sprite.scale.set(scale * 1.6, scale * 0.8, 1);
    entry.sprite.visible = true;
    entry.velocity.set(
      (Math.random() - 0.5) * 1.4,
      3.2 + Math.random() * 1.2,
      (Math.random() - 0.5) * 1.4,
    );
    entry.maxLife = crit ? 1.0 : 0.75;
    entry.life = entry.maxLife;
    if (!entry.active) {
      entry.active = true;
      this.active.push(entry);
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i]!;
      entry.life -= dt;
      if (entry.life <= 0) {
        entry.active = false;
        entry.sprite.visible = false;
        entry.material.opacity = 0;
        const last = this.active.pop()!;
        if (i < this.active.length) {
          this.active[i] = last;
        }
        continue;
      }
      entry.velocity.y -= 6 * dt;
      entry.sprite.position.addScaledVector(entry.velocity, dt);
      const t = entry.life / entry.maxLife;
      entry.material.opacity = Math.min(1, t * 2.2);
    }
  }

  reset(): void {
    for (const entry of this.active) {
      entry.active = false;
      entry.sprite.visible = false;
    }
    this.active.length = 0;
  }

  dispose(): void {
    this.pool.forEach((p) => p.material.dispose());
    this.cache.forEach((t) => t.dispose());
    this.cache.clear();
  }
}
