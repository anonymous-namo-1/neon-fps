import { useState } from 'react';
import { MainMenuProps } from '@/game/contract';
import { ARENAS, arenaMeta } from '@/game/arena';
import { isArenaUnlocked, unlockLevelFor } from '@/game/progression';
import { UiPanel, UiButton, GlitchHeading } from './shared';
import { SettingsForm } from './settings-form';
import { LoadoutPanel } from './loadout';
import { useListRuns } from '@workspace/api-client-react';
import { OnlineMenu } from './online-menu';
import { modeInfo } from '@/game/modes';
import { Shop } from './shop';
import { ModeSelect } from './mode-select';

type Section = 'landing' | 'play' | 'shop' | 'loadout' | 'career' | 'coop' | 'settings';

function SectionFrame({ title, onBack, children }: { title: string, onBack: () => void, children: React.ReactNode }) {
  return (
    <UiPanel className="w-full max-w-5xl mx-auto flex flex-col h-[85vh] min-h-[600px] relative z-10 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex justify-between items-center p-6 border-b border-white/10 bg-black/60 relative z-20">
        <h2 className="text-3xl font-bold font-mono tracking-[0.3em] text-primary">{title}</h2>
        <UiButton onClick={onBack} variant="outline" className="text-sm py-2">BACK</UiButton>
      </div>
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar relative z-10 bg-background/80">
        {children}
      </div>
    </UiPanel>
  );
}

export function MainMenu(props: MainMenuProps) {
  const [section, setSection] = useState<Section>('landing');
  const currentArena = arenaMeta(props.arenaId);

  return (
    <div className="absolute inset-0 bg-gradient-to-r from-background via-background/95 to-background/50 z-0 flex items-center justify-center pointer-events-auto overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-scanline pointer-events-none opacity-10" />
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-accent/10 blur-[120px] rounded-full pointer-events-none" />

      {section === 'landing' && (
        <div className="relative w-full max-w-6xl px-8 flex flex-col gap-12 items-center justify-center h-full animate-in fade-in duration-300">
           <div className="text-center">
             <h2 className="text-primary font-mono tracking-[0.4em] text-xs mb-4 opacity-80 uppercase">TACTICAL SIMULATION _ BUILD 003</h2>
             <GlitchHeading className="text-7xl md:text-9xl mb-8">NEON<br/>ARENA</GlitchHeading>
             
             <div className="inline-flex items-center gap-6 px-6 py-3 bg-black/40 border border-white/10 clip-path-slant backdrop-blur-sm">
               <div className="flex flex-col items-end border-r border-white/10 pr-6">
                 <span className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase">Operator Level</span>
                 <span className="text-2xl font-bold font-mono text-white tracking-widest">LV {props.progression.level}</span>
               </div>
               <div className="flex flex-col items-start">
                 <span className="text-[10px] text-muted-foreground font-mono tracking-widest uppercase">Wallet</span>
                 <span className="text-2xl font-bold font-mono text-accent tracking-widest">{props.store.wallet.credits.toLocaleString()} CR</span>
               </div>
             </div>
           </div>

           <div className="flex flex-col items-center gap-6 w-full max-w-4xl">
             <UiButton 
               onClick={() => props.onStart({
                 loadout: props.loadout,
                 modifiers: props.modifiers,
                 mode: props.mode,
                 huntRole: props.huntRole,
                 skin: { body: parseInt(props.store.equippedSkin || '0', 10), trim: 0 },
                 trail: props.store.equippedTrail ? parseInt(props.store.equippedTrail, 10) : null,
               })} 
               className="w-full max-w-xl text-3xl py-6 hover:scale-[1.02] transition-transform shadow-[0_0_30px_rgba(34,224,255,0.2)]" 
               testId="button-initialize-run"
             >
               DEPLOY -- {modeInfo(props.mode).name}
             </UiButton>
             
             <div className="flex flex-wrap justify-center gap-3 w-full">
               <UiButton onClick={() => setSection('play')} variant="outline" className="flex-1 min-w-[140px] text-sm">PLAY</UiButton>
               <UiButton onClick={() => setSection('shop')} variant="outline" className="flex-1 min-w-[140px] text-sm">SHOP</UiButton>
               <UiButton onClick={() => setSection('loadout')} variant="outline" className="flex-1 min-w-[140px] text-sm">LOADOUT</UiButton>
               <UiButton onClick={() => setSection('career')} variant="outline" className="flex-1 min-w-[140px] text-sm">CAREER</UiButton>
               <UiButton onClick={() => setSection('coop')} variant="outline" className="flex-1 min-w-[140px] text-sm">CO-OP</UiButton>
               <UiButton onClick={() => setSection('settings')} variant="outline" className="flex-1 min-w-[140px] text-sm">SETTINGS</UiButton>
             </div>
           </div>
        </div>
      )}
      
      {section === 'shop' && (
        <Shop 
          state={props.store} 
          onPurchase={props.onPurchase} 
          onEquip={props.onEquip} 
          onWatchAd={props.onWatchAd} 
          adState={{
            ready: props.ad.ready,
            waitMs: props.ad.waitMs,
            remaining: props.ad.remaining
          }}
          adPlaying={props.ad.playing} 
          adProgress={props.ad.progress} 
          onBack={() => setSection('landing')} 
        />
      )}

      {section !== 'landing' && section !== 'shop' && section !== 'coop' && (
        <SectionFrame title={section.toUpperCase()} onBack={() => setSection('landing')}>
          {section === 'play' && (
            <div className="flex flex-col gap-10">
              <div>
                <h3 className="text-xl font-mono text-white mb-4 tracking-widest uppercase">Target Scenario</h3>
                <ModeSelect
                  locked={props.modeLocked}
                  activeMode={props.mode} 
                  onModeChange={props.onModeChange} 
                  activeHuntRole={props.huntRole} 
                  onHuntRoleChange={props.onHuntRoleChange}
                />
              </div>

              <div>
                <h3 className="text-xl font-mono text-white mb-4 tracking-widest uppercase">Combat Sector</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ARENAS.map(a => {
                    const requires = unlockLevelFor('arena', a.id);
                    const unlocked = isArenaUnlocked(props.progression.level, a.id);
                    const active = props.arenaId === a.id;
                    
                    return (
                      <button
                        key={a.id}
                        onClick={() => unlocked && props.onArenaChange(a.id)}
                        disabled={!unlocked}
                        className={`flex flex-col gap-2 p-4 text-left transition-colors border clip-path-slant ${
                          active && unlocked ? 'border-primary bg-primary/10' :
                          unlocked ? 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/30' :
                          'border-white/5 bg-black/40 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex justify-between items-start w-full pointer-events-none">
                          <div className={`font-bold tracking-wider ${active && unlocked ? 'text-primary' : unlocked ? 'text-white' : 'text-muted-foreground'}`}>
                            {a.name}
                          </div>
                          {active && unlocked && (
                            <span className="text-[10px] font-mono tracking-widest text-primary shrink-0 bg-primary/20 px-1 py-0.5">ACTIVE</span>
                          )}
                          {!unlocked && requires && (
                            <span className="text-[10px] font-mono tracking-widest text-muted-foreground shrink-0">LV {requires}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono pointer-events-none">
                          {unlocked ? a.tagline : requires ? `LOCKED — REACHES LEVEL ${requires}` : 'LOCKED'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Launch from the screen where the choice was made, rather than
                  sending the player back to the landing page to find it. */}
              <UiButton
                onClick={() => props.onStart({
                  loadout: props.loadout,
                  modifiers: props.modifiers,
                  mode: props.mode,
                  huntRole: props.huntRole,
                  skin: { body: parseInt(props.store.equippedSkin || '0', 10), trim: 0 },
                  trail: props.store.equippedTrail ? parseInt(props.store.equippedTrail, 10) : null,
                })}
                className="w-full text-2xl py-5"
                testId="button-deploy-mode"
              >
                DEPLOY -- {modeInfo(props.mode).name}
              </UiButton>
            </div>
          )}
          {section === 'loadout' && (
             <LoadoutPanel 
               level={props.progression.level}
               loadout={props.loadout}
               onLoadoutChange={props.onLoadoutChange}
               modifiers={props.modifiers}
               onModifiersChange={props.onModifiersChange}
               sectorName={currentArena.name}
               onDeploy={() => props.onStart({
                 loadout: props.loadout,
                 modifiers: props.modifiers,
                 mode: props.mode,
                 huntRole: props.huntRole,
                 skin: { body: parseInt(props.store.equippedSkin || '0', 10), trim: 0 },
                 trail: props.store.equippedTrail ? parseInt(props.store.equippedTrail, 10) : null,
               })}
             />
          )}
          {section === 'career' && (
            <CareerSection progression={props.progression} />
          )}
          {section === 'settings' && (
            <SettingsForm settings={props.settings} onSettingsChange={props.onSettingsChange} />
          )}
        </SectionFrame>
      )}

      {section === 'coop' && (
        <OnlineMenu
          status={props.online.status}
          mode={props.online.mode}
          roomCode={props.online.roomCode}
          error={props.online.error}
          players={props.online.players}
          onCreatePrivate={props.online.createPrivate}
          onJoinPrivate={props.online.joinPrivate}
          onQuickPlay={props.online.quickPlay}
          onCancel={() => {
            props.online.cancel();
            setSection('landing');
          }}
          onDeploy={() => props.onStart({
            loadout: props.loadout,
            modifiers: props.modifiers,
            mode: props.mode,
            huntRole: props.huntRole,
            skin: { body: parseInt(props.store.equippedSkin || '0', 10), trim: 0 },
            trail: props.store.equippedTrail ? parseInt(props.store.equippedTrail, 10) : null,
          })}
          activeMode={props.mode}
          onModeChange={props.onModeChange}
          modeLocked={props.modeLocked}
          activeHuntRole={props.huntRole}
          onHuntRoleChange={props.onHuntRoleChange}
        />
      )}
    </div>
  );
}

function CareerSection({ progression }: { progression: MainMenuProps['progression'] }) {
  const xpPercent = Math.min(100, (progression.xpIntoLevel / progression.xpForLevel) * 100);
  const { data: runs, isLoading } = useListRuns({ limit: 10 });

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h3 className="text-xl font-mono text-white mb-6 tracking-widest uppercase">Operator Service Record</h3>
        <div className="p-6 border border-primary/20 bg-primary/5 clip-path-slant flex flex-col gap-4 max-w-2xl">
          <div className="flex justify-between items-baseline border-b border-primary/20 pb-4">
            <span className="text-sm text-primary font-mono tracking-widest uppercase">Operator Level</span>
            <span className="text-4xl font-bold font-mono text-white tracking-widest">{progression.level}</span>
          </div>
          <div>
            <div className="flex justify-between text-[10px] font-mono mb-2 text-muted-foreground uppercase">
              <span>{progression.xpIntoLevel.toLocaleString()} XP</span>
              <span>{progression.xpForLevel.toLocaleString()} XP</span>
            </div>
            <div className="h-2 w-full bg-black/60 border border-white/10 p-0.5">
              <div 
                className="h-full bg-primary shadow-[0_0_10px_currentColor]" 
                style={{ width: `${xpPercent}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex justify-between items-end mb-6">
          <h3 className="text-xl font-mono text-white tracking-widest uppercase">Global Archives</h3>
          <span className="text-xs text-muted-foreground font-mono uppercase">Top Operators</span>
        </div>
        
        <div className="max-w-4xl">
          {isLoading ? (
            <div className="flex justify-center items-center h-32 text-primary font-mono animate-pulse">
              ACCESSING DATABANKS...
            </div>
          ) : !runs || runs.length === 0 ? (
            <div className="flex justify-center items-center h-32 text-muted-foreground font-mono text-sm border border-white/10 bg-white/5 clip-path-slant">
              NO RECORDS FOUND. BE THE FIRST.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {runs.map((run, i) => (
                <div key={run.id} className="flex items-center gap-6 bg-white/5 p-4 border border-white/5 clip-path-slant hover:bg-primary/10 hover:border-primary/30 transition-colors">
                  <div className={`font-mono font-bold text-2xl w-8 text-center ${i === 0 ? 'text-accent' : i < 3 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-white font-bold tracking-wider text-lg">{run.callsign}</div>
                    <div className="text-xs text-muted-foreground font-mono flex gap-4 mt-1">
                      <span>WAVE {run.wave}</span>
                      <span>{run.kills} KILLS</span>
                    </div>
                  </div>
                  <div className="font-mono text-2xl text-primary font-bold text-shadow-neon">
                    {run.score.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-xl font-mono text-white mb-6 tracking-widest uppercase">Operator Manual</h3>
        <div className="bg-black/40 border border-white/10 p-6 clip-path-slant max-w-4xl">
          <div className="grid grid-cols-[120px_1fr] md:grid-cols-[120px_1fr_120px_1fr] gap-y-4 gap-x-6 font-mono text-xs leading-relaxed">
            <span className="text-primary text-right font-bold uppercase">W A S D</span><span className="text-white uppercase">Movement</span>
            <span className="text-primary text-right font-bold uppercase">Mouse</span><span className="text-white uppercase">Aim Target</span>
            <span className="text-primary text-right font-bold uppercase">L-Click</span><span className="text-white uppercase">Fire Primary</span>
            <span className="text-primary text-right font-bold uppercase">R-Click</span><span className="text-white uppercase">Aim Down Scope (Plasma charges)</span>
            <span className="text-primary text-right font-bold uppercase">Space</span><span className="text-white uppercase">Jump</span>
            <span className="text-primary text-right font-bold uppercase">Shift</span><span className="text-white uppercase">Sprint (Hold)</span>
            <span className="text-primary text-right font-bold uppercase">Q</span><span className="text-white uppercase">Dash (Requires charge)</span>
            <span className="text-primary text-right font-bold uppercase">R</span><span className="text-white uppercase">Manual Reload</span>
            <span className="text-primary text-right font-bold uppercase">1 / 2</span><span className="text-white uppercase">Equip Slot</span>
            <span className="text-primary text-right font-bold uppercase">Scroll</span><span className="text-white uppercase">Cycle Loadout</span>
            <span className="text-primary text-right font-bold uppercase">E</span><span className="text-white uppercase">Engage Overdrive (Maxed)</span>
            <span className="text-primary text-right font-bold uppercase">V</span><span className="text-white uppercase">Toggle Camera</span>
            <span className="text-primary text-right font-bold uppercase">Esc</span><span className="text-white uppercase">Suspend System</span>
          </div>
        </div>
      </section>
    </div>
  );
}
