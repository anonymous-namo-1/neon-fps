import * as THREE from 'three';

import { ArenaBuilder, gridTexture, type Arena } from './builder';

const CYAN = 0x22e0ff;
const MAGENTA = 0xff2d78;
const AMBER = 0xffb020;

/**
 * THE GRID -- the original arena.
 *
 * A symmetric square pit built around a raised central dais. Sightlines are
 * long but every approach has cover, so it reads clearly and plays as the
 * neutral baseline the other maps deviate from.
 */
export function buildGrid(): Arena {
  const b = new ArenaBuilder();
  const HALF = 36;
  const WALL_H = 16;

  /* ------------------------------ materials ----------------------------- */

  const floorTex = b.track(
    gridTexture('#080b11', 'rgba(70, 120, 150, 0.16)', 'rgba(34, 224, 255, 0.42)'),
  );
  floorTex.repeat.set(HALF / 3, HALF / 3);

  const floorMat = b.track(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      color: 0x38495c,
      roughness: 0.55,
      metalness: 0.18,
    }),
  );

  const hullMat = b.hull(0x2e394a);
  const darkHullMat = b.hull(0x1f2732, 0.7, 0.2);

  const cyanTrim = b.pulse(b.trim(CYAN, 1.35));
  const magentaTrim = b.pulse(b.trim(MAGENTA, 1.2));
  const amberTrim = b.pulse(b.trim(AMBER, 1.1));

  /* -------------------------------- floor ------------------------------- */

  const floor = new THREE.Mesh(
    b.track(new THREE.PlaneGeometry(HALF * 2, HALF * 2)),
    floorMat,
  );
  floor.rotation.x = -Math.PI / 2;
  b.add(floor);

  /* -------------------------------- walls ------------------------------- */

  const wallDefs: Array<[number, number, number, number]> = [
    [0, -HALF - 1, HALF * 2 + 4, 2],
    [0, HALF + 1, HALF * 2 + 4, 2],
    [-HALF - 1, 0, 2, HALF * 2 + 4],
    [HALF + 1, 0, 2, HALF * 2 + 4],
  ];
  wallDefs.forEach(([x, z, w, d]) => {
    b.solid(x!, 0, z!, w!, WALL_H, d!, darkHullMat);
    b.solid(x!, 0.3, z!, w! + 0.1, 0.3, d! + 0.1, cyanTrim, false);
    b.solid(x!, 5.4, z!, w! + 0.1, 0.14, d! + 0.1, magentaTrim, false);
  });

  /* ------------------------------ centre dais --------------------------- */

  b.solid(0, 0, 0, 16, 1.5, 16, hullMat);
  b.capTrim(0, 1.5, 0, 16, 16, cyanTrim);

  const stepOffsets: Array<[number, number, number, number]> = [
    [0, -9.2, 16, 2.4],
    [0, 9.2, 16, 2.4],
    [-9.2, 0, 2.4, 16],
    [9.2, 0, 2.4, 16],
  ];
  stepOffsets.forEach(([x, z, w, d]) =>
    b.solid(x!, 0, z!, w!, 0.75, d!, hullMat),
  );

  // Four pylons on the dais corners for vertical interest and cover.
  (
    [
      [-6.4, -6.4],
      [6.4, -6.4],
      [-6.4, 6.4],
      [6.4, 6.4],
    ] as Array<[number, number]>
  ).forEach(([x, z]) => {
    b.solid(x, 1.5, z, 1.5, 7.5, 1.5, darkHullMat);
    b.solid(x, 1.5, z, 1.7, 0.16, 1.7, amberTrim, false);
    b.solid(x, 8.4, z, 1.7, 0.3, 1.7, amberTrim, false);
  });

  /* ------------------------------- cover -------------------------------- */

  // Corner bunkers: an L of two slabs, high enough to break line of sight.
  const bunker = (sx: number, sz: number) => {
    const bx = sx * 22;
    const bz = sz * 22;
    b.solid(bx, 0, bz - sz * 4, 9, 3.4, 2, hullMat);
    b.capTrim(bx, 3.4, bz - sz * 4, 9, 2, magentaTrim);
    b.solid(bx - sx * 4, 0, bz, 2, 3.4, 9, hullMat);
    b.capTrim(bx - sx * 4, 3.4, bz, 2, 9, magentaTrim);
    b.solid(bx, 0, bz, 3.2, 1.6, 3.2, darkHullMat);
    b.capTrim(bx, 1.6, bz, 3.2, 3.2, cyanTrim);
  };
  bunker(-1, -1);
  bunker(1, -1);
  bunker(-1, 1);
  bunker(1, 1);

  // Mid-wall platforms reachable in two hops, for height advantage.
  const perch = (x: number, z: number, w: number, d: number) => {
    b.solid(x, 0, z, w, 2.0, d, hullMat);
    b.capTrim(x, 2.0, z, w, d, cyanTrim);
    b.solid(x * 0.66, 0, z * 0.66, 3, 1.0, 3, darkHullMat);
    b.capTrim(x * 0.66, 1.0, z * 0.66, 3, 3, amberTrim);
  };
  perch(0, -26, 14, 5);
  perch(0, 26, 14, 5);
  perch(-26, 0, 5, 14);
  perch(26, 0, 5, 14);

  // Scattered low slabs to break sightlines across the open diagonals.
  (
    [
      [-15, -15, 4.5, 2.6, 4.5],
      [15, -15, 4.5, 2.6, 4.5],
      [-15, 15, 4.5, 2.6, 4.5],
      [15, 15, 4.5, 2.6, 4.5],
      [-30, -12, 3, 4.4, 6],
      [30, 12, 3, 4.4, 6],
      [-12, 30, 6, 4.4, 3],
      [12, -30, 6, 4.4, 3],
    ] as Array<[number, number, number, number, number]>
  ).forEach(([x, z, w, h, d]) => {
    b.solid(x, 0, z, w, h, d, hullMat);
    b.capTrim(x, h, z, w, d, amberTrim);
  });

  /* ------------------------------- lighting ----------------------------- */

  b.add(new THREE.AmbientLight(0x334455, 0.35));
  b.add(new THREE.HemisphereLight(0x2b5f80, 0x120a18, 0.4));

  const key = new THREE.DirectionalLight(0x9fd8ff, 0.8);
  key.position.set(24, 40, 16);
  b.add(key);

  const rim = new THREE.DirectionalLight(0xff3d84, 0.5);
  rim.position.set(-28, 18, -22);
  b.add(rim);

  (
    [
      [0, 9, 0, CYAN],
      [-24, 8, -24, MAGENTA],
      [24, 8, -24, CYAN],
      [-24, 8, 24, CYAN],
      [24, 8, 24, MAGENTA],
      [0, 7, -30, AMBER],
      [0, 7, 30, AMBER],
    ] as Array<[number, number, number, number]>
  ).forEach(([x, y, z, color]) => {
    const light = new THREE.PointLight(color, 22, 46, 2);
    light.position.set(x, y, z);
    b.add(light);
  });

  /* ------------------------------ atmosphere ---------------------------- */

  const sky = new THREE.Mesh(
    b.track(new THREE.SphereGeometry(HALF * 2.4, 24, 16)),
    b.track(
      new THREE.MeshBasicMaterial({
        color: 0x0a1018,
        side: THREE.BackSide,
        fog: true,
      }),
    ),
  );
  b.add(sky);
  b.dust(700, HALF, 16, 0x6fd7ff);

  b.spawnRing(30, 10, 1.4);

  return b.finish({
    id: 'grid',
    name: 'THE GRID',
    playerSpawn: new THREE.Vector3(0, 3.2, 20),
    half: HALF,
    theme: {
      background: 0x05070c,
      fogColor: 0x0a1420,
      fogDensity: 0.009,
      envIntensity: 0.24,
      accent: CYAN,
      menuOrbit: { radius: 26, height: 7.5, bob: 1.6, lookAt: [0, 3.4, 0] },
    },
  });
}
