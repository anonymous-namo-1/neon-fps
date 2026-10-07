import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ENEMY_CONFIG } from '@/game/enemies';

import {
  createTestEngine,
  pointOnMuzzleRay,
  muzzleRay,
  spawnEnemy,
  useColliders,
  type EngineInternals,
  type TestEnemy,
  type TestEngine,
} from './harness';

/**
 * The damage rules that are easy to break without anything looking wrong.
 *
 * Every number here is written out rather than imported from the engine: a
 * test that recomputes the rule from the same constants the rule uses cannot
 * fail when the rule changes, which is the only thing it is for.
 */

/** Engine tuning, restated so a change to it has to be a deliberate one. */
const SCATTER_FALLOFF = { start: 9, end: 30, min: 0.16 };
const ARC_LINK_DECAY = 0.78;
const ARC_CHAIN_MAX = 4;
const ARC_CHAIN_RANGE = 9.5;
const WARDEN_SHIELD_ARC = Math.PI * 0.42;
const WARDEN_SHIELD_LEAK = 0.14;

function damageTaken(enemy: TestEnemy): number {
  return enemy.maxHealth - enemy.health;
}

describe('damage rules', () => {
  let harness: TestEngine;
  let g: EngineInternals;

  beforeEach(() => {
    harness = createTestEngine();
    g = harness.g;
    g.phase = 'playing';
    // Nothing between the muzzle and the probe targets.
    useColliders(g);
  });

  afterEach(() => harness.dispose());

  /* =================================================================== */

  describe('warden frontal shield', () => {
    /** Applies one hit and rolls the health back so cases stay independent. */
    function hit(warden: TestEnemy, amount: number, crit = false): number {
      const before = warden.health;
      g.damageEnemy(warden, amount, crit, warden.position);
      const dealt = before - warden.health;
      warden.health = before;
      return dealt;
    }

    /** Stands the player at `angle` radians around a warden facing +Z. */
    function standAt(angle: number): void {
      g.position.set(Math.sin(angle) * 12, 0, Math.cos(angle) * 12);
    }

    let warden: TestEnemy;

    beforeEach(() => {
      warden = spawnEnemy(g, 'warden', new THREE.Vector3(0, 1.3, 0), {
        facing: 0,
        shieldDown: 0,
      });
      expect(warden.config.shieldArc).toBeCloseTo(WARDEN_SHIELD_ARC, 10);
      expect(warden.config.shieldLeak).toBeCloseTo(WARDEN_SHIELD_LEAK, 10);
    });

    it('leaks only a fraction of a frontal hit', () => {
      standAt(0);
      expect(hit(warden, 100)).toBeCloseTo(100 * WARDEN_SHIELD_LEAK, 8);
    });

    it('takes a flanking hit in full', () => {
      standAt(Math.PI);
      expect(hit(warden, 100)).toBeCloseTo(100, 8);
    });

    it('blocks up to the arc edge and no further', () => {
      standAt(WARDEN_SHIELD_ARC - 0.01);
      expect(hit(warden, 100)).toBeCloseTo(100 * WARDEN_SHIELD_LEAK, 8);

      standAt(WARDEN_SHIELD_ARC + 0.01);
      expect(hit(warden, 100)).toBeCloseTo(100, 8);

      // Symmetric about the facing direction.
      standAt(-(WARDEN_SHIELD_ARC - 0.01));
      expect(hit(warden, 100)).toBeCloseTo(100 * WARDEN_SHIELD_LEAK, 8);
    });

    it('is open while the warden is firing', () => {
      standAt(0);
      warden.shieldDown = 1.15;
      expect(hit(warden, 100)).toBeCloseTo(100, 8);
    });

    it('suppresses the critical multiplier on a blocked hit', () => {
      standAt(0);
      expect(hit(warden, 100, true)).toBeCloseTo(100 * WARDEN_SHIELD_LEAK, 8);

      standAt(Math.PI);
      expect(hit(warden, 100, true)).toBeCloseTo(100 * g.stats.critMul, 8);
    });

    it('is judged from where the player stands, not from the impact point', () => {
      // Splash and chain damage carry no meaningful impact direction, so the
      // rule is deliberately positional: flanking beats aiming.
      standAt(0);
      const behind = new THREE.Vector3(0, 1.3, -3);
      const before = warden.health;
      g.damageEnemy(warden, 100, false, behind);
      expect(before - warden.health).toBeCloseTo(100 * WARDEN_SHIELD_LEAK, 8);
    });

    it('applies no shield rule to archetypes without one', () => {
      const skitter = spawnEnemy(g, 'skitter', new THREE.Vector3(4, 1, 0), {
        health: 1e6,
        maxHealth: 1e6,
      });
      standAt(0);
      g.damageEnemy(skitter, 100, false, skitter.position);
      expect(damageTaken(skitter)).toBeCloseTo(100, 8);
    });
  });

  /* =================================================================== */

  describe('arc tether', () => {
    /** Puts `count` tough targets straight down the muzzle ray. */
    function line(distances: number[]): TestEnemy[] {
      return distances.map((d) =>
        spawnEnemy(g, 'skitter', pointOnMuzzleRay(g, d), {
          health: 1e6,
          maxHealth: 1e6,
        }),
      );
    }

    it('loses a fixed fraction of its damage on every jump', () => {
      const chain = line([5, 10, 15, 20]);
      const { origin, direction } = muzzleRay(g);

      expect(g.arcChain(origin, direction, 100)).toBe(true);

      chain.forEach((enemy, index) => {
        expect(damageTaken(enemy)).toBeCloseTo(
          100 * Math.pow(ARC_LINK_DECAY, index),
          6,
        );
      });
    });

    it('stops after the maximum number of links', () => {
      const chain = line([5, 10, 15, 20, 25, 30]);
      const { origin, direction } = muzzleRay(g);

      g.arcChain(origin, direction, 100);

      chain.slice(0, ARC_CHAIN_MAX).forEach((enemy) => {
        expect(damageTaken(enemy)).toBeGreaterThan(0);
      });
      chain.slice(ARC_CHAIN_MAX).forEach((enemy) => {
        expect(damageTaken(enemy)).toBe(0);
      });
    });

    it('jumps to a target just inside the link range', () => {
      const [first, second] = line([5, 5 + ARC_CHAIN_RANGE - 0.1]);
      const { origin, direction } = muzzleRay(g);

      g.arcChain(origin, direction, 100);

      expect(damageTaken(first!)).toBeCloseTo(100, 6);
      expect(damageTaken(second!)).toBeCloseTo(100 * ARC_LINK_DECAY, 6);
    });

    it('will not jump to a target just outside the link range', () => {
      const [first, second] = line([5, 5 + ARC_CHAIN_RANGE + 0.1]);
      const { origin, direction } = muzzleRay(g);

      g.arcChain(origin, direction, 100);

      expect(damageTaken(first!)).toBeCloseTo(100, 6);
      expect(damageTaken(second!)).toBe(0);
    });

    it('reports a miss when the ray grabs nothing', () => {
      const { origin, direction } = muzzleRay(g);
      expect(g.arcChain(origin, direction, 100)).toBe(false);
    });
  });

  /* =================================================================== */

  describe('scatter range falloff', () => {
    /**
     * Fires one hitscan at a target whose *surface* is `distance` from the
     * muzzle -- the engine measures falloff to the impact point, not to the
     * enemy's centre -- and returns the damage that landed.
     */
    function shoot(
      distance: number,
      options?: { falloff?: typeof SCATTER_FALLOFF },
    ): number {
      const target = spawnEnemy(
        g,
        'skitter',
        pointOnMuzzleRay(g, distance + ENEMY_CONFIG.skitter.radius),
        { health: 1e6, maxHealth: 1e6 },
      );
      const { origin, direction } = muzzleRay(g);
      expect(g.hitscan(origin, direction, 100, options)).toBe(true);
      return damageTaken(target);
    }

    beforeEach(() => {
      // A shot straight through the centre also clips the weak point; crits
      // are a separate rule and would drown out the one under test.
      g.stats.critMul = 1;
    });

    it('deals full damage inside the falloff start', () => {
      expect(shoot(5, { falloff: SCATTER_FALLOFF })).toBeCloseTo(100, 6);
    });

    it('scales linearly between the start and end ranges', () => {
      const mid = (SCATTER_FALLOFF.start + SCATTER_FALLOFF.end) / 2;
      expect(shoot(mid, { falloff: SCATTER_FALLOFF })).toBeCloseTo(50, 6);
    });

    it('bottoms out at the minimum rather than reaching zero', () => {
      expect(shoot(SCATTER_FALLOFF.end + 10, { falloff: SCATTER_FALLOFF })).toBeCloseTo(
        100 * SCATTER_FALLOFF.min,
        6,
      );
    });

    it('leaves weapons without a falloff profile untouched by range', () => {
      expect(shoot(5)).toBeCloseTo(100, 6);
      harness.dispose();
      harness = createTestEngine();
      g = harness.g;
      g.phase = 'playing';
      g.stats.critMul = 1;
      useColliders(g);
      expect(shoot(40)).toBeCloseTo(100, 6);
    });

    it('costs a real shard burst most of its damage across the arena', () => {
      g.stats.critMul = 1;
      g.applyLoadout(['scatter', 'pulse']);
      g.swapWeapon('scatter');

      // Wide enough that the whole 9-pellet cone connects at both ranges, so
      // the comparison is falloff and not how many pellets happened to land.
      const volley = (distance: number): number => {
        const target = spawnEnemy(g, 'brute', pointOnMuzzleRay(g, distance), {
          radius: 6,
          health: 1e6,
          maxHealth: 1e6,
        });
        g.fire(0);
        const dealt = damageTaken(target);
        g.killEnemy(target, false);
        return dealt;
      };

      const near = volley(8);
      const far = volley(30);

      expect(near).toBeGreaterThan(0);
      expect(far).toBeGreaterThan(0);
      expect(far).toBeLessThan(near * 0.45);
    });
  });

  /* =================================================================== */

  describe('seeker detonation', () => {
    beforeEach(() => {
      g.startWave(1);
      g.waveQueue.length = 0;
      g.waveTotal = 1;
      g.waveKilled = 0;
      g.position.set(0, 0, 40);
      g.playerCenter.set(0, 0.98, 40);
    });

    it('pays no score and no combo when it removes itself', () => {
      const seeker = spawnEnemy(g, 'seeker', new THREE.Vector3(0, 1.7, 0));

      g.seekerDetonate(seeker);

      expect(g.score).toBe(0);
      expect(g.chain).toBe(0);
      expect(g.bestCombo).toBe(1);
    });

    it('still counts toward the wave', () => {
      const seeker = spawnEnemy(g, 'seeker', new THREE.Vector3(0, 1.7, 0));

      g.seekerDetonate(seeker);

      expect(g.kills).toBe(1);
      expect(g.waveKilled).toBe(1);
      expect(g.enemies).toHaveLength(0);
      // Last unit of the wave: the wave has to complete, or the run stalls
      // waiting for an enemy that killed itself.
      expect(g.clearing).toBe(true);
    });

    it('pays full score when the player shoots it down instead', () => {
      const seeker = spawnEnemy(g, 'seeker', new THREE.Vector3(0, 1.7, 0));

      g.damageEnemy(seeker, 1e6, false, seeker.position);

      // First kill of a run: combo is 1 + 0.2.
      expect(g.score).toBe(Math.round(ENEMY_CONFIG.seeker.score * 1.2));
      expect(g.chain).toBe(1);
      expect(g.kills).toBe(1);
      expect(g.waveKilled).toBe(1);
    });
  });
});
