import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import type { NetworkPlayerState } from '@/game/engine';

import {
  createTestEngine,
  muzzleRay,
  pointOnMuzzleRay,
  useColliders,
  type TestEngine,
} from './harness';

/**
 * Shooting a squadmate used to be a no-op by construction: hit detection only
 * ever walked the AI list, so a player-versus-player shot could not land no
 * matter where it was aimed. These cover the whole relay -- the shooter
 * resolving the hit, the wire carrying it, and the victim applying it.
 */

function remote(
  id: string,
  at: THREE.Vector3,
  overrides: Partial<NetworkPlayerState> = {},
): NetworkPlayerState {
  return {
    id,
    callsign: id.toUpperCase(),
    x: at.x,
    y: at.y,
    z: at.z,
    yaw: 0,
    health: 100,
    maxHealth: 100,
    dead: false,
    ...overrides,
  };
}

describe('shooting another operator', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  /**
   * Stands a rival on the same floor as the player, directly down the muzzle
   * ray. Remote bodies are anchored at the feet, so the rival's y has to
   * match the shooter's -- otherwise the shot sails over a target sunk into
   * the floor and every assertion here would be measuring the fixture.
   */
  function arena(mode: 'duel' | 'horde' = 'duel', distance = 8) {
    test = createTestEngine();
    const { g } = test;
    useColliders(g, []);
    g.mode = mode;
    const at = pointOnMuzzleRay(g, distance);
    const floor = g.position.y;
    g.setRemotePlayers([remote('rival', new THREE.Vector3(at.x, floor, at.z))]);
    const rival = g.remotePlayers.get('rival')!;
    rival.group.position.set(at.x, floor, at.z);
    rival.target.set(at.x, floor, at.z);
    return { g, rival, floor };
  }

  it('lands a hitscan shot on a rival and queues it for the wire', () => {
    const { g, rival } = arena();
    const { origin, direction } = muzzleRay(g);

    expect(g.hitscan(origin, direction, 25, {})).toBe(true);
    expect(g.pendingHits).toHaveLength(1);
    // A level shot is a headshot, so the queued figure carries the crit
    // multiplier -- the victim applies what it is told, it does not re-roll.
    expect(g.pendingHits[0]).toMatchObject({
      targetId: 'rival',
      damage: 25 * g.stats.critMul,
      headshot: true,
    });
    // The shooter predicts locally so the health bar reacts on the trigger
    // frame rather than a poll later.
    expect(rival.health).toBeLessThan(100);
  });

  it('cannot hurt a squadmate in the co-op horde mode', () => {
    const { g, rival } = arena('horde');
    const { origin, direction } = muzzleRay(g);

    expect(g.hitscan(origin, direction, 25, {})).toBe(false);
    expect(g.pendingHits).toHaveLength(0);
    expect(rival.health).toBe(100);
  });

  it('does not shoot a rival who is already down', () => {
    const { g, rival } = arena();
    rival.dead = true;
    const { origin, direction } = muzzleRay(g);

    expect(g.hitscan(origin, direction, 25, {})).toBe(false);
    expect(g.pendingHits).toHaveLength(0);
  });

  it('sends each hit exactly once', () => {
    const { g } = arena();
    const { origin, direction } = muzzleRay(g);
    g.hitscan(origin, direction, 25, {});

    expect(g.drainHits()).toHaveLength(1);
    expect(g.drainHits()).toHaveLength(0);
  });

  it('caps a burst so a stalled poll cannot send an unbounded payload', () => {
    const { g } = arena();
    const { origin, direction } = muzzleRay(g);
    for (let i = 0; i < 60; i += 1) g.hitscan(origin, direction, 1, {});

    expect(g.drainHits().length).toBeLessThanOrEqual(32);
  });

  it('credits a kill and clears the rival once its health runs out', () => {
    const { g, rival } = arena();
    const { origin, direction } = muzzleRay(g);
    const before = g.kills;

    g.hitscan(origin, direction, 500, {});

    expect(rival.dead).toBe(true);
    expect(rival.health).toBeLessThanOrEqual(0);
    expect(g.kills).toBe(before + 1);
  });

  // A level shot puts the crosshair at head height, which is above the top of
  // the torso sphere. Gating the head test on a body hit made exactly this
  // shot a no-op, so it gets its own case.
  it('lands a perfectly level shot as a headshot rather than a miss', () => {
    const { g } = arena();
    const { origin, direction } = muzzleRay(g);
    expect(direction.y).toBeCloseTo(0, 6);

    expect(g.hitscan(origin, direction, 20, {})).toBe(true);
    expect(g.pendingHits[0]).toMatchObject({ targetId: 'rival', headshot: true });
  });

  it('still registers a body shot when the aim drops below the head', () => {
    const { g, rival, floor } = arena();
    const { origin } = muzzleRay(g);
    const chest = rival.group.position
      .clone()
      .setY(floor + 0.9)
      .sub(origin)
      .normalize();

    expect(g.hitscan(origin, chest, 20, {})).toBe(true);
    expect(g.pendingHits[0]).toMatchObject({ targetId: 'rival', headshot: false });
  });

  it('reconciles a predicted hit without the bar jumping back up', () => {
    const { g, rival } = arena();
    const { origin, direction } = muzzleRay(g);
    g.hitscan(origin, direction, 25, {});
    const predicted = rival.health;

    expect(predicted).toBeLessThan(100);

    // The victim has not applied the hit yet, so the wire still reports full
    // health. The prediction must win until the wire catches up.
    g.setRemotePlayers([
      remote('rival', rival.group.position.clone(), { health: 100 }),
    ]);
    expect(g.remotePlayers.get('rival')!.health).toBe(predicted);

    // A wire value below the prediction means they took damage from someone
    // else too, and that wins.
    g.setRemotePlayers([
      remote('rival', rival.group.position.clone(), { health: 10 }),
    ]);
    expect(g.remotePlayers.get('rival')!.health).toBe(10);
  });

  it('lets a rival heal back up instead of pinning them to a stale prediction', () => {
    const { g, rival } = arena();
    const { origin, direction } = muzzleRay(g);
    g.hitscan(origin, direction, 25, {});
    const at = rival.group.position.clone();

    // Victim acknowledges, then recovers -- a fresh duel round, say.
    g.setRemotePlayers([remote('rival', at, { health: 30 })]);
    expect(g.remotePlayers.get('rival')!.health).toBe(30);

    g.setRemotePlayers([remote('rival', at, { health: 100 })]);
    expect(g.remotePlayers.get('rival')!.health).toBe(100);
  });
});

describe('taking a hit from another operator', () => {
  let test: TestEngine | null = null;

  afterEach(() => {
    test?.dispose();
    test = null;
  });

  it('applies damage the server relayed back', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.shield = 0;
    const before = g.health;

    g.applyIncomingDamage([
      { fromId: 'rival', fromCallsign: 'RIVAL', damage: 30, headshot: false },
    ]);

    expect(g.health).toBe(before - 30);
  });

  it('stacks several relayed hits in one poll', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.shield = 0;
    const before = g.health;

    g.applyIncomingDamage([
      { fromId: 'a', fromCallsign: 'A', damage: 10, headshot: false },
      { fromId: 'b', fromCallsign: 'B', damage: 15, headshot: true },
    ]);

    expect(g.health).toBe(before - 25);
  });

  it('ignores an empty relay', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'playing';
    g.shield = 0;
    const before = g.health;
    g.applyIncomingDamage([]);
    expect(g.health).toBe(before);
  });

  it('ignores relayed damage once the run is over', () => {
    test = createTestEngine();
    const { g } = test;
    g.phase = 'dead';
    const before = g.health;

    g.applyIncomingDamage([
      { fromId: 'rival', fromCallsign: 'RIVAL', damage: 30, headshot: false },
    ]);

    expect(g.health).toBe(before);
  });
});
