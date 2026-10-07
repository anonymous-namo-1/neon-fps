import React from 'react';
import { GameModeId, HuntRole } from '@/game/contract';
import { GAME_MODES, GameModeDef } from '@/game/modes';

export interface ModeCardProps {
  mode: GameModeDef;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
  children?: React.ReactNode;
}

export function ModeCard({ mode, selected, onSelect, compact, children }: ModeCardProps) {
  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      className={`group relative w-full text-left transition-colors duration-200 clip-path-slant outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black cursor-pointer ${
        selected 
          ? 'bg-black/60' 
          : 'bg-black/40 hover:bg-black/50'
      }`}
      style={{
        border: `1px solid ${selected ? mode.accent : 'rgba(255,255,255,0.1)'}`,
        boxShadow: selected ? `0 0 15px ${mode.accent}40, inset 0 0 20px ${mode.accent}20` : 'none',
      }}
    >
      <div className="absolute inset-0 bg-scanline opacity-10 pointer-events-none" />
      
      <div className={`p-4 md:p-5 flex flex-col gap-2 relative z-10`}>
        <div className="flex justify-between items-start pointer-events-none">
          <div>
            <div className="font-mono text-[10px] tracking-[0.2em] mb-1" style={{ color: mode.accent }}>
              {mode.duration.toUpperCase()}
            </div>
            <h3 className="font-bold font-mono tracking-widest text-xl text-white uppercase text-shadow-neon" style={{ textShadow: selected ? `0 0 10px ${mode.accent}` : 'none' }}>
              {mode.name}
            </h3>
          </div>
          <div className="w-4 h-4 border border-white/30 rounded-full flex items-center justify-center mt-1 shrink-0">
            {selected && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: mode.accent }} />}
          </div>
        </div>
        
        <p className="text-muted-foreground text-sm font-mono leading-relaxed mt-1 pointer-events-none">
          {mode.tagline}
        </p>
        
        {!compact && selected && (
          <div className="mt-3 pt-3 border-t border-white/10 flex flex-col gap-3 pointer-events-none">
            <p className="text-white/90 text-sm">{mode.blurb}</p>
            <ul className="flex flex-col gap-1.5">
              {mode.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground font-mono">
                  <span className="text-primary mt-0.5 opacity-70">►</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}

export interface ModeSelectProps {
  activeMode: GameModeId;
  onModeChange: (mode: GameModeId) => void;
  activeHuntRole: HuntRole;
  onHuntRoleChange: (role: HuntRole) => void;
  compact?: boolean;
  /** Set for a guest in a squad: the host owns the mode, so the cards are read-only. */
  locked?: boolean;
}

export function ModeSelect({ activeMode, onModeChange, activeHuntRole, onHuntRoleChange, compact, locked }: ModeSelectProps) {
  return (
    <div className="flex flex-col gap-3">
      {locked && (
        <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/80 border border-primary/30 bg-primary/5 px-3 py-2">
          Squad leader picks the mode
        </div>
      )}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${locked ? 'opacity-60' : ''}`}
        role="radiogroup"
        aria-label="Game Modes"
      >
      {GAME_MODES.map((mode) => (
        <ModeCard
          key={mode.id}
          mode={mode}
          selected={activeMode === mode.id}
          onSelect={() => { if (!locked) onModeChange(mode.id); }}
          compact={compact}
        >
          {compact && (
            <div className="mt-2 pt-2 border-t border-white/5 text-[10px] font-mono text-muted-foreground pointer-events-none">
              {mode.coopNote}
            </div>
          )}
          {activeMode === mode.id && mode.id === 'hunt' && (
            <div className="mt-3 pt-3 border-t border-white/10 flex gap-3">
              <button 
                type="button"
                onClick={(e) => { e.stopPropagation(); onHuntRoleChange('hider'); }}
                className={`flex-1 text-xs py-2 font-mono font-bold tracking-widest uppercase transition-colors clip-path-slant ${
                  activeHuntRole === 'hider' 
                    ? 'bg-primary/20 text-primary border border-primary' 
                    : 'bg-transparent text-white/70 border border-white/20 hover:border-white/50 hover:text-white'
                }`}
              >
                HIDER
              </button>
              <button 
                type="button"
                onClick={(e) => { e.stopPropagation(); onHuntRoleChange('seeker'); }}
                className={`flex-1 text-xs py-2 font-mono font-bold tracking-widest uppercase transition-colors clip-path-slant ${
                  activeHuntRole === 'seeker' 
                    ? 'bg-[#22e0ff]/20 text-[#22e0ff] border border-[#22e0ff]' 
                    : 'bg-transparent text-white/70 border border-white/20 hover:border-white/50 hover:text-white'
                }`}
              >
                SEEKER
              </button>
            </div>
          )}
        </ModeCard>
      ))}
      </div>
    </div>
  );
}
