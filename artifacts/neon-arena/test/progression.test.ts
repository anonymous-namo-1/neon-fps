import { beforeEach, describe, expect, it } from 'vitest';

import { STARTER_LOADOUT } from '../src/game/contract';
import {
  UNLOCKS,
  awardRun,
  describeProgress,
  emptyRecord,
  levelCost,
  loadProgress,
  sanitiseLoadout,
  sanitiseModifiers,
  unlockLevelFor,
} from '../src/game/progression';

const STORAGE_KEY = 'neon-arena:progress:v1';
const LEGACY_BEST_KEY = 'neon-arena:best';

function xpAtLevel(level: number): number {
  let xp = 0;
  for (let current = 1; current < level; current += 1) {
    xp += levelCost(current);
  }
  return xp;
}

describe('career levels and unlocks', () => {
  it('uses the documented linear level curve', () => {
    expect([1, 2, 3, 4, 12].map(levelCost)).toEqual([
      600, 900, 1200, 1500, 3900,
    ]);
  });

  // Everything ships unlocked, so the catalogue is a "what is in the game"
  // list rather than a gate. These guard against a level requirement being
  // reintroduced by accident.
  it('hands over the entire catalogue from the very first run', () => {
    const fresh = describeProgress(emptyRecord());
    expect(fresh.level).toBe(1);
    expect(fresh.unlocked).toEqual(UNLOCKS.map((unlock) => unlock.id));
    expect(fresh.nextUnlock).toBeNull();
  });

  it.each(UNLOCKS)('leaves $id ungated', (unlock) => {
    expect(unlock.level).toBe(1);
    expect(unlockLevelFor(unlock.kind, unlock.target)).toBe(1);
  });

  it('still counts XP and levels so the career screen has something to show', () => {
    const boundary = xpAtLevel(3);
    expect(describeProgress({ ...emptyRecord(), xp: boundary - 1 }).level).toBe(2);
    const at = describeProgress({ ...emptyRecord(), xp: boundary });
    expect(at.level).toBe(3);
    expect(at.xpIntoLevel).toBe(0);
  });
});

describe('stored career recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['malformed JSON', '{"xp":'],
    ['JSON null', 'null'],
    ['array', '[9000]'],
  ])('turns a %s record into a sane starting career', (_name, raw) => {
    if (raw !== null) window.localStorage.setItem(STORAGE_KEY, raw);
    expect(loadProgress()).toEqual(emptyRecord());
  });

  it('preserves valid fields in a partial or hostile record', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        xp: 2400.9,
        runs: -20,
        kills: '500',
        bestScore: Number.MAX_VALUE,
        bestWave: Number.NaN,
        extra: 'ignored',
      }),
    );

    expect(loadProgress()).toEqual({
      xp: 2400,
      runs: 0,
      kills: 0,
      bestScore: Math.floor(Number.MAX_VALUE),
      bestWave: 0,
    });
  });

  it('recovers and migrates a legacy best even when the current record is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-json');
    window.localStorage.setItem(LEGACY_BEST_KEY, '4321');
    expect(loadProgress()).toEqual({ ...emptyRecord(), bestScore: 4321 });
  });

  it('keeps the greater score when both current and legacy records exist', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...emptyRecord(), xp: 700, bestScore: 5000 }),
    );
    window.localStorage.setItem(LEGACY_BEST_KEY, '4321');
    expect(loadProgress()).toEqual({
      ...emptyRecord(),
      xp: 700,
      bestScore: 5000,
    });
  });
});

describe('saved kit sanitising', () => {
  it('drops unknown and duplicate weapons but keeps every real one', () => {
    expect(
      sanitiseLoadout(
        ['arc', 'renamed-weapon', 'pulse', 'pulse'] as never[],
        1,
      ),
    ).toEqual(['arc', 'pulse']);
  });

  it('falls back to the starter kit when nothing usable survives', () => {
    expect(sanitiseLoadout(['renamed-weapon'] as never[], 1)).toEqual(
      STARTER_LOADOUT,
    );
  });

  it('keeps known weapons while enforcing slot count', () => {
    expect(sanitiseLoadout(['arc', 'scatter', 'plasma'], 4)).toEqual([
      'arc',
      'scatter',
    ]);
  });

  it('drops unknown and duplicate modifiers at any level', () => {
    expect(
      sanitiseModifiers(
        ['glass', 'renamed-modifier', 'iron', 'iron'] as never[],
        1,
      ),
    ).toEqual(['iron', 'glass']);
  });
});

describe('awarding a run', () => {
  it('banks XP, totals, unlocks crossed, and a new personal best', () => {
    const starting = {
      ...emptyRecord(),
      xp: 590,
      runs: 2,
      kills: 10,
      bestScore: 900,
      bestWave: 2,
    };
    const result = awardRun(starting, { score: 1000, wave: 3, kills: 4 });

    expect(result.record).toEqual({
      xp: 732,
      runs: 3,
      kills: 14,
      bestScore: 1000,
      bestWave: 3,
    });
    expect(result.reward).toMatchObject({
      xpEarned: 142,
      levelBefore: 1,
      levelAfter: 2,
      personalBest: true,
    });
    expect(result.reward.breakdown).toEqual([
      { label: 'SCORE', xp: 40 },
      { label: 'WAVE 3', xp: 90 },
      { label: '4 KILLS', xp: 12 },
    ]);
    // Nothing is gated behind a level any more, so crossing one hands over
    // nothing new.
    expect(result.reward.unlocked).toEqual([]);
    expect(starting).toEqual({
      ...emptyRecord(),
      xp: 590,
      runs: 2,
      kills: 10,
      bestScore: 900,
      bestWave: 2,
    });
  });

  it('does not flag ties, zero scores, or lower scores as personal bests', () => {
    const record = { ...emptyRecord(), bestScore: 1000 };
    expect(
      awardRun(record, { score: 1000, wave: 0, kills: 0 }).reward.personalBest,
    ).toBe(false);
    expect(
      awardRun(record, { score: 0, wave: 0, kills: 0 }).reward.personalBest,
    ).toBe(false);
  });

  it('neutralises non-finite and negative run values before persistence', () => {
    const result = awardRun(emptyRecord(), {
      score: Number.NaN,
      wave: Number.POSITIVE_INFINITY,
      kills: -50,
    });
    expect(result.record).toEqual({ ...emptyRecord(), runs: 1 });
    expect(result.reward.xpEarned).toBe(0);
  });
});