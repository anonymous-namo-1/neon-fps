import { beforeEach, describe, expect, it } from 'vitest';

import {
  AD_COOLDOWN_MS,
  AD_DAILY_LIMIT,
  DEFAULT_STORE,
  SHOP_ITEMS,
  adAvailability,
  claimAd,
  creditsForRun,
  equip,
  loadStore,
  purchase,
  type StoreState,
} from '../src/game/economy';

const STORAGE_KEY = 'neon-arena:store:v1';
const DAY_MS = 24 * 60 * 60 * 1000;

function store(credits = 0): StoreState {
  return {
    ...DEFAULT_STORE,
    wallet: { ...DEFAULT_STORE.wallet, credits },
    owned: [...DEFAULT_STORE.owned],
  };
}

describe('shop stock', () => {
  it('ships every catalogue item already owned', () => {
    expect([...DEFAULT_STORE.owned].sort()).toEqual(
      SHOP_ITEMS.map((item) => item.id).sort(),
    );
  });

  it('rejects unknown stock and anything already owned, without touching the input', () => {
    const starting = store();
    expect(purchase(starting, 'weapon-deleted')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(purchase(starting, 'skin-default')).toMatchObject({ ok: false, reason: 'owned' });
    // Everything is owned, so nothing in the catalogue is ever purchasable.
    expect(purchase(starting, 'weapon-pulse')).toMatchObject({ ok: false, reason: 'owned' });
    expect(starting).toEqual(store());
  });

  // The transaction path is kept so a future paid item still works, and so a
  // forged UI event cannot spend credits the player does not have.
  it('debits the price and grants ownership when an item is somehow unowned', () => {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === 'weapon-pulse')!;
    const trimmed = { ...store(item.price + 20), owned: ['skin-default'] };
    const result = purchase(trimmed, item.id);
    expect(result.ok).toBe(true);
    expect(result.state.wallet).toMatchObject({ credits: 20, lifetimeSpent: item.price });
    expect(result.state.owned).toContain(item.id);
  });

  it('still refuses a purchase the wallet cannot cover', () => {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === 'weapon-pulse')!;
    const trimmed = { ...store(item.price - 1), owned: ['skin-default'] };
    expect(purchase(trimmed, item.id)).toMatchObject({ ok: false, reason: 'funds' });
  });
});

describe('equipping cosmetics', () => {
  it('equips anything in the catalogue, since it is all owned', () => {
    expect(equip(store(), 'skin-ion').equippedSkin).toBe('skin-ion');
    expect(equip(store(), 'trail-cyan').equippedTrail).toBe('trail-cyan');
  });

  it('refuses items that are not in the catalogue at all', () => {
    const starting = store();
    expect(equip(starting, 'skin-removed')).toEqual(starting);
  });

  it('routes skins and trails independently while ignoring other categories', () => {
    const starting = store();
    const skinned = equip(starting, 'skin-ion');
    const trailed = equip(skinned, 'trail-cyan');
    expect(trailed.equippedSkin).toBe('skin-ion');
    expect(trailed.equippedTrail).toBe('trail-cyan');
    expect(equip(trailed, 'weapon-pulse')).toEqual(trailed);
  });
});

describe('stored economy recovery', () => {
  beforeEach(() => window.localStorage.clear());

  it.each(['{oops', 'null', '[]'])('survives corrupt storage (%s)', (raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    expect(loadStore()).toEqual(DEFAULT_STORE);
  });

  it('grants the whole catalogue to an old save and repairs invalid equipped cosmetics', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      wallet: { credits: 42 },
      owned: ['removed-item', 'trail-cyan'],
      equippedSkin: 'skin-removed',
      equippedTrail: 'trail-removed',
    }));
    const loaded = loadStore();
    expect([...loaded.owned].sort()).toEqual(
      SHOP_ITEMS.map((item) => item.id).sort(),
    );
    expect(loaded).toMatchObject({
      equippedSkin: 'skin-default',
      equippedTrail: null,
    });
    expect(loaded.wallet.credits).toBe(42);
  });
});

describe('run payout', () => {
  it('keeps the itemised ledger equal to the banked total', () => {
    const payout = creditsForRun({ score: 10_000, kills: 20, wave: 6, win: true });
    expect(payout.lines).toHaveLength(4);
    expect(payout.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(payout.total);
    expect(payout.total).toBeGreaterThanOrEqual(150);
    expect(payout.total).toBeLessThanOrEqual(400);
  });
});

describe('sponsor feed limits', () => {
  it('becomes ready at the exact cooldown boundary, not one millisecond early', () => {
    const state = { ...store(), adsWatched: 1, lastAdAt: 1_000 };
    expect(adAvailability(state, 1_000 + AD_COOLDOWN_MS - 1).ready).toBe(false);
    expect(adAvailability(state, 1_000 + AD_COOLDOWN_MS)).toMatchObject({ ready: true, waitMs: 0 });
  });

  it('blocks the daily limit until the exact rolling 24-hour boundary', () => {
    const state = { ...store(), adsWatched: AD_DAILY_LIMIT, lastAdAt: 2_000 };
    expect(adAvailability(state, 2_000 + DAY_MS - 1)).toEqual({
      ready: false,
      waitMs: 1,
      remaining: 0,
    });
    expect(adAvailability(state, 2_000 + DAY_MS)).toEqual({
      ready: true,
      waitMs: 0,
      remaining: AD_DAILY_LIMIT,
    });
  });

  it('does not pay blocked claims and resets a stale daily counter on a valid claim', () => {
    const limited = { ...store(), adsWatched: AD_DAILY_LIMIT, lastAdAt: 5_000 };
    expect(claimAd(limited, 5_000 + AD_COOLDOWN_MS).ok).toBe(false);
    const reset = claimAd(limited, 5_000 + DAY_MS);
    expect(reset.ok).toBe(true);
    expect(reset.state.adsWatched).toBe(1);
  });
});