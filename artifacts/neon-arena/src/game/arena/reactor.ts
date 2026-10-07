import * as THREE from 'three';

import { ArenaBuilder, gridTexture, type Arena } from './builder';

const ORANGE = 0xff7a1a;
const RED = 0xff2b2b;
const GOLD = 0xffc93c;

/**
 * REACTOR -- a radial map wrapped around a dead reactor stack.
 *
 * The central column is tall enough to cut the arena in half, so there is no
 * safe centre to hold and no sightline that crosses the map. Fighting here
 * means orbiting: you are always circling toward or away from something. An
 * elevated ring gives the high ground, but it is exposed from every angle.
 *
 * The octagonal forms are stepped axis-aligned boxes rather than cylinders --
 * collision in this engine is Box3-based, so a real cylinder would either stop
 * you short of the visual or let you clip into it.
 */
export function buildReactor(): Arena {
  const b = new ArenaBuilder();
  const HALF = 33;
  const WALL_H = 18;

  /* ------------------------------ materials ----------------------------- */

  const floorTex = b.track(
    gridTexture('#120a06', 'rgba(190, 110, 40, 0.14)', 'rgba(255, 122, 26, 0.4)'),
  );
  floorTex.repeat.set(HALF / 3.5, HALF / 3.5);

  const floorMat = b.track(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      color: 0x4a3a2c,
      roughness: 0.62,
      metalness: 0.2,
    }),
  );

  const hullMat = b.hull(0x453329, 0.65, 0.25);
  const darkHullMat = b.hull(0x2b1f18, 0.72, 0.22);
  const coreMat = b.hull(0x1a1210, 0.5, 0.35);

  const orangeTrim = b.pulse(b.trim(ORANGE, 1.4));
  const redTrim = b.pulse(b.trim(RED, 1.25));
  const goldTrim = b.pulse(b.trim(GOLD, 1.15));

  /* -------------------------------- floor ------------------------------- */

  const floor = new THREE.Mesh(
    b.track(new THREE.PlaneGeometry(HALF * 2, HALF * 2)),
    floorMat,
  );
  floor.rotation.x = -Math.PI / 2;
  b.add(floor);

  /* -------------------------------- walls ------------------------------- */

  (
    [
      [0, -HALF - 1, HALF * 2 + 4, 2],
      [0, HALF + 1, HALF * 2 + 4, 2],
      [-HALF - 1, 0, 2, HALF * 2 + 4],
      [HALF + 1, 0, 2, HALF * 2 + 4],
    ] as Array<[number, number, number, number]>
  ).forEach(([x, z, w, d]) => {
    b.solid(x, 0, z, w, WALL_H, d, darkHullMat);
    b.solid(x, 0.35, z, w + 0.1, 0.35, d + 0.1, orangeTrim, false);
    b.solid(x, 6.2, z, w + 0.1, 0.14, d + 0.1, redTrim, false);
  });

  // Chamfer the corners so the room reads as an octagon, not a box.
  (
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as Array<[number, number]>
  ).forEach(([sx, sz]) => {
    for (let i = 0; i < 4; i++) {
      const inset = 3 + i * 2.6;
      const size = 10 - i * 2.4;
      if (size <= 0) continue;
      b.solid(
        sx * (HALF - inset),
        0,
        sz * (HALF - (11.4 - inset)),
        size,
        WALL_H,
        size,
        darkHullMat,
      );
    }
  });

  /* ---------------------------- reactor stack --------------------------- */

  // Stepped octagonal column. Each ring is a square rotated 45 degrees in
  // footprint terms -- approximated by a wide box plus two narrow cross boxes.
  const column = (y: number, h: number, r: number, mat: THREE.Material) => {
    b.solid(0, y, 0, r * 2, h, r * 1.45, mat);
    b.solid(0, y, 0, r * 1.45, h, r * 2, mat);
  };

  column(0, 15, 5.4, coreMat);
  column(15, 2.2, 6.6, hullMat);

  // Glowing coolant bands up the stack.
  for (let i = 0; i < 5; i++) {
    const y = 2.2 + i * 2.7;
    b.solid(0, y, 0, 11.2, 0.34, 8.1, i % 2 ? redTrim : orangeTrim, false);
    b.solid(0, y, 0, 8.1, 0.34, 11.2, i % 2 ? redTrim : orangeTrim, false);
  }

  // Four buttresses bracing the stack; they double as jumpable cover.
  (
    [
      [0, -9.5, 4.5, 9],
      [0, 9.5, 4.5, 9],
      [-9.5, 0, 9, 4.5],
      [9.5, 0, 9, 4.5],
    ] as Array<[number, number, number, number]>
  ).forEach(([x, z, w, d]) => {
    b.solid(x, 0, z, w, 2.6, d, hullMat);
    b.capTrim(x, 2.6, z, w, d, goldTrim);
  });

  /* ------------------------- elevated orbit ring ------------------------ */

  // A raised walkway at four compass points -- height advantage, fully exposed.
  const ringPad = (x: number, z: number, w: number, d: number) => {
    b.solid(x, 0, z, w, 4.2, d, hullMat);
    b.capTrim(x, 4.2, z, w, d, orangeTrim);
    // Ramp block so it is reachable in two hops.
    b.solid(x * 0.72, 0, z * 0.72, w * 0.55, 2.1, d * 0.55, darkHullMat);
    b.capTrim(x * 0.72, 2.1, z * 0.72, w * 0.55, d * 0.55, goldTrim);
  };
  ringPad(-20, -20, 11, 11);
  ringPad(20, -20, 11, 11);
  ringPad(-20, 20, 11, 11);
  ringPad(20, 20, 11, 11);

  // Low pipe runs radiating outward; break up the orbit lanes.
  (
    [
      [0, -24, 16, 1.4, 2.4],
      [0, 24, 16, 1.4, 2.4],
      [-24, 0, 2.4, 1.4, 16],
      [24, 0, 2.4, 1.4, 16],
    ] as Array<[number, number, number, number, number]>
  ).forEach(([x, z, w, h, d]) => {
    b.solid(x, 0, z, w, h, d, darkHullMat);
    b.capTrim(x, h, z, w, d, redTrim);
  });

  /* ------------------------------- lighting ----------------------------- */

  b.add(new THREE.AmbientLight(0x553322, 0.34));
  b.add(new THREE.HemisphereLight(0x803a10, 0x180806, 0.45));

  const key = new THREE.DirectionalLight(0xffbb77, 0.75);
  key.position.set(-20, 38, 22);
  b.add(key);

  const rim = new THREE.DirectionalLight(0xff2b2b, 0.55);
  rim.position.set(26, 16, -20);
  b.add(rim);

  // The stack itself is the brightest thing in the room.
  const coreGlow = new THREE.PointLight(ORANGE, 60, 40, 2);
  coreGlow.position.set(0, 9, 0);
  b.add(coreGlow);

  (
    [
      [-20, 7, -20, GOLD],
      [20, 7, -20, ORANGE],
      [-20, 7, 20, ORANGE],
      [20, 7, 20, GOLD],
      [0, 6, -28, RED],
      [0, 6, 28, RED],
    ] as Array<[number, number, number, number]>
  ).forEach(([x, y, z, color]) => {
    const light = new THREE.PointLight(color, 20, 42, 2);
    light.position.set(x, y, z);
    b.add(light);
  });

  /* ------------------------------ atmosphere ---------------------------- */

  const sky = new THREE.Mesh(
    b.track(new THREE.SphereGeometry(HALF * 2.4, 24, 16)),
    b.track(
      new THREE.MeshBasicMaterial({
        color: 0x140a06,
        side: THREE.BackSide,
        fog: true,
      }),
    ),
  );
  b.add(sky);
  b.dust(600, HALF, 18, 0xffa860);

  // Spawns hug the outer band so nothing materialises against the stack.
  b.spawnRing(28, 12, 1.4, 0.19);

  return b.finish({
    id: 'reactor',
    name: 'REACTOR',
    playerSpawn: new THREE.Vector3(0, 3.2, 22),
    half: HALF,
    theme: {
      background: 0x0b0503,
      fogColor: 0x1d0c05,
      fogDensity: 0.0115,
      envIntensity: 0.22,
      accent: ORANGE,
      menuOrbit: { radius: 27, height: 9.5, bob: 1.8, lookAt: [0, 6, 0] },
    },
  });
}
