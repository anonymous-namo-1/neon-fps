import * as THREE from 'three';
import type { WeaponId } from './contract';

export type CharacterPalette = {
  body: number;
  emissive: number;
  wire: number;
  visor: number;
};

export const LOCAL_PALETTE: CharacterPalette = {
  body: 0x36102c,
  emissive: 0xff2d78,
  wire: 0xffb1d3,
  visor: 0x9fe9ff,
};

export const REMOTE_PALETTE: CharacterPalette = {
  body: 0x102c36,
  emissive: 0x22e0ff,
  wire: 0x9fe9ff,
  visor: 0xffd27a,
};

export interface CharacterPose {
  forwardSpeed: number;
  strafeSpeed: number;
  verticalSpeed: number;
  grounded: boolean;
  aimPitch: number;
  scoped: number;
  dashing: boolean;
  /** 0 to 1 crouch blend while sliding along the ground. */
  sliding: number;
  /** True while the thruster is burning. */
  boosting: boolean;
  reloading: boolean;
  dead: boolean;
}

/*
 * Geometry belongs to the module rather than an individual rig. Character
 * materials are deliberately per-instance, since they carry squad colours.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>();

function cachedGeometry(
  key: string,
  make: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry;
}

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `b:${w}:${h}:${d}`;
  return cachedGeometry(key, () => new THREE.BoxGeometry(w, h, d));
}

function sphere(
  radius: number,
  width = 10,
  height = 7,
): THREE.BufferGeometry {
  const key = `s:${radius}:${width}:${height}`;
  return cachedGeometry(
    key,
    () => new THREE.SphereGeometry(radius, width, height),
  );
}

function cylinder(
  top: number,
  bottom: number,
  height: number,
  sides = 8,
): THREE.BufferGeometry {
  const key = `c:${top}:${bottom}:${height}:${sides}`;
  return cachedGeometry(
    key,
    () => new THREE.CylinderGeometry(top, bottom, height, sides),
  );
}

function torus(
  radius: number,
  tube: number,
  radial = 6,
  tubular = 12,
): THREE.BufferGeometry {
  const key = `t:${radius}:${tube}:${radial}:${tubular}`;
  return cachedGeometry(
    key,
    () => new THREE.TorusGeometry(radius, tube, radial, tubular),
  );
}

type Side = -1 | 1;

/**
 * A lightweight, primitive-only third-person operator. All articulated mesh
 * pieces hang below their joint group, so rotations happen at real pivots.
 */
export class CharacterRig {
  readonly group = new THREE.Group();

  private readonly hips = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoulderL = new THREE.Group();
  private readonly shoulderR = new THREE.Group();
  private readonly upperArmL = new THREE.Group();
  private readonly upperArmR = new THREE.Group();
  private readonly forearmL = new THREE.Group();
  private readonly forearmR = new THREE.Group();
  private readonly handL = new THREE.Group();
  private readonly handR = new THREE.Group();
  private readonly thighL = new THREE.Group();
  private readonly thighR = new THREE.Group();
  private readonly shinL = new THREE.Group();
  private readonly shinR = new THREE.Group();
  private readonly footL = new THREE.Group();
  private readonly footR = new THREE.Group();
  private readonly weaponAnchor = new THREE.Group();
  private readonly weapons: Record<WeaponId, THREE.Group>;
  private readonly materials: THREE.Material[] = [];
  /** Kept by role so a shop skin can recolour the rig without rebuilding it. */
  private skinMaterials: {
    body: THREE.MeshStandardMaterial;
    glow: THREE.MeshBasicMaterial;
    wire: THREE.MeshBasicMaterial;
  } | null = null;

  private gaitPhase = 0;
  private idlePhase = 0;
  private reloadPhase = 0;
  private recoil = 0;
  private landing = 0;
  private lastVerticalSpeed = 0;
  private wasGrounded = true;
  private hipsLag = 0;
  private previousAimYaw = 0;
  private activeWeapon: WeaponId = 'pulse';

  constructor(palette: CharacterPalette) {
    this.group.name = 'character';
    this.hips.name = 'hips';
    this.spine.name = 'spine';
    this.chest.name = 'chest';
    this.neck.name = 'neck';
    this.head.name = 'head';
    this.weaponAnchor.name = 'weaponAnchor';

    const body = this.material(
      new THREE.MeshStandardMaterial({
        color: palette.body,
        emissive: palette.emissive,
        emissiveIntensity: 0.22,
        roughness: 0.38,
        metalness: 0.82,
        flatShading: true,
      }),
    );
    const dark = this.material(
      new THREE.MeshStandardMaterial({
        color: 0x090c12,
        roughness: 0.62,
        metalness: 0.72,
      }),
    );
    const glow = this.material(
      new THREE.MeshBasicMaterial({ color: palette.emissive }),
    );
    const visor = this.material(
      new THREE.MeshBasicMaterial({ color: palette.visor }),
    );
    const wire = this.material(
      new THREE.MeshBasicMaterial({
        color: palette.wire,
        wireframe: true,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.group.add(this.hips);
    this.hips.position.y = 0.91;
    this.hips.add(this.spine, this.thighL, this.thighR);
    this.spine.position.y = 0.06;
    this.spine.add(this.chest);
    this.chest.position.y = 0.18;
    this.chest.add(this.neck, this.shoulderL, this.shoulderR);
    this.neck.position.y = 0.34;
    this.neck.add(this.head);
    this.head.position.y = 0.11;

    this.mesh(this.hips, box(0.34, 0.17, 0.22), body, 0, 0, 0);
    this.mesh(this.spine, box(0.22, 0.22, 0.16), dark, 0, 0.09, 0);
    this.mesh(this.chest, box(0.43, 0.32, 0.22), body, 0, 0.15, 0);
    const chestWire = this.mesh(
      this.chest,
      box(0.43, 0.32, 0.22),
      wire,
      0,
      0.15,
      0,
    );
    chestWire.scale.setScalar(1.035);
    this.mesh(this.chest, box(0.025, 0.27, 0.014), glow, 0, 0.13, 0.118);
    for (let i = 0; i < 3; i++) {
      this.mesh(
        this.spine,
        box(0.25, 0.025, 0.175),
        i === 1 ? glow : body,
        0,
        0.01 + i * 0.07,
        -0.006,
      );
    }

    this.skinMaterials = { body, glow, wire };

    this.buildHead(body, dark, glow, visor);
    this.buildArm(-1, body, dark, glow);
    this.buildArm(1, body, dark, glow);
    this.buildLeg(-1, body, dark, glow);
    this.buildLeg(1, body, dark, glow);

    this.handR.add(this.weaponAnchor);
    this.weaponAnchor.position.set(-0.045, -0.015, -0.035);
    this.weaponAnchor.rotation.z = -0.05;
    this.weapons = {
      pulse: this.buildWeapon('pulse', body, dark, glow),
      plasma: this.buildWeapon('plasma', body, dark, glow),
      scatter: this.buildWeapon('scatter', body, dark, glow),
      arc: this.buildWeapon('arc', body, dark, glow),
    };
    this.weaponAnchor.add(
      this.weapons.pulse,
      this.weapons.plasma,
      this.weapons.scatter,
      this.weapons.arc,
    );
    this.setWeapon('pulse');
  }

  private material<T extends THREE.Material>(value: T): T {
    this.materials.push(value);
    return value;
  }

  private mesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const result = new THREE.Mesh(geometry, material);
    result.position.set(x, y, z);
    parent.add(result);
    return result;
  }

  private buildHead(
    body: THREE.Material,
    dark: THREE.Material,
    glow: THREE.Material,
    visor: THREE.Material,
  ): void {
    this.mesh(this.neck, cylinder(0.065, 0.075, 0.12), dark, 0, 0.055, 0);
    const skull = this.mesh(this.head, sphere(0.155, 12, 8), body, 0, 0, 0);
    skull.scale.set(0.86, 1, 0.9);
    // Front is -Z.
    this.mesh(this.head, box(0.245, 0.068, 0.025), visor, 0, 0.025, -0.14);
    this.mesh(this.head, box(0.035, 0.018, 0.012), glow, -0.06, 0.03, -0.158);
    this.mesh(this.head, box(0.035, 0.018, 0.012), glow, 0.06, 0.03, -0.158);
    this.mesh(this.head, box(0.145, 0.06, 0.045), dark, 0, -0.07, -0.125);
    this.mesh(this.head, box(0.035, 0.055, 0.035), glow, 0, -0.07, -0.151);
    this.mesh(this.head, box(0.032, 0.095, 0.085), glow, 0, 0.16, 0.01);
    this.mesh(this.head, cylinder(0.04, 0.04, 0.055, 8), dark, -0.145, 0, 0);
    this.mesh(this.head, cylinder(0.04, 0.04, 0.055, 8), dark, 0.145, 0, 0);
  }

  private buildArm(
    side: Side,
    body: THREE.Material,
    dark: THREE.Material,
    glow: THREE.Material,
  ): void {
    const shoulder = side < 0 ? this.shoulderL : this.shoulderR;
    const upper = side < 0 ? this.upperArmL : this.upperArmR;
    const fore = side < 0 ? this.forearmL : this.forearmR;
    const hand = side < 0 ? this.handL : this.handR;
    shoulder.name = side < 0 ? 'shoulderL' : 'shoulderR';
    upper.name = side < 0 ? 'upperArmL' : 'upperArmR';
    fore.name = side < 0 ? 'forearmL' : 'forearmR';
    hand.name = side < 0 ? 'handL' : 'handR';
    shoulder.position.set(side * 0.245, 0.25, 0);
    shoulder.add(upper);
    upper.add(fore);
    fore.position.y = -0.27;
    fore.add(hand);
    hand.position.y = -0.235;

    this.mesh(shoulder, sphere(0.095, 8, 6), body, side * 0.025, -0.035, 0);
    const pauldron = this.mesh(
      shoulder,
      box(0.16, 0.08, 0.18),
      body,
      side * 0.035,
      0,
      0,
    );
    pauldron.rotation.z = side * -0.15;
    this.mesh(upper, cylinder(0.055, 0.065, 0.27), body, 0, -0.135, 0);
    this.mesh(fore, cylinder(0.047, 0.06, 0.235), dark, 0, -0.1175, 0);
    this.mesh(fore, box(0.075, 0.11, 0.065), glow, 0, -0.08, -0.025);
    this.buildHand(hand, side, body, dark);
  }

  private buildHand(
    hand: THREE.Group,
    side: Side,
    body: THREE.Material,
    dark: THREE.Material,
  ): void {
    this.mesh(hand, box(0.105, 0.105, 0.07), body, 0, -0.04, 0);
    // Four fingers are readable as individual gripping digits.
    for (let i = 0; i < 4; i++) {
      const finger = this.mesh(
        hand,
        box(0.018, 0.07, 0.025),
        dark,
        -0.036 + i * 0.024,
        -0.115,
        -0.012,
      );
      finger.rotation.x = 0.55;
    }
    const thumb = this.mesh(
      hand,
      box(0.025, 0.065, 0.028),
      dark,
      side * 0.063,
      -0.06,
      -0.02,
    );
    thumb.rotation.z = side * 0.65;
  }

  private buildLeg(
    side: Side,
    body: THREE.Material,
    dark: THREE.Material,
    glow: THREE.Material,
  ): void {
    const thigh = side < 0 ? this.thighL : this.thighR;
    const shin = side < 0 ? this.shinL : this.shinR;
    const foot = side < 0 ? this.footL : this.footR;
    thigh.name = side < 0 ? 'thighL' : 'thighR';
    shin.name = side < 0 ? 'shinL' : 'shinR';
    foot.name = side < 0 ? 'footL' : 'footR';
    thigh.position.x = side * 0.115;
    thigh.add(shin);
    shin.position.y = -0.38;
    shin.add(foot);
    foot.position.y = -0.37;
    this.mesh(thigh, cylinder(0.075, 0.095, 0.38), body, 0, -0.19, 0);
    this.mesh(shin, cylinder(0.065, 0.075, 0.37), dark, 0, -0.185, 0);
    this.mesh(shin, box(0.105, 0.15, 0.075), glow, 0, -0.1, -0.035);
    this.mesh(foot, box(0.13, 0.09, 0.25), body, 0, -0.045, -0.065);
  }

  private buildWeapon(
    id: WeaponId,
    body: THREE.Material,
    dark: THREE.Material,
    glow: THREE.Material,
  ): THREE.Group {
    const weapon = new THREE.Group();
    weapon.name = `weapon-${id}`;
    // The hand sits at the grip near z=0; every silhouette extends down -Z.
    if (id === 'pulse') {
      this.mesh(weapon, box(0.11, 0.1, 0.4), body, 0, 0, -0.18);
      this.mesh(weapon, box(0.055, 0.055, 0.34), dark, 0, 0, -0.53);
      this.mesh(weapon, box(0.018, 0.025, 0.42), glow, 0.06, 0.01, -0.23);
    } else if (id === 'plasma') {
      this.mesh(weapon, box(0.145, 0.13, 0.39), body, 0, 0, -0.18);
      this.mesh(weapon, box(0.08, 0.08, 0.32), dark, 0, 0, -0.48);
      const coil = this.mesh(weapon, torus(0.075, 0.012), glow, 0, 0, -0.35);
      coil.rotation.x = Math.PI / 2;
    } else if (id === 'scatter') {
      this.mesh(weapon, box(0.17, 0.13, 0.36), body, 0, 0, -0.16);
      this.mesh(weapon, box(0.05, 0.05, 0.38), dark, -0.045, 0, -0.47);
      this.mesh(weapon, box(0.05, 0.05, 0.38), dark, 0.045, 0, -0.47);
    } else {
      this.mesh(weapon, box(0.12, 0.11, 0.38), body, 0, 0, -0.17);
      this.mesh(weapon, box(0.025, 0.035, 0.4), dark, -0.055, 0, -0.46);
      this.mesh(weapon, box(0.025, 0.035, 0.4), dark, 0.055, 0, -0.46);
      const ring = this.mesh(weapon, torus(0.065, 0.01), glow, 0, 0, -0.3);
      ring.rotation.x = Math.PI / 2;
    }
    return weapon;
  }

  /**
   * Repaints the rig for a shop skin. Only uniform colours change, so this
   * never triggers a shader recompile mid-run.
   */
  setPalette(palette: { body: number; trim: number }): void {
    if (!this.skinMaterials) return;
    this.skinMaterials.body.color.setHex(palette.body);
    this.skinMaterials.body.emissive.setHex(palette.trim);
    this.skinMaterials.glow.color.setHex(palette.trim);
    this.skinMaterials.wire.color.setHex(palette.trim);
  }

  setWeapon(id: WeaponId): void {
    this.activeWeapon = id;
    this.weapons.pulse.visible = id === 'pulse';
    this.weapons.plasma.visible = id === 'plasma';
    this.weapons.scatter.visible = id === 'scatter';
    this.weapons.arc.visible = id === 'arc';
  }

  fire(strength = 1): void {
    const safeStrength = Number.isFinite(strength) ? Math.max(0, strength) : 1;
    this.recoil = Math.min(1.5, this.recoil + safeStrength);
  }

  update(dt: number, pose: CharacterPose): void {
    const step = Math.min(0.05, Math.max(0, Number.isFinite(dt) ? dt : 0));
    const forward = Number.isFinite(pose.forwardSpeed) ? pose.forwardSpeed : 0;
    const strafe = Number.isFinite(pose.strafeSpeed) ? pose.strafeSpeed : 0;
    const vertical = Number.isFinite(pose.verticalSpeed) ? pose.verticalSpeed : 0;
    const aimPitch = THREE.MathUtils.clamp(
      Number.isFinite(pose.aimPitch) ? pose.aimPitch : 0,
      -1.4,
      1.4,
    );
    const scoped = THREE.MathUtils.clamp(
      Number.isFinite(pose.scoped) ? pose.scoped : 0,
      0,
      1,
    );
    const speed = Math.sqrt(forward * forward + strafe * strafe);
    const move01 = Math.min(1, speed / 9.6);
    const direction = forward < -0.05 ? -1 : 1;
    const frequency = 2.2 + move01 * 1.4;
    this.idlePhase += step * 1.65;
    if (speed > 0.03 && pose.grounded) {
      this.gaitPhase += step * frequency * Math.PI * 2 * direction;
    }
    this.reloadPhase += step * (pose.reloading ? 7.5 : 2);

    if (!this.wasGrounded && pose.grounded && this.lastVerticalSpeed < -1) {
      this.landing = Math.min(1, -this.lastVerticalSpeed / 10);
    }
    this.wasGrounded = pose.grounded;
    this.lastVerticalSpeed = vertical;
    this.landing *= Math.exp(-step * 12);
    this.recoil *= Math.exp(-step * 13);

    if (pose.dead) {
      this.updateDead(step);
      return;
    }

    const blend = Math.min(1, step * 10);
    const stride = Math.min(0.9, speed * 0.085);
    const phaseSin = Math.sin(this.gaitPhase);
    const phaseCos = Math.cos(this.gaitPhase);
    const strafeSign = strafe === 0 ? 0 : strafe > 0 ? 1 : -1;
    const strafeMix = Math.min(1, Math.abs(strafe) / (speed + 0.0001));
    const legL = phaseSin * stride + strafeMix * phaseCos * strafeSign * 0.28;
    const legR = -phaseSin * stride - strafeMix * phaseCos * strafeSign * 0.28;
    let kneeL = Math.max(0, -phaseSin) * stride * 1.15;
    let kneeR = Math.max(0, phaseSin) * stride * 1.15;
    let tuck = 0;
    let fallPitch = 0;
    if (!pose.grounded) {
      tuck = vertical > 0 ? 0.55 : 0.18;
      kneeL += tuck;
      kneeR += tuck;
      fallPitch = vertical < 0 ? 0.18 : -0.06;
    }

    const dash = pose.dashing ? 1 : 0;
    // A slide reads as a crouch leaning into travel with one leg tucked; the
    // boost is its opposite, a body hauled upright by the thruster.
    const slide = THREE.MathUtils.clamp(
      Number.isFinite(pose.sliding) ? pose.sliding : 0,
      0,
      1,
    );
    const boost = pose.boosting ? 1 : 0;
    kneeL += slide * 0.95;
    kneeR += slide * 0.35;
    const leanX =
      (pose.dashing
        ? (Math.abs(forward) > 0.1 ? Math.sign(forward) : 1) * 0.42
        : fallPitch) +
      slide * 0.52 -
      boost * 0.26;
    const leanZ = -strafeSign * (0.08 * move01 + dash * 0.28) + slide * 0.18;
    const bob =
      pose.grounded && speed > 0.03
        ? Math.abs(phaseSin) * 0.026 * move01
        : Math.sin(this.idlePhase) * 0.003;
    this.hips.position.y = 0.91 + bob - this.landing * 0.075 - slide * 0.42;
    this.hips.scale.y = 1 - this.landing * 0.08 - slide * 0.06;

    // The root already follows aim yaw. Retain the old world heading when it
    // turns, then let the hips catch the aim over roughly 0.2 seconds.
    let yawDelta = this.group.rotation.y - this.previousAimYaw;
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
    this.previousAimYaw = this.group.rotation.y;
    this.hipsLag = THREE.MathUtils.clamp(
      (this.hipsLag - yawDelta) * Math.exp(-step * 5),
      -0.8,
      0.8,
    );
    // On the lower body, bias the legs toward local travel direction.
    const travelYaw =
      speed > 0.05
        ? THREE.MathUtils.clamp(Math.atan2(-strafe, Math.abs(forward) + 0.001), -0.65, 0.65)
        : 0;
    this.hips.rotation.y =
      this.hipsLag +
      travelYaw +
      phaseSin * stride * -0.12 +
      strafeSign * dash * 0.12;
    this.hips.rotation.z = leanZ;
    this.spine.rotation.x = leanX;
    this.spine.rotation.z = -leanZ * 0.45;

    this.thighL.rotation.x += (legL - this.thighL.rotation.x) * blend;
    this.thighR.rotation.x += (legR - this.thighR.rotation.x) * blend;
    this.thighL.rotation.z = strafeMix * phaseCos * 0.12;
    this.thighR.rotation.z = strafeMix * phaseCos * 0.12;
    this.shinL.rotation.x += (kneeL - this.shinL.rotation.x) * blend;
    this.shinR.rotation.x += (kneeR - this.shinR.rotation.x) * blend;
    this.footL.rotation.x = -legL * 0.32 - kneeL * 0.25;
    this.footR.rotation.x = -legR * 0.32 - kneeR * 0.25;
    this.footL.rotation.z = -phaseCos * stride * 0.07;
    this.footR.rotation.z = phaseCos * stride * 0.07;
    if (dash) {
      const trailingLeft = phaseSin > 0;
      this.thighL.rotation.x = trailingLeft ? -0.52 : 0.35;
      this.thighR.rotation.x = trailingLeft ? 0.35 : -0.52;
    }

    const breath = Math.sin(this.idlePhase) * 0.012;
    this.chest.scale.set(1 + breath, 1 + breath * 0.4, 1 + breath);
    this.chest.rotation.x = aimPitch * 0.35 - this.recoil * 0.035;
    this.chest.rotation.y = -this.hipsLag * 0.72;
    this.chest.rotation.z = phaseSin * stride * 0.075;
    this.neck.rotation.x = THREE.MathUtils.clamp(aimPitch * 0.5, -0.7, 0.7);
    this.neck.rotation.y = -this.hipsLag * 0.28;
    this.head.rotation.z = -leanZ * 0.2;

    this.updateArms(
      aimPitch,
      scoped,
      pose.reloading,
      dash,
      phaseSin,
      move01,
    );
  }

  private updateArms(
    aimPitch: number,
    scoped: number,
    reloading: boolean,
    dash: number,
    phaseSin: number,
    move01: number,
  ): void {
    const recoil = this.recoil;
    const shoulderPitch = 1.05 - aimPitch * 0.65 + recoil * 0.14;
    const sway = Math.sin(this.idlePhase * 0.73) * 0.018;
    this.shoulderR.rotation.x = shoulderPitch + sway;
    this.shoulderR.rotation.z = -0.35 + scoped * 0.2;
    this.upperArmR.rotation.x = -0.06;
    this.upperArmR.rotation.z = 0.13 + scoped * 0.14;
    this.forearmR.rotation.x = -1.02 + scoped * 0.18;
    this.forearmR.rotation.z = -0.12;

    // Analytic, hand-tuned two-link solution to the current foregrip. The
    // target varies by weapon length and remains in the shoulder's aim frame.
    let reach = 0.76;
    if (this.activeWeapon === 'plasma') reach = 0.82;
    else if (this.activeWeapon === 'scatter') reach = 0.7;
    else if (this.activeWeapon === 'arc') reach = 0.8;
    let reload = 0;
    if (reloading) {
      const cycle = (Math.sin(this.reloadPhase) + 1) * 0.5;
      reload = Math.sin(cycle * Math.PI);
    }
    this.shoulderL.rotation.x =
      shoulderPitch + 0.08 + reload * 0.58 + sway;
    this.shoulderL.rotation.z =
      0.47 - reach * 0.2 - scoped * 0.22 + reload * 0.2;
    this.upperArmL.rotation.x = -0.12 + reload * 0.38;
    this.upperArmL.rotation.z = -0.18 - scoped * 0.14;
    this.forearmL.rotation.x = -1.25 + reach * 0.35 - reload * 0.72;
    this.forearmL.rotation.z = 0.2 + reload * 0.25;
    this.handL.rotation.x = -0.15 + reload * 0.5;

    if (dash) {
      this.shoulderL.rotation.x -= 0.35;
      this.shoulderR.rotation.x -= 0.35;
      this.forearmL.rotation.x = -1.35;
      this.forearmR.rotation.x = -1.35;
    } else if (move01 > 0 && !reloading) {
      this.shoulderL.rotation.z += phaseSin * move01 * 0.035;
      this.shoulderR.rotation.z -= phaseSin * move01 * 0.035;
    }

    this.weaponAnchor.position.x = -0.045 + scoped * 0.105;
    this.weaponAnchor.position.y = -0.015 + scoped * 0.035;
    this.weaponAnchor.position.z =
      -0.035 + recoil * 0.105 + Math.sin(this.idlePhase * 0.8) * 0.004;
    this.weaponAnchor.rotation.x =
      (reloading ? 0.26 : 0) + recoil * 0.12 - aimPitch * 0.08;
    this.weaponAnchor.rotation.y = scoped * -0.07;
    this.weaponAnchor.rotation.z = -0.05 + (reloading ? -0.12 : 0);
    this.head.position.z = scoped * -0.035;
    this.head.rotation.x = scoped * 0.05;
  }

  private updateDead(step: number): void {
    const blend = Math.min(1, step * 5);
    this.hips.position.y += (0.35 - this.hips.position.y) * blend;
    this.hips.rotation.z += (0.72 - this.hips.rotation.z) * blend;
    this.spine.rotation.x += (1.15 - this.spine.rotation.x) * blend;
    this.chest.rotation.x += (0.65 - this.chest.rotation.x) * blend;
    this.neck.rotation.x += (0.5 - this.neck.rotation.x) * blend;
    this.shoulderL.rotation.x += (0.15 - this.shoulderL.rotation.x) * blend;
    this.shoulderR.rotation.x += (0.35 - this.shoulderR.rotation.x) * blend;
    this.shoulderL.rotation.z += (0.8 - this.shoulderL.rotation.z) * blend;
    this.shoulderR.rotation.z += (-0.8 - this.shoulderR.rotation.z) * blend;
    this.forearmL.rotation.x += (0.1 - this.forearmL.rotation.x) * blend;
    this.forearmR.rotation.x += (0.1 - this.forearmR.rotation.x) * blend;
    this.thighL.rotation.x += (-0.8 - this.thighL.rotation.x) * blend;
    this.thighR.rotation.x += (0.35 - this.thighR.rotation.x) * blend;
    this.shinL.rotation.x += (1.2 - this.shinL.rotation.x) * blend;
    this.shinR.rotation.x += (0.55 - this.shinR.rotation.x) * blend;
    this.weaponAnchor.rotation.x +=
      (1.15 - this.weaponAnchor.rotation.x) * blend;
    this.weaponAnchor.position.z =
      -0.035 + this.recoil * 0.105;
    this.recoil *= Math.exp(-step * 13);
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}