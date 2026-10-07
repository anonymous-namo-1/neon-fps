import type { UpgradeFamily, UpgradeOption, UpgradeTier } from './contract';

/**
 * Every tunable number that upgrades can move. The engine reads these live,
 * so applying an upgrade is just mutating this object.
 */
export interface PlayerStats {
  maxHealth: number;
  maxShield: number;
  /** Seconds without damage before the shield starts regenerating. */
  shieldRegenDelay: number;
  /** Shield points restored per second. */
  shieldRegenRate: number;
  moveSpeed: number;
  maxDashCharges: number;
  /** Seconds to recover one dash charge. */
  dashCooldown: number;
  dashPower: number;
  damageMul: number;
  fireRateMul: number;
  critMul: number;
  magazineMul: number;
  reloadMul: number;
  /** Extra enemies a pulse round passes through. */
  pierce: number;
  splashMul: number;
  /** Health restored per kill. */
  lifesteal: number;
  /** Seconds the combo survives without a kill. */
  comboWindow: number;
  overdriveGainMul: number;
  /** Multiplier on all score earned. */
  scoreMul: number;
}

export function baseStats(): PlayerStats {
  return {
    maxHealth: 100,
    maxShield: 50,
    shieldRegenDelay: 3.4,
    shieldRegenRate: 16,
    moveSpeed: 8.6,
    maxDashCharges: 2,
    dashCooldown: 3.1,
    dashPower: 19,
    damageMul: 1,
    fireRateMul: 1,
    critMul: 2.5,
    magazineMul: 1,
    reloadMul: 1,
    pierce: 0,
    splashMul: 1,
    lifesteal: 0,
    comboWindow: 3.6,
    overdriveGainMul: 1,
    scoreMul: 1,
  };
}

interface UpgradeDef {
  id: string;
  name: string;
  tagline: string;
  effect: string;
  family: UpgradeFamily;
  tier: UpgradeTier;
  maxStacks: number;
  apply: (s: PlayerStats) => void;
}

const DEFS: UpgradeDef[] = [
  {
    id: 'hollow-point',
    name: 'HOLLOW POINT',
    tagline: 'Rounds that open up on impact.',
    effect: '+22% weapon damage',
    family: 'offense',
    tier: 'common',
    maxStacks: 5,
    apply: (s) => {
      s.damageMul *= 1.22;
    },
  },
  {
    id: 'overclock',
    name: 'OVERCLOCK',
    tagline: 'Push the cycle rate past spec.',
    effect: '+18% fire rate',
    family: 'offense',
    tier: 'common',
    maxStacks: 5,
    apply: (s) => {
      s.fireRateMul *= 1.18;
    },
  },
  {
    id: 'extended-cells',
    name: 'EXTENDED CELLS',
    tagline: 'More rounds between reloads.',
    effect: '+35% magazine, -15% reload time',
    family: 'utility',
    tier: 'common',
    maxStacks: 4,
    apply: (s) => {
      s.magazineMul *= 1.35;
      s.reloadMul *= 0.85;
    },
  },
  {
    id: 'kinetic-plating',
    name: 'KINETIC PLATING',
    tagline: 'Bolted-on ablative armour.',
    effect: '+30 max health, full heal',
    family: 'defense',
    tier: 'common',
    maxStacks: 5,
    apply: (s) => {
      s.maxHealth += 30;
    },
  },
  {
    id: 'nano-weave',
    name: 'NANO WEAVE',
    tagline: 'The shield stitches itself back together.',
    effect: '+25 shield, 60% faster regen',
    family: 'defense',
    tier: 'common',
    maxStacks: 4,
    apply: (s) => {
      s.maxShield += 25;
      s.shieldRegenRate *= 1.6;
      s.shieldRegenDelay *= 0.82;
    },
  },
  {
    id: 'momentum',
    name: 'MOMENTUM',
    tagline: 'Nothing that stands still survives here.',
    effect: '+14% movement speed',
    family: 'mobility',
    tier: 'common',
    maxStacks: 4,
    apply: (s) => {
      s.moveSpeed *= 1.14;
    },
  },
  {
    id: 'phase-step',
    name: 'PHASE STEP',
    tagline: 'Fold a metre of space and step through it.',
    effect: '+1 dash charge, -18% dash cooldown',
    family: 'mobility',
    tier: 'rare',
    maxStacks: 3,
    apply: (s) => {
      s.maxDashCharges += 1;
      s.dashCooldown *= 0.82;
    },
  },
  {
    id: 'splinter-rounds',
    name: 'SPLINTER ROUNDS',
    tagline: 'One round, several holes.',
    effect: 'Pulse rounds pierce 1 extra target',
    family: 'offense',
    tier: 'rare',
    maxStacks: 3,
    apply: (s) => {
      s.pierce += 1;
    },
  },
  {
    id: 'wide-bore',
    name: 'WIDE BORE',
    tagline: 'A larger hole for a larger argument.',
    effect: '+45% plasma blast radius',
    family: 'offense',
    tier: 'rare',
    maxStacks: 3,
    apply: (s) => {
      s.splashMul *= 1.45;
    },
  },
  {
    id: 'vampiric-core',
    name: 'VAMPIRIC CORE',
    tagline: 'Their power cells are compatible with yours.',
    effect: 'Restore 6 health per kill',
    family: 'defense',
    tier: 'rare',
    maxStacks: 4,
    apply: (s) => {
      s.lifesteal += 6;
    },
  },
  {
    id: 'chrono-trigger',
    name: 'CHRONO TRIGGER',
    tagline: 'The chain holds a little longer.',
    effect: '+1.6s combo window, +12% score',
    family: 'utility',
    tier: 'rare',
    maxStacks: 3,
    apply: (s) => {
      s.comboWindow += 1.6;
      s.scoreMul *= 1.12;
    },
  },
  {
    id: 'executioner',
    name: 'EXECUTIONER',
    tagline: 'Aim for the glowing part.',
    effect: '+70% critical damage',
    family: 'offense',
    tier: 'elite',
    maxStacks: 3,
    apply: (s) => {
      s.critMul += 1.7;
    },
  },
  {
    id: 'capacitor-bank',
    name: 'CAPACITOR BANK',
    tagline: 'Overdrive charges twice as hungrily.',
    effect: '+75% Overdrive charge rate',
    family: 'utility',
    tier: 'elite',
    maxStacks: 2,
    apply: (s) => {
      s.overdriveGainMul *= 1.75;
    },
  },
  {
    id: 'blast-vector',
    name: 'BLAST VECTOR',
    tagline: 'Ride the shockwave out of trouble.',
    effect: '+35% dash distance, +8% speed',
    family: 'mobility',
    tier: 'elite',
    maxStacks: 2,
    apply: (s) => {
      s.dashPower *= 1.35;
      s.moveSpeed *= 1.08;
    },
  },
];

const TIER_WEIGHT: Record<UpgradeTier, number> = {
  common: 6,
  rare: 3,
  elite: 1.4,
};

export class UpgradePool {
  private taken = new Map<string, number>();

  reset(): void {
    this.taken.clear();
  }

  stacksOf(id: string): number {
    return this.taken.get(id) ?? 0;
  }

  private toOption(def: UpgradeDef): UpgradeOption {
    return {
      id: def.id,
      name: def.name,
      tagline: def.tagline,
      effect: def.effect,
      family: def.family,
      tier: def.tier,
      stacks: this.stacksOf(def.id),
    };
  }

  /** Three distinct upgrades, weighted so elites stay rare. */
  roll(count = 3): UpgradeOption[] {
    const available = DEFS.filter(
      (d) => this.stacksOf(d.id) < d.maxStacks,
    ).slice();
    const picked: UpgradeOption[] = [];

    while (picked.length < count && available.length > 0) {
      const total = available.reduce(
        (sum, d) => sum + TIER_WEIGHT[d.tier],
        0,
      );
      let roll = Math.random() * total;
      let index = 0;
      for (let i = 0; i < available.length; i++) {
        roll -= TIER_WEIGHT[available[i]!.tier];
        if (roll <= 0) {
          index = i;
          break;
        }
      }
      const [def] = available.splice(index, 1);
      if (def) picked.push(this.toOption(def));
    }

    return picked;
  }

  /**
   * Bank an upgrade and mutate the stats. Returns the option as it looked
   * when taken, or null if the id was not a real upgrade.
   */
  take(id: string, stats: PlayerStats): UpgradeOption | null {
    const def = DEFS.find((d) => d.id === id);
    if (!def) return null;
    if (this.stacksOf(id) >= def.maxStacks) return null;
    const option = this.toOption(def);
    def.apply(stats);
    this.taken.set(id, this.stacksOf(id) + 1);
    return { ...option, stacks: this.stacksOf(id) };
  }
}
