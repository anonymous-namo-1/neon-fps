import { useState } from 'react';
import {
  LOADOUT_SLOTS,
  WEAPONS,
  weaponInfo,
  type RunModifierId,
  type WeaponId,
} from '@/game/contract';
import {
  isModifierUnlocked,
  isWeaponUnlocked,
  MODIFIERS,
  unlockLevelFor,
} from '@/game/progression';
import { UiButton, UiPanel } from './shared';

/**
 * Pre-run kit screen: which two weapons go into the slots, and which optional
 * handicaps are armed. Deploying from here is what actually starts the run,
 * so the button has to be a direct click handler for pointer lock to catch.
 */
export function LoadoutPanel({
  level,
  loadout,
  onLoadoutChange,
  modifiers,
  onModifiersChange,
  sectorName,
  onDeploy,
}: {
  level: number;
  loadout: WeaponId[];
  onLoadoutChange: (next: WeaponId[]) => void;
  modifiers: RunModifierId[];
  onModifiersChange: (next: RunModifierId[]) => void;
  sectorName: string;
  onDeploy: () => void;
}) {
  const [slot, setSlot] = useState(0);

  const assign = (id: WeaponId) => {
    const next = [...loadout];
    // Already carried in the other slot: swap the two rather than duplicate.
    const held = next.findIndex((w, i) => w === id && i !== slot);
    if (held >= 0) next[held] = next[slot]!;
    next[slot] = id;
    onLoadoutChange(next);
  };

  const toggleModifier = (id: RunModifierId) => {
    onModifiersChange(
      modifiers.includes(id)
        ? modifiers.filter((m) => m !== id)
        : [...modifiers, id],
    );
  };

  const scoreMul = MODIFIERS.filter((m) => modifiers.includes(m.id)).reduce(
    (total, m) => total * m.scoreMul,
    1,
  );

  return (
    <UiPanel className="p-6 h-full flex flex-col">
      <h2 className="text-2xl font-bold text-primary mb-4 border-b border-primary/30 pb-2 flex justify-between items-end">
        <span>LOADOUT</span>
        <span className="text-xs text-muted-foreground font-mono">{sectorName}</span>
      </h2>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-5">
        <div>
          <div className="text-[10px] font-mono tracking-[0.25em] text-muted-foreground mb-2">
            CARRIED WEAPONS — SELECT A SLOT, THEN A WEAPON
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: LOADOUT_SLOTS }, (_, i) => {
              const info = weaponInfo(loadout[i] ?? WEAPONS[0]!.id);
              const editing = slot === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSlot(i)}
                  data-testid={`button-slot-${i + 1}`}
                  className={`flex flex-col items-start gap-0.5 p-3 text-left clip-path-slant border transition-colors ${
                    editing
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 bg-white/5 hover:border-primary/40'
                  }`}
                >
                  <span className="text-[10px] font-mono tracking-widest text-muted-foreground">
                    SLOT {i + 1}
                  </span>
                  <span className={`font-bold tracking-wider ${editing ? 'text-primary' : 'text-white'}`}>
                    {info.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {WEAPONS.map((weapon) => {
            const unlocked = isWeaponUnlocked(level, weapon.id);
            const carried = loadout.includes(weapon.id);
            const inSlot = loadout[slot] === weapon.id;
            const requires = unlockLevelFor('weapon', weapon.id);
            return (
              <button
                key={weapon.id}
                type="button"
                disabled={!unlocked}
                onClick={() => assign(weapon.id)}
                data-testid={`button-weapon-${weapon.id}`}
                className={`flex items-center gap-3 p-3 text-left clip-path-slant border transition-colors ${
                  !unlocked
                    ? 'border-white/5 bg-black/40 cursor-not-allowed opacity-60'
                    : inSlot
                      ? 'border-primary/70 bg-primary/10'
                      : carried
                        ? 'border-primary/30 bg-primary/5 hover:border-primary/50'
                        : 'border-white/10 bg-white/5 hover:border-primary/40 hover:bg-primary/5'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className={`font-bold tracking-wider ${unlocked ? (carried ? 'text-primary' : 'text-white') : 'text-muted-foreground'}`}>
                    {weapon.name}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {unlocked ? weapon.detail : `LOCKED — REACHES LEVEL ${requires}`}
                  </div>
                </div>
                {carried && (
                  <span className="text-[10px] font-mono tracking-widest text-primary shrink-0">
                    SLOT {loadout.indexOf(weapon.id) + 1}
                  </span>
                )}
                {!unlocked && (
                  <span className="text-[10px] font-mono tracking-widest text-muted-foreground shrink-0">
                    LV {requires}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div>
          <div className="text-[10px] font-mono tracking-[0.25em] text-muted-foreground mb-2 flex justify-between">
            <span>MODIFIERS — OPTIONAL, SCORE PAYS FOR THEM</span>
            {scoreMul > 1 && (
              <span className="text-accent" data-testid="text-score-multiplier">
                x{scoreMul.toFixed(2)} SCORE
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {MODIFIERS.map((modifier) => {
              const unlocked = isModifierUnlocked(level, modifier.id);
              const armed = modifiers.includes(modifier.id);
              const requires = unlockLevelFor('modifier', modifier.id);
              return (
                <button
                  key={modifier.id}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => toggleModifier(modifier.id)}
                  data-testid={`button-modifier-${modifier.id}`}
                  className={`flex items-center gap-3 p-3 text-left clip-path-slant border transition-colors ${
                    !unlocked
                      ? 'border-white/5 bg-black/40 cursor-not-allowed opacity-60'
                      : armed
                        ? 'border-accent/70 bg-accent/10'
                        : 'border-white/10 bg-white/5 hover:border-accent/40'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold tracking-wider ${armed ? 'text-accent' : unlocked ? 'text-white' : 'text-muted-foreground'}`}>
                      {modifier.name}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {unlocked ? modifier.effect : `LOCKED — REACHES LEVEL ${requires}`}
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono tracking-widest shrink-0 ${armed ? 'text-accent' : 'text-muted-foreground'}`}>
                    {unlocked ? `x${modifier.scoreMul.toFixed(2)}` : `LV ${requires}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <UiButton onClick={onDeploy} className="w-full mt-4 py-3" testId="button-deploy">
        DEPLOY
      </UiButton>
    </UiPanel>
  );
}
