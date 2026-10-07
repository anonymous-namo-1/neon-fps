import { useState } from 'react';
import type { JSX } from 'react';

import {
  SHOP_ITEMS,
  type ShopCategory,
  type StoreState,
} from '@/game/economy';
import { GlitchHeading, UiButton, UiPanel } from './shared';

export interface ShopProps {
  state: StoreState;
  onPurchase: (id: string) => void;
  onEquip: (id: string) => void;
  onWatchAd: () => void;
  adState: { ready: boolean; waitMs: number; remaining: number };
  adPlaying: boolean;
  adProgress: number;
  onBack: () => void;
}

const TABS: { id: ShopCategory; label: string }[] = [
  { id: 'weapon', label: 'Weapons' },
  { id: 'skin', label: 'Skins' },
  { id: 'trail', label: 'Trails' },
  { id: 'perk', label: 'Perks' },
];

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function Shop(props: ShopProps): JSX.Element {
  const [category, setCategory] = useState<ShopCategory>('weapon');
  const progress = Math.max(0, Math.min(1, props.adProgress));

  return (
    <div className="absolute inset-0 z-30 flex flex-col overflow-hidden bg-background/95 text-white pointer-events-auto">
      <div className="absolute inset-0 bg-scanline opacity-10 pointer-events-none" />
      <div className="absolute -top-48 left-1/3 h-96 w-96 bg-primary/10 blur-[120px] pointer-events-none" />

      <header className="relative flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-black/30 px-5 py-4 md:px-8">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-primary">
            Arena requisitions // secure channel
          </div>
          <GlitchHeading className="!text-3xl md:!text-5xl">BLACK MARKET</GlitchHeading>
        </div>
        <div className="flex items-center gap-4">
          <div className="border-l-2 border-accent px-4 text-right">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Credit balance</div>
            <div className="font-mono text-2xl font-bold text-accent" data-testid="text-shop-credits">
              {props.state.wallet.credits.toLocaleString()} CR
            </div>
          </div>
          <UiButton onClick={props.onBack} variant="outline" testId="button-shop-back">BACK</UiButton>
        </div>
      </header>

      <main className="relative mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4 px-5 py-5 md:px-8">
        {props.adPlaying ? (
          <SponsorFeed progress={progress} />
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Shop categories">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={category === tab.id}
                  onClick={() => setCategory(tab.id)}
                  data-testid={`button-shop-tab-${tab.id}`}
                  className={`clip-path-slant border px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.25em] transition-colors ${
                    category === tab.id
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-white/10 bg-white/5 text-muted-foreground hover:border-primary/40 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="custom-scrollbar grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {SHOP_ITEMS.filter((item) => item.category === category).map((item) => {
                const owned = props.state.owned.includes(item.id);
                const equipped = props.state.equippedSkin === item.id || props.state.equippedTrail === item.id;
                const cosmetic = item.category === 'skin' || item.category === 'trail';
                const shortfall = Math.max(0, item.price - props.state.wallet.credits);
                const disabled = (!owned && shortfall > 0) || (owned && (!cosmetic || equipped));
                const color = hex(item.color);
                const accent = hex(item.accent ?? item.color);

                return (
                  <UiPanel
                    key={item.id}
                    className={`flex min-h-64 flex-col overflow-hidden transition-opacity ${shortfall > 0 && !owned ? 'opacity-55' : ''}`}
                  >
                    <div
                      className="relative h-24 border-b border-white/10 overflow-hidden"
                      style={{
                        background: `linear-gradient(135deg, ${color}33, #030712 55%, ${accent}22)`,
                        boxShadow: `inset 0 -1px 0 ${color}88`,
                      }}
                    >
                      <div
                        className="absolute left-7 top-5 h-12 w-28 -skew-x-12 border"
                        style={{
                          borderColor: color,
                          background: `linear-gradient(90deg, transparent, ${accent}44)`,
                          boxShadow: `0 0 20px ${color}66`,
                        }}
                      />
                      <div className="absolute bottom-2 right-3 font-mono text-[9px] uppercase tracking-[0.3em] text-white/40">
                        {item.category} // {item.id}
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <h3 className="font-bold uppercase tracking-wider text-white">{item.name}</h3>
                        {owned && <span className="font-mono text-[9px] uppercase tracking-widest text-primary">Owned</span>}
                      </div>
                      <p className="mb-4 flex-1 font-mono text-xs leading-relaxed text-muted-foreground">{item.blurb}</p>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => owned ? props.onEquip(item.id) : props.onPurchase(item.id)}
                        data-testid={`button-shop-item-${item.id}`}
                        className={`clip-path-slant border px-3 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] transition-colors ${
                          equipped
                            ? 'border-accent/60 bg-accent/10 text-accent'
                            : disabled
                              ? 'cursor-not-allowed border-white/10 bg-black/30 text-muted-foreground'
                              : 'border-primary/60 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground'
                        }`}
                      >
                        {equipped
                          ? 'Equipped'
                          : owned
                            ? cosmetic ? 'Equip' : 'Active every run'
                            : shortfall > 0
                              ? `Short ${shortfall} CR`
                              : `${item.price} CR`}
                      </button>
                    </div>
                  </UiPanel>
                );
              })}
            </div>
          </>
        )}

        {!props.adPlaying && (
          <UiPanel className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" slant={false}>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-white">Sponsor uplink</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {props.adState.ready
                  ? `${props.adState.remaining} feeds remaining in this cycle`
                  : props.adState.remaining === 0
                    ? `Daily allocation exhausted // resets in ${formatWait(props.adState.waitMs)}`
                    : `Signal cooling // ${formatWait(props.adState.waitMs)} // ${props.adState.remaining} remaining`}
              </div>
            </div>
            <UiButton
              onClick={props.onWatchAd}
              disabled={!props.adState.ready}
              variant="outline"
              className="text-sm"
              testId="button-watch-sponsor"
            >
              {props.adState.ready ? 'WATCH SPONSOR FEED // +CREDITS' : `UPLINK ${formatWait(props.adState.waitMs)}`}
            </UiButton>
          </UiPanel>
        )}
      </main>
    </div>
  );
}

function SponsorFeed({ progress }: { progress: number }): JSX.Element {
  return (
    <UiPanel className="m-auto flex w-full max-w-3xl flex-col gap-8 p-8 md:p-12" slant={false}>
      <div className="flex items-center justify-between border-b border-primary/30 pb-3 font-mono text-[10px] uppercase tracking-[0.3em] text-primary">
        <span>Paid transmission // verified</span>
        <span>Live {Math.round(progress * 100)}%</span>
      </div>
      <div className="py-8 text-center">
        <div className="mb-3 text-4xl font-black uppercase tracking-[0.18em] text-white md:text-6xl">
          Kessler Dynamics
        </div>
        <div className="font-mono text-sm uppercase tracking-[0.35em] text-accent">
          Tomorrow is already armed
        </div>
        <div className="mx-auto mt-8 h-px w-2/3 bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_18px_currentColor]" />
      </div>
      <div>
        <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Decrypting sponsor credit</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-3 border border-white/10 bg-black/60 p-0.5">
          <div
            className="h-full bg-primary shadow-[0_0_14px_currentColor] transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </UiPanel>
  );
}