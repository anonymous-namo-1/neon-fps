import * as THREE from 'three';

import { ArenaBuilder, gridTexture, type Arena } from './builder';

const ICE = 0x7fe8ff;
const VIOLET = 0x8b7bff;
const LIME = 0xa8ff5a;

/**
 * COLD STORAGE -- a tight container yard.
 *
 * Where THE GRID is open and REACTOR is radial, this map is a lattice. Stacked
 * containers form real corridors and blind corners, so engagements start at
 * three metres instead of thirty. Fast weapons and movement win here; the
 * charge shot rarely gets the room it needs.
 *
 * The stacks are laid out on an irregular grid on purpose -- a perfectly
 * regular one turns into a predictable set of lanes you can hold forever.
 */
export function buildColdStorage(): Arena {
  const b = new ArenaBuilder();
  const HALF = 30;
  const WALL_H = 15;

  /* ------------------------------ materials ----------------------------- */

  const floorTex = b.track(
    gridTexture('#0a0f14', 'rgba(120, 190, 220, 0.14)', 'rgba(127, 232, 255, 0.34)'),
  );
  floorTex.repeat.set(HALF / 2.5, HALF / 2.5);

  const floorMat = b.track(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      color: 0x44555f,
      roughness: 0.5,
      metalness: 0.16,
    }),
  );

  const hullMat = b.hull(0x33424e, 0.58, 0.24);
  const darkHullMat = b.hull(0x222c36, 0.68, 0.2);
  const crateMat = b.hull(0x2c3d4a, 0.55, 0.26);

  const iceTrim = b.pulse(b.trim(ICE, 1.3));
  const violetTrim = b.pulse(b.trim(VIOLET, 1.2));
  const limeTrim = b.pulse(b.trim(LIME, 1.05));

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
    b.solid(x, 0.3, z, w + 0.1, 0.3, d + 0.1, iceTrim, false);
    b.solid(x, 4.8, z, w + 0.1, 0.12, d + 0.1, violetTrim, false);
  });

  /* ----------------------------- container stacks ----------------------- */

  /** A shipping container with a lit rim; optionally stacked. */
  const container = (
    x: number,
    z: number,
    w: number,
    d: number,
    levels: number,
    trim: THREE.Material,
  ) => {
    const unitH = 3.1;
    for (let i = 0; i < levels; i++) {
      // Alternate the material so stacks read as separate boxes.
      b.solid(x, i * unitH, z, w, unitH, d, i % 2 ? crateMat : hullMat);
    }
    b.capTrim(x, levels * unitH, z, w, d, trim);
    // Lit seam between stacked units.
    for (let i = 1; i < levels; i++) {
      b.solid(x, i * unitH - 0.07, z, w + 0.14, 0.14, d + 0.14, trim, false);
    }
  };

  // Irregular lattice. Coordinates are hand-placed so corridors vary in width
  // and a few dead ends exist to punish careless retreats.
  const stacks: Array<[number, number, number, number, number]> = [
    [-19, -19, 8, 5, 2],
    [-7, -21, 6, 5, 1],
    [6, -19, 9, 5, 2],
    [19, -20, 6, 6, 1],

    [-21, -7, 5, 7, 1],
    [-8, -8, 6, 6, 2],
    [8, -7, 5, 8, 1],
    [20, -6, 6, 7, 2],

    [-19, 6, 7, 6, 2],
    [-6, 7, 6, 5, 1],
    [7, 8, 7, 7, 2],
    [20, 7, 5, 6, 1],

    [-18, 19, 6, 6, 1],
    [-5, 20, 7, 5, 2],
    [8, 19, 6, 6, 1],
    [19, 20, 7, 6, 2],
  ];
  stacks.forEach(([x, z, w, d, levels], i) => {
    const trim = i % 3 === 0 ? violetTrim : i % 3 === 1 ? iceTrim : limeTrim;
    container(x, z, w, d, levels, trim);
  });

  /* ------------------------------ centre plaza -------------------------- */

  // One open pocket so the map is not wall-to-wall corridors -- it gives the
  // player somewhere to actually use a charge shot, at the cost of exposure.
  b.solid(0, 0, 0, 9, 0.8, 9, hullMat);
  b.capTrim(0, 0.8, 0, 9, 9, iceTrim);

  // Low crates around the plaza edge for crouch-height cover.
  (
    [
      [-6.5, -6.5],
      [6.5, -6.5],
      [-6.5, 6.5],
      [6.5, 6.5],
    ] as Array<[number, number]>
  ).forEach(([x, z]) => {
    b.solid(x, 0, z, 2.6, 1.5, 2.6, crateMat);
    b.capTrim(x, 1.5, z, 2.6, 2.6, limeTrim);
  });

  // A catwalk spanning the plaza for a sniping perch with two exits.
  b.solid(0, 0, -14, 2.2, 5.6, 6, darkHullMat);
  b.solid(0, 0, 14, 2.2, 5.6, 6, darkHullMat);
  b.solid(0, 5.6, 0, 2.2, 0.5, 28, hullMat);
  b.capTrim(0, 6.1, 0, 2.2, 28, violetTrim);

  /* ------------------------------- lighting ----------------------------- */

  b.add(new THREE.AmbientLight(0x3a4a58, 0.38));
  b.add(new THREE.HemisphereLight(0x4a7f9c, 0x14101c, 0.42));

  const key = new THREE.DirectionalLight(0xcfeaff, 0.7);
  key.position.set(18, 36, -20);
  b.add(key);

  const rim = new THREE.DirectionalLight(0x8b7bff, 0.5);
  rim.position.set(-24, 20, 24);
  b.add(rim);

  // Sodium lamps down the corridors.
  (
    [
      [0, 8, 0, ICE],
      [-14, 6, -14, VIOLET],
      [14, 6, -14, ICE],
      [-14, 6, 14, LIME],
      [14, 6, 14, VIOLET],
      [0, 6, -24, ICE],
      [0, 6, 24, ICE],
      [-24, 6, 0, LIME],
      [24, 6, 0, VIOLET],
    ] as Array<[number, number, number, number]>
  ).forEach(([x, y, z, color]) => {
    const light = new THREE.PointLight(color, 18, 34, 2);
    light.position.set(x, y, z);
    b.add(light);
  });

  /* ------------------------------ atmosphere ---------------------------- */

  const sky = new THREE.Mesh(
    b.track(new THREE.SphereGeometry(HALF * 2.4, 24, 16)),
    b.track(
      new THREE.MeshBasicMaterial({
        color: 0x080d13,
        side: THREE.BackSide,
        fog: true,
      }),
    ),
  );
  b.add(sky);
  // Denser motes read as refrigerated haze.
  b.dust(900, HALF, 12, 0xbfefff);

  // Spawns sit in the corridor mouths rather than on a clean ring; a plain
  // ring at this radius would drop units inside the container stacks.
  const mouths: Array<[number, number]> = [
    [0, -25],
    [0, 25],
    [-25, 0],
    [25, 0],
    [-13.5, -13.5],
    [13.5, -13.5],
    [-13.5, 13.5],
    [13.5, 13.5],
    [-25, -25],
    [25, 25],
  ];
  mouths.forEach(([x, z]) => b.spawnPoints.push(new THREE.Vector3(x, 1.4, z)));

  return b.finish({
    id: 'coldstore',
    name: 'COLD STORAGE',
    playerSpawn: new THREE.Vector3(0, 3.2, 18),
    half: HALF,
    theme: {
      background: 0x040709,
      fogColor: 0x0c1620,
      fogDensity: 0.0155,
      envIntensity: 0.28,
      accent: ICE,
      menuOrbit: { radius: 24, height: 10.5, bob: 1.4, lookAt: [0, 3, 0] },
    },
  });
}
