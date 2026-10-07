import * as THREE from 'three';
import type { WeaponId } from './contract';

interface ArmAssembly {
  group: THREE.Group;
  fingers: THREE.Mesh[];
  index: THREE.Mesh;
}

/**
 * First-person weapon models, built from primitives so the game ships with
 * no downloadable assets. Handles bob, sway, recoil kick and muzzle flash.
 */
export class ViewModel {
  readonly group = new THREE.Group();

  private readonly rigs: Record<WeaponId, THREE.Group>;
  private readonly muzzles: Record<WeaponId, THREE.Object3D>;
  private readonly coilMaterial: THREE.MeshBasicMaterial;
  private readonly flash: THREE.Mesh;
  private readonly flashMaterial: THREE.MeshBasicMaterial;
  private readonly flashLight: THREE.PointLight;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly armBoxGeometry: THREE.BoxGeometry;
  private readonly armForearmGeometry: THREE.CylinderGeometry;
  private readonly armCuffGeometry: THREE.CylinderGeometry;
  private readonly armRingGeometry: THREE.CylinderGeometry;
  private readonly armMaterial: THREE.MeshStandardMaterial;
  private readonly armTrimMaterial: THREE.MeshStandardMaterial;
  /** Trigger fingers of every weapon rig, twitched together each frame. */
  private readonly rightHands: THREE.Mesh[];
  private readonly plasmaLeftFingers: THREE.Mesh[];
  private readonly plasmaFingerBaseX: number[];
  private readonly scatterLeftArm: THREE.Group;
  private readonly scatterPump: THREE.Mesh;

  private active: WeaponId = 'pulse';
  private bobPhase = 0;
  private kickAmount = 0;
  private kickRot = 0;
  private swayX = 0;
  private swayY = 0;
  private flashLife = 0;
  private swapLift = 0;
  private fingerTimer = 0;
  private pumpTimer = 0;
  private chargeAmount = 0;
  // Sits low-right, but high enough that both gloves stay inside the frame
  // rather than hiding under the bottom edge with the weapon.
  private readonly restPosition = new THREE.Vector3(0.29, -0.245, -0.6);

  constructor() {
    const track = <T extends { dispose: () => void }>(item: T): T => {
      this.disposables.push(item);
      return item;
    };

    const bodyMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x1b222c,
        roughness: 0.4,
        metalness: 0.9,
      }),
    );
    const darkMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x0c1015,
        roughness: 0.6,
        metalness: 0.7,
      }),
    );
    const cyanMat = track(
      new THREE.MeshBasicMaterial({ color: 0x22e0ff }),
    );
    this.coilMaterial = track(
      new THREE.MeshBasicMaterial({ color: 0xff2d78 }),
    );

    const box = track(new THREE.BoxGeometry(1, 1, 1));
    this.armBoxGeometry = box;
    this.armForearmGeometry = track(
      new THREE.CylinderGeometry(0.043, 0.062, 0.31, 7),
    );
    this.armCuffGeometry = track(
      new THREE.CylinderGeometry(0.052, 0.052, 0.042, 8),
    );
    this.armRingGeometry = track(
      new THREE.CylinderGeometry(0.056, 0.056, 0.012, 8),
    );
    this.armMaterial = track(
      // Bright enough to read as an arm against an unlit wall. The arena is
      // mostly black geometry, so a near-black glove simply disappears and
      // the weapon looks like it is floating.
      new THREE.MeshStandardMaterial({
        color: 0x44536e,
        emissive: 0x1b2f4a,
        // Under 1.5 so ACES tone mapping and the bloom pass leave it as a
        // solid surface instead of a white smear.
        emissiveIntensity: 0.85,
        // Low metalness on purpose: a metallic glove only reflects the arena,
        // which is almost entirely black, so it reads as a hole in the screen.
        metalness: 0.25,
        roughness: 0.55,
      }),
    );
    this.armTrimMaterial = track(
      new THREE.MeshStandardMaterial({
        color: 0x22e0ff,
        emissive: 0x22e0ff,
        emissiveIntensity: 1.4,
        metalness: 0.65,
        roughness: 0.3,
      }),
    );

    const piece = (
      parent: THREE.Group,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
    ) => {
      const mesh = new THREE.Mesh(box, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      parent.add(mesh);
      return mesh;
    };

    /* ------------------------------ pulse ------------------------------ */
    const pulse = new THREE.Group();
    piece(pulse, bodyMat, 0, 0, -0.1, 0.085, 0.1, 0.52); // receiver
    piece(pulse, darkMat, 0, 0.005, -0.44, 0.05, 0.05, 0.36); // barrel
    piece(pulse, bodyMat, 0, 0.062, -0.12, 0.045, 0.03, 0.4); // top rail
    piece(pulse, darkMat, 0, -0.11, 0.04, 0.07, 0.16, 0.1); // grip
    piece(pulse, darkMat, 0, -0.05, 0.18, 0.07, 0.09, 0.14); // stock
    piece(pulse, cyanMat, 0.046, 0.0, -0.16, 0.008, 0.026, 0.3); // strip R
    piece(pulse, cyanMat, -0.046, 0.0, -0.16, 0.008, 0.026, 0.3); // strip L
    piece(pulse, cyanMat, 0, 0.085, -0.02, 0.02, 0.012, 0.06); // sight dot
    const pulseMuzzle = new THREE.Object3D();
    pulseMuzzle.position.set(0, 0.005, -0.63);
    pulse.add(pulseMuzzle);

    /* ------------------------------ plasma ----------------------------- */
    const plasma = new THREE.Group();
    piece(plasma, bodyMat, 0, 0, -0.08, 0.12, 0.14, 0.46); // chunky body
    piece(plasma, darkMat, 0, 0, -0.38, 0.09, 0.09, 0.3); // emitter housing
    piece(plasma, darkMat, 0, -0.12, 0.06, 0.075, 0.17, 0.11); // grip
    piece(plasma, bodyMat, 0, 0.085, -0.06, 0.06, 0.05, 0.3); // hood
    const coilGeo = track(new THREE.TorusGeometry(0.075, 0.014, 8, 20));
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(coilGeo, this.coilMaterial);
      coil.position.set(0, 0, -0.28 - i * 0.09);
      plasma.add(coil);
    }
    piece(plasma, this.coilMaterial, 0, 0, -0.5, 0.045, 0.045, 0.045);
    const plasmaMuzzle = new THREE.Object3D();
    plasmaMuzzle.position.set(0, 0, -0.56);
    plasma.add(plasmaMuzzle);

    /* ----------------------------- scatter ----------------------------- */
    const amberMat = track(new THREE.MeshBasicMaterial({ color: 0xffb020 }));
    const scatter = new THREE.Group();
    piece(scatter, bodyMat, 0, 0, -0.04, 0.15, 0.12, 0.4); // wide receiver
    piece(scatter, darkMat, -0.042, 0.004, -0.34, 0.055, 0.055, 0.34); // barrel L
    piece(scatter, darkMat, 0.042, 0.004, -0.34, 0.055, 0.055, 0.34); // barrel R
    piece(scatter, darkMat, 0, -0.115, 0.06, 0.075, 0.16, 0.1); // grip
    this.scatterPump = piece(
      scatter,
      bodyMat,
      0,
      -0.05,
      -0.2,
      0.09,
      0.05,
      0.22,
    ); // pump
    piece(scatter, amberMat, 0, 0.07, -0.06, 0.02, 0.014, 0.24); // top strip
    piece(scatter, amberMat, -0.042, 0.004, -0.51, 0.03, 0.03, 0.02); // muzzle L
    piece(scatter, amberMat, 0.042, 0.004, -0.51, 0.03, 0.03, 0.02); // muzzle R
    const scatterMuzzle = new THREE.Object3D();
    scatterMuzzle.position.set(0, 0.004, -0.55);
    scatter.add(scatterMuzzle);

    /* ------------------------------- arc ------------------------------- */
    const arcMat = track(new THREE.MeshBasicMaterial({ color: 0x9d7bff }));
    const arc = new THREE.Group();
    piece(arc, bodyMat, 0, 0, -0.06, 0.1, 0.11, 0.44); // body
    piece(arc, darkMat, 0, -0.115, 0.05, 0.07, 0.16, 0.1); // grip
    piece(arc, bodyMat, 0, 0.075, -0.1, 0.05, 0.04, 0.26); // spine
    // Emitter prongs: the tether visibly leaves from between them.
    piece(arc, darkMat, -0.05, 0.02, -0.4, 0.028, 0.028, 0.3);
    piece(arc, darkMat, 0.05, 0.02, -0.4, 0.028, 0.028, 0.3);
    piece(arc, arcMat, -0.05, 0.02, -0.55, 0.036, 0.036, 0.04);
    piece(arc, arcMat, 0.05, 0.02, -0.55, 0.036, 0.036, 0.04);
    const arcRingGeo = track(new THREE.TorusGeometry(0.06, 0.011, 8, 18));
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(arcRingGeo, arcMat);
      ring.position.set(0, 0.01, -0.22 - i * 0.11);
      arc.add(ring);
    }
    const arcMuzzle = new THREE.Object3D();
    arcMuzzle.position.set(0, 0.02, -0.58);
    arc.add(arcMuzzle);

    /* ------------------------- arms and gloves ------------------------- */
    const pulseRight = this.buildArm('right');
    pulseRight.group.position.set(0.045, -0.11, 0.04);
    pulseRight.group.rotation.set(-0.46, 0.04, -0.08);
    // Support hands sit a touch below the barrel line: level with it they
    // vanish behind the receiver and the weapon reads as floating.
    const pulseLeft = this.buildArm('left');
    pulseLeft.group.position.set(-0.075, -0.075, -0.26);
    pulseLeft.group.rotation.set(-0.04, -0.08, 0.06);
    pulse.add(pulseRight.group, pulseLeft.group);

    const plasmaRight = this.buildArm('right');
    plasmaRight.group.position.set(0.052, -0.12, 0.06);
    plasmaRight.group.rotation.set(-0.48, 0.04, -0.08);
    const plasmaLeft = this.buildArm('left');
    plasmaLeft.group.position.set(-0.088, -0.105, -0.22);
    plasmaLeft.group.rotation.set(0.08, -0.18, 0.1);
    plasma.add(plasmaRight.group, plasmaLeft.group);

    const scatterRight = this.buildArm('right');
    scatterRight.group.position.set(0.052, -0.115, 0.06);
    scatterRight.group.rotation.set(-0.48, 0.04, -0.08);
    const scatterLeft = this.buildArm('left');
    scatterLeft.group.position.set(-0.082, -0.098, -0.2);
    scatterLeft.group.rotation.set(-0.02, -0.08, 0.08);
    scatter.add(scatterRight.group, scatterLeft.group);

    const arcRight = this.buildArm('right');
    arcRight.group.position.set(0.05, -0.115, 0.05);
    arcRight.group.rotation.set(-0.47, 0.04, -0.08);
    const arcLeft = this.buildArm('left');
    arcLeft.group.position.set(-0.078, -0.096, -0.21);
    arcLeft.group.rotation.set(0.04, -0.12, 0.08);
    arc.add(arcRight.group, arcLeft.group);

    this.rightHands = [
      pulseRight.index,
      plasmaRight.index,
      scatterRight.index,
      arcRight.index,
    ];
    this.plasmaLeftFingers = plasmaLeft.fingers;
    this.plasmaFingerBaseX = plasmaLeft.fingers.map(
      (finger) => finger.position.x,
    );
    this.scatterLeftArm = scatterLeft.group;

    this.rigs = { pulse, plasma, scatter, arc };
    this.muzzles = {
      pulse: pulseMuzzle,
      plasma: plasmaMuzzle,
      scatter: scatterMuzzle,
      arc: arcMuzzle,
    };

    plasma.visible = false;
    scatter.visible = false;
    arc.visible = false;
    this.group.add(pulse, plasma, scatter, arc);
    this.group.position.copy(this.restPosition);

    /* --------------------------- muzzle flash -------------------------- */
    this.flashMaterial = track(
      new THREE.MeshBasicMaterial({
        color: 0xbff4ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.flash = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.4, 0.4)),
      this.flashMaterial,
    );
    this.flash.visible = false;
    this.flash.renderOrder = 5;
    this.group.add(this.flash);

    this.flashLight = new THREE.PointLight(0x9fe9ff, 0, 9, 2);
    this.group.add(this.flashLight);
  }

  setWeapon(id: WeaponId): void {
    if (this.active === id) return;
    this.active = id;
    for (const key of Object.keys(this.rigs) as WeaponId[]) {
      this.rigs[key].visible = key === id;
    }
    this.swapLift = 1;
  }

  /** Drives the plasma coil brightness while charging. */
  setCharge(amount: number): void {
    this.chargeAmount = THREE.MathUtils.clamp(amount, 0, 1);
    const glow = 0.35 + amount * 2.4;
    this.coilMaterial.color.setRGB(glow, glow * 0.25, glow * 0.55);
  }

  kick(amount: number, color: number): void {
    this.kickAmount = Math.min(0.14, this.kickAmount + amount * 0.055);
    this.kickRot = Math.min(0.3, this.kickRot + amount * 0.12);
    this.flashLife = 0.055 + amount * 0.03;
    this.flashMaterial.color.setHex(color);
    this.flashLight.color.setHex(color);
    this.fingerTimer = 0.12;
    if (this.active === 'scatter') this.pumpTimer = 0.22;

    const muzzle = this.muzzles[this.active];
    this.flash.position.copy(muzzle.position);
    this.flash.position.z -= 0.06;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.6 + amount * 0.9);
    this.flashLight.position.copy(this.flash.position);
  }

  /** World-space position of the current weapon's muzzle. */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    return this.muzzles[this.active].getWorldPosition(target);
  }

  update(
    dt: number,
    speed01: number,
    grounded: boolean,
    lookDeltaX: number,
    lookDeltaY: number,
  ): void {
    // Walk bob.
    this.bobPhase += dt * (6 + speed01 * 9);
    const bobStrength = grounded ? speed01 * 0.017 : 0.004;
    const bobX = Math.cos(this.bobPhase) * bobStrength;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobStrength * 0.9;

    // Sway lags behind the mouse so the weapon feels like it has mass.
    this.swayX += (-lookDeltaX * 0.35 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (-lookDeltaY * 0.28 - this.swayY) * Math.min(1, dt * 9);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.06, 0.06);
    this.swayY = THREE.MathUtils.clamp(this.swayY, -0.05, 0.05);

    // Recoil and weapon-swap dip both spring back to rest.
    this.kickAmount *= Math.max(0, 1 - dt * 11);
    this.kickRot *= Math.max(0, 1 - dt * 13);
    this.swapLift *= Math.max(0, 1 - dt * 7);

    // A quick trigger squeeze, shared by whichever right hand is visible.
    this.fingerTimer = Math.max(0, this.fingerTimer - dt);
    const fingerTwitch =
      Math.sin((this.fingerTimer / 0.12) * Math.PI) * 0.34;
    // Pre-collected in the constructor: `Object.keys` here would allocate an
    // array every rendered frame.
    for (const hand of this.rightHands) {
      hand.rotation.x = 0.24 + fingerTwitch;
    }

    // The scattergun hand stays locked to the moving pump during the rack.
    this.pumpTimer = Math.max(0, this.pumpTimer - dt);
    const pumpOffset =
      Math.sin((this.pumpTimer / 0.22) * Math.PI) * 0.07;
    this.scatterPump.position.z = -0.2 + pumpOffset;
    this.scatterLeftArm.position.z = -0.2 + pumpOffset;

    // Charging pushes the support-hand fingers apart around the plasma coil.
    const fingerSpread = 1 + this.chargeAmount * 0.32;
    for (let i = 0; i < this.plasmaLeftFingers.length; i++) {
      this.plasmaLeftFingers[i].position.x =
        this.plasmaFingerBaseX[i] * fingerSpread;
    }

    this.group.position.set(
      this.restPosition.x + bobX + this.swayX,
      this.restPosition.y + bobY + this.swayY - this.swapLift * 0.22,
      this.restPosition.z + this.kickAmount,
    );
    this.group.rotation.set(
      this.kickRot * 0.9 - this.swapLift * 0.5,
      this.swayX * 1.6,
      this.swayX * 2.2 - this.swapLift * 0.3,
    );

    if (this.flashLife > 0) {
      this.flashLife -= dt;
      const on = this.flashLife > 0;
      this.flash.visible = on;
      this.flashMaterial.opacity = on ? 0.9 : 0;
      this.flashLight.intensity = on ? 26 : 0;
      if (!on) this.flashLife = 0;
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  /**
   * Builds a complete armored hand at the origin. The sleeve points down and
   * back toward the player so callers only need to place the gripping palm.
   */
  private buildArm(side: 'left' | 'right'): ArmAssembly {
    const sign = side === 'right' ? 1 : -1;
    const group = new THREE.Group();
    // Bias the sleeve downward more than backward: even at maximum recoil and
    // swap rotation its rear edge remains comfortably beyond the near plane.
    const sleeveDirection = new THREE.Vector3(sign * 0.075, -0.235, 0.18);
    const sleeveAxis = sleeveDirection.clone().normalize();
    const sleeveRotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      sleeveAxis,
    );

    const forearm = new THREE.Mesh(
      this.armForearmGeometry,
      this.armMaterial,
    );
    forearm.position
      .copy(sleeveDirection)
      .multiplyScalar(0.5)
      .addScaledVector(sleeveAxis, 0.09);
    forearm.quaternion.copy(sleeveRotation);
    group.add(forearm);

    const cuff = new THREE.Mesh(this.armCuffGeometry, this.armMaterial);
    cuff.position.copy(sleeveAxis).multiplyScalar(0.085);
    cuff.quaternion.copy(sleeveRotation);
    group.add(cuff);

    const cuffRing = new THREE.Mesh(
      this.armRingGeometry,
      this.armTrimMaterial,
    );
    cuffRing.position.copy(sleeveAxis).multiplyScalar(0.061);
    cuffRing.quaternion.copy(sleeveRotation);
    group.add(cuffRing);

    const palm = new THREE.Mesh(this.armBoxGeometry, this.armMaterial);
    palm.scale.set(0.09, 0.04, 0.085);
    palm.position.z = -0.005;
    group.add(palm);

    const knuckle = new THREE.Mesh(
      this.armBoxGeometry,
      this.armTrimMaterial,
    );
    knuckle.scale.set(0.07, 0.008, 0.026);
    knuckle.position.set(0, 0.024, -0.03);
    group.add(knuckle);

    const fingers: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(this.armBoxGeometry, this.armMaterial);
      finger.scale.set(0.017, 0.026, 0.052 - i * 0.002);
      finger.position.set(-0.032 + i * 0.0215, -0.012, -0.062);
      finger.rotation.x = 0.24 + i * 0.035;
      finger.rotation.z = (i - 1.5) * 0.025;
      fingers.push(finger);
      group.add(finger);
    }

    const thumb = new THREE.Mesh(this.armBoxGeometry, this.armMaterial);
    thumb.scale.set(0.024, 0.025, 0.052);
    thumb.position.set(-sign * 0.051, -0.014, -0.006);
    thumb.rotation.set(0.5, sign * 0.5, sign * 0.28);
    group.add(thumb);

    // The index is the digit nearest the thumb on either mirrored hand.
    const index = fingers[side === 'right' ? 0 : 3];
    return { group, fingers, index };
  }
}
