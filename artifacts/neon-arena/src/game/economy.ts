export interface Wallet {
  credits: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
}

export type ShopCategory = 'weapon' | 'skin' | 'trail' | 'perk';

export interface ShopItem {
  id: string;
  name: string;
  blurb: string;
  category: ShopCategory;
  price: number;
  /** hex colour used by the card art and, for skins/trails, by the game itself */
  color: number;
  /** optional second colour for skin trim */
  accent?: number;
  /** perks only */
  perk?: 'overshield' | 'extradash' | 'scavenger' | 'headstart';
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'weapon-pulse', name: 'Pulse Driver', blurb: 'Reliable burst fire for clean operators.', category: 'weapon', price: 900, color: 0x22d3ee },
  { id: 'weapon-plasma', name: 'Plasma Lance', blurb: 'Superheated bolts punch through the rush.', category: 'weapon', price: 1200, color: 0xa855f7 },
  { id: 'weapon-scatter', name: 'Street Sweeper', blurb: 'Close-range authority in a wide cone.', category: 'weapon', price: 1050, color: 0xf97316 },
  { id: 'weapon-arc', name: 'Arc Choir', blurb: 'Chain lightning makes crowds conduct.', category: 'weapon', price: 1600, color: 0x38bdf8 },
  { id: 'skin-default', name: 'Factory Black', blurb: 'Standard-issue shell, zero signature.', category: 'skin', price: 0, color: 0x111827, accent: 0x22d3ee },
  { id: 'skin-ion', name: 'Ion Ghost', blurb: 'Cold cyan plating with a live-wire trim.', category: 'skin', price: 500, color: 0x0891b2, accent: 0xa5f3fc },
  { id: 'skin-sundown', name: 'Sundown', blurb: 'Burn orange under a terminal horizon.', category: 'skin', price: 550, color: 0xea580c, accent: 0xfacc15 },
  { id: 'skin-void', name: 'Void Royal', blurb: 'Deep ultraviolet for arena nobility.', category: 'skin', price: 650, color: 0x581c87, accent: 0xd946ef },
  { id: 'skin-toxic', name: 'Toxic Bloom', blurb: 'Hazard green that refuses to hide.', category: 'skin', price: 700, color: 0x4d7c0f, accent: 0xa3e635 },
  { id: 'trail-cyan', name: 'Cold Wake', blurb: 'Leave a razor-cyan afterimage.', category: 'trail', price: 350, color: 0x22d3ee },
  { id: 'trail-ember', name: 'Ember Wake', blurb: 'Dash through a shower of hot sparks.', category: 'trail', price: 425, color: 0xfb923c },
  { id: 'trail-venom', name: 'Venom Wake', blurb: 'Paint every escape route acid green.', category: 'trail', price: 475, color: 0x84cc16 },
  { id: 'trail-glitch', name: 'Glitch Wake', blurb: 'Tear magenta static through the sim.', category: 'trail', price: 600, color: 0xe879f9 },
  { id: 'perk-overshield', name: 'Hard Light', blurb: 'Deploy with a disposable overshield.', category: 'perk', price: 300, color: 0x60a5fa, perk: 'overshield' },
  { id: 'perk-extradash', name: 'Ghost Step', blurb: 'Add one charge to the dash capacitor.', category: 'perk', price: 275, color: 0x2dd4bf, perk: 'extradash' },
  { id: 'perk-scavenger', name: 'Scrap Tax', blurb: 'Hostiles surrender richer salvage.', category: 'perk', price: 325, color: 0xfacc15, perk: 'scavenger' },
  { id: 'perk-headstart', name: 'First Blood', blurb: 'Start each run with bonus firepower.', category: 'perk', price: 225, color: 0xf43f5e, perk: 'headstart' },
] as const;

export interface StoreState {
  wallet: Wallet;
  owned: string[];
  equippedSkin: string;
  equippedTrail: string | null;
  adsWatched: number;
  lastAdAt: number;
}

/**
 * Everything ships unlocked.
 *
 * Guns, skins, trails and perks are all owned from the first launch, and the
 * shop is a locker rather than a paywall. Credits still accumulate as a run
 * score, so the payout screen and the sponsor drop keep working.
 */
export const ALL_ITEM_IDS: readonly string[] = SHOP_ITEMS.map((item) => item.id);

export const DEFAULT_STORE: StoreState = {
  wallet: { credits: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
  owned: [...ALL_ITEM_IDS],
  equippedSkin: 'skin-default',
  equippedTrail: null,
  adsWatched: 0,
  lastAdAt: 0,
};

const STORAGE_KEY = 'neon-arena:store:v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const ITEMS_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));

export const AD_REWARD = 75;
export const AD_COOLDOWN_MS = 10 * 60 * 1000;
export const AD_DAILY_LIMIT = 5;

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function sanitiseStore(value: unknown): StoreState {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const walletSource = source.wallet !== null
    && typeof source.wallet === 'object'
    && !Array.isArray(source.wallet)
    ? source.wallet as Record<string, unknown>
    : {};

  // Every item is unlocked, including for saves written before that was true.
  const owned = new Set<string>(ALL_ITEM_IDS);

  const equippedSkin = typeof source.equippedSkin === 'string'
    && owned.has(source.equippedSkin)
    && ITEMS_BY_ID.get(source.equippedSkin)?.category === 'skin'
    ? source.equippedSkin
    : 'skin-default';
  const equippedTrail = typeof source.equippedTrail === 'string'
    && owned.has(source.equippedTrail)
    && ITEMS_BY_ID.get(source.equippedTrail)?.category === 'trail'
    ? source.equippedTrail
    : null;

  return {
    wallet: {
      credits: whole(walletSource.credits),
      lifetimeEarned: whole(walletSource.lifetimeEarned),
      lifetimeSpent: whole(walletSource.lifetimeSpent),
    },
    owned: [...owned],
    equippedSkin,
    equippedTrail,
    adsWatched: Math.min(AD_DAILY_LIMIT, whole(source.adsWatched)),
    lastAdAt: whole(source.lastAdAt),
  };
}

function copyStore(state: StoreState): StoreState {
  return {
    ...state,
    wallet: { ...state.wallet },
    owned: [...state.owned],
  };
}

export function loadStore(): StoreState {
  try {
    if (typeof localStorage === 'undefined') return copyStore(DEFAULT_STORE);
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? copyStore(DEFAULT_STORE) : sanitiseStore(JSON.parse(raw));
  } catch {
    return copyStore(DEFAULT_STORE);
  }
}

export function saveStore(state: StoreState): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitiseStore(state)));
    }
  } catch {
    // Storage can be unavailable in privacy mode; play remains available in memory.
  }
}

export function purchase(
  state: StoreState,
  itemId: string,
): { ok: boolean; state: StoreState; reason?: 'unknown' | 'owned' | 'funds' } {
  const next = copyStore(state);
  const item = ITEMS_BY_ID.get(itemId);
  if (!item) return { ok: false, state: next, reason: 'unknown' };
  if (state.owned.includes(itemId)) return { ok: false, state: next, reason: 'owned' };
  if (state.wallet.credits < item.price) return { ok: false, state: next, reason: 'funds' };

  next.wallet.credits -= item.price;
  next.wallet.lifetimeSpent += item.price;
  next.owned.push(itemId);
  return { ok: true, state: next };
}

export function equip(state: StoreState, itemId: string): StoreState {
  const next = copyStore(state);
  if (!state.owned.includes(itemId)) return next;
  const item = ITEMS_BY_ID.get(itemId);
  if (item?.category === 'skin') next.equippedSkin = item.id;
  if (item?.category === 'trail') next.equippedTrail = item.id;
  return next;
}

export function grantCredits(state: StoreState, amount: number): StoreState {
  const next = copyStore(state);
  if (!Number.isFinite(amount) || amount <= 0) return next;
  const grant = Math.floor(amount);
  if (grant <= 0) return next;
  next.wallet.credits += grant;
  next.wallet.lifetimeEarned += grant;
  return next;
}

export interface RunPayout {
  score: number;
  kills: number;
  wave: number;
  win: boolean;
}

export function creditsForRun(
  run: RunPayout,
): { total: number; lines: { label: string; amount: number }[] } {
  const score = whole(run.score);
  const kills = whole(run.kills);
  const wave = whole(run.wave);
  const lines = [
    { label: 'SCORE CUT', amount: Math.floor(score / 100) },
    { label: 'KILL BOUNTY', amount: kills * 5 },
    { label: 'WAVE BONUS', amount: wave * 12 },
    { label: 'VICTORY BONUS', amount: run.win ? 75 : 0 },
  ];
  return {
    total: lines.reduce((sum, line) => sum + line.amount, 0),
    lines,
  };
}

export function adAvailability(
  state: StoreState,
  now: number,
): { ready: boolean; waitMs: number; remaining: number } {
  const current = Number.isFinite(now) ? Math.max(0, Math.floor(now)) : 0;
  const lastAdAt = whole(state.lastAdAt);
  const elapsed = Math.max(0, current - lastAdAt);
  const expired = lastAdAt === 0 || elapsed >= DAY_MS;
  const watched = expired ? 0 : Math.min(AD_DAILY_LIMIT, whole(state.adsWatched));
  const remaining = Math.max(0, AD_DAILY_LIMIT - watched);

  if (remaining === 0) {
    return { ready: false, waitMs: Math.max(0, DAY_MS - elapsed), remaining };
  }
  const waitMs = expired ? 0 : Math.max(0, AD_COOLDOWN_MS - elapsed);
  return { ready: waitMs === 0, waitMs, remaining };
}

export function claimAd(
  state: StoreState,
  now: number,
): { ok: boolean; state: StoreState } {
  const availability = adAvailability(state, now);
  if (!availability.ready) return { ok: false, state: copyStore(state) };

  const current = Number.isFinite(now) ? Math.max(0, Math.floor(now)) : 0;
  const previousLast = whole(state.lastAdAt);
  const reset = previousLast === 0 || current - previousLast >= DAY_MS;
  const next = grantCredits(state, AD_REWARD);
  next.adsWatched = (reset ? 0 : Math.min(AD_DAILY_LIMIT, whole(state.adsWatched))) + 1;
  next.lastAdAt = current;
  return { ok: true, state: next };
}