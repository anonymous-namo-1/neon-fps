import React from 'react';
import { IntermissionProps } from '@/game/contract';
import { UiPanel, UiButton, GlitchHeading } from './shared';

const FAMILY_COLORS = {
  offense: 'text-destructive border-destructive',
  defense: 'text-primary border-primary',
  mobility: 'text-accent border-accent',
  utility: 'text-purple-400 border-purple-400',
};

const TIER_STARS = {
  common: '★',
  rare: '★★',
  elite: '★★★',
};

export function Intermission({ snapshot, onChoose }: IntermissionProps) {
  return (
    <div className="absolute inset-0 bg-background/95 z-0 flex items-center justify-center pointer-events-auto backdrop-blur-md">
      <div className="absolute inset-0 bg-scanline pointer-events-none opacity-20" />
      
      <div className="relative w-full max-w-6xl px-8 flex flex-col items-center h-full py-16">
        <div className="text-center mb-12">
          <h2 className="text-primary font-mono tracking-[0.4em] text-lg mb-2">WAVE {snapshot.wave - 1} CLEARED</h2>
          <GlitchHeading className="text-white text-4xl md:text-6xl mb-2">SYSTEM UPGRADE</GlitchHeading>
          <p className="text-muted-foreground font-mono text-sm mt-4">SELECT ONE COMPONENT TO INTEGRATE</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl flex-1 max-h-[400px]">
          {snapshot.upgradeChoices.map((opt) => {
            const colors = FAMILY_COLORS[opt.family];
            const isElite = opt.tier === 'elite';
            
            return (
              <button 
                key={opt.id}
                onClick={() => onChoose(opt.id)}
                className={`group relative text-left transition-all duration-300 transform hover:scale-105 hover:-translate-y-2 focus:outline-none`}
              >
                <div className={`absolute inset-0 ${colors.split(' ')[1]} border-2 opacity-20 clip-path-slant transition-opacity group-hover:opacity-100 ${isElite ? 'animate-pulse' : ''}`} />
                <div className={`absolute inset-0 bg-gradient-to-b from-transparent to-black/80 clip-path-slant`} />
                
                <div className={`h-full flex flex-col p-6 border border-white/10 clip-path-slant bg-black/40 backdrop-blur-sm group-hover:border-white/50 transition-colors relative z-10`}>
                  <div className="flex justify-between items-start mb-4">
                    <span className={`text-xs font-mono font-bold tracking-widest uppercase ${colors.split(' ')[0]}`}>
                      {opt.family}
                    </span>
                    <span className={`text-xs font-mono tracking-widest ${isElite ? 'text-accent' : 'text-white/50'}`}>
                      {TIER_STARS[opt.tier]}
                    </span>
                  </div>
                  
                  <h3 className="text-2xl font-bold uppercase tracking-wider text-white mb-2 group-hover:text-shadow-neon transition-all">
                    {opt.name}
                  </h3>
                  
                  <p className="text-sm text-white/60 font-mono mb-6 italic h-10">
                    "{opt.tagline}"
                  </p>
                  
                  <div className="mt-auto bg-black/50 p-4 border-l-2 border-white/20 group-hover:border-white transition-colors">
                    <p className="font-mono text-sm text-primary font-bold">
                      {opt.effect}
                    </p>
                  </div>
                  
                  {opt.stacks > 0 && (
                    <div className="absolute top-0 right-0 transform translate-x-2 -translate-y-2 w-8 h-8 bg-black border border-white flex items-center justify-center rounded-full font-mono text-xs font-bold z-20 text-white">
                      +{opt.stacks}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Owned Upgrades Log */}
        <div className="mt-auto w-full max-w-4xl pt-8 border-t border-white/10">
          <h4 className="text-xs text-muted-foreground font-mono tracking-widest uppercase mb-4 text-center">INTEGRATED COMPONENTS</h4>
          <div className="flex flex-wrap gap-2 justify-center">
            {snapshot.ownedUpgrades.length === 0 ? (
              <span className="text-white/20 font-mono text-sm">NO COMPONENTS INSTALLED</span>
            ) : (
              snapshot.ownedUpgrades.map((up, i) => (
                <div key={i} className="px-3 py-1 bg-white/5 border border-white/10 text-xs font-mono text-white/70 clip-path-slant flex items-center gap-2">
                  <span className={FAMILY_COLORS[up.family].split(' ')[0]}>■</span>
                  {up.name}
                  {up.stacks > 1 && <span className="text-primary ml-1">x{up.stacks}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
