import { useState, useEffect, useRef } from 'react';
import { UiPanel, UiButton, GlitchHeading } from './shared';
import { GameModeId, HuntRole } from '@/game/contract';
import { ModeSelect } from './mode-select';

export interface Player {
  id: string;
  callsign: string;
  local: boolean;
}

export interface OnlineMenuProps {
  status: 'idle' | 'connecting' | 'waiting' | 'matched' | 'error';
  mode: 'private' | 'quick' | null;
  roomCode: string | null;
  error: string | null;
  players: Player[];
  onCreatePrivate: () => void;
  onJoinPrivate: (code: string) => void;
  onQuickPlay: () => void;
  onCancel: () => void;
  onDeploy: () => void;
  activeMode: GameModeId;
  onModeChange: (id: GameModeId) => void;
  /** True while this client is a guest, so the host owns the scenario. */
  modeLocked?: boolean;
  activeHuntRole: HuntRole;
  onHuntRoleChange: (role: HuntRole) => void;
}

export function OnlineMenu({
  status,
  mode,
  roomCode,
  error,
  players,
  onCreatePrivate,
  onJoinPrivate,
  onQuickPlay,
  onCancel,
  onDeploy,
  activeMode,
  onModeChange,
  modeLocked,
  activeHuntRole,
  onHuntRoleChange,
}: OnlineMenuProps) {
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  
  const isValidCode = /^[A-Z0-9]{6}$/.test(joinCode);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="absolute inset-0 bg-background/95 z-50 flex items-center justify-center pointer-events-auto overflow-hidden backdrop-blur-md">
      <div className="absolute inset-0 bg-scanline pointer-events-none opacity-10" />
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
      
      <div className="relative w-full max-w-7xl px-8 flex flex-col lg:flex-row gap-12 items-center lg:items-stretch h-full py-16">
        {/* Left side - Context & Mode Picker */}
        <div className="flex-1 flex flex-col gap-6 max-w-lg w-full justify-center overflow-y-auto pr-4 custom-scrollbar">
           <div>
             <h2 className="text-primary font-mono tracking-[0.3em] text-sm opacity-80">TACTICAL NETWORK INTERFACE</h2>
             <GlitchHeading className="text-5xl md:text-7xl">SQUAD<br/>LINK</GlitchHeading>
             <div className="w-16 h-1 bg-primary mt-4 mb-2" />
             <p className="text-muted-foreground font-mono text-sm leading-relaxed">COORDINATED ASSAULT PROTOCOLS. SYNCHRONIZE WITH ALLIED OPERATORS FOR INCREASED SURVIVABILITY.</p>
           </div>
           
           <div className="mt-4 font-mono text-xs text-muted-foreground flex flex-col gap-2 bg-black/40 p-4 border border-white/5 clip-path-slant">
             <div className="flex justify-between border-b border-white/5 pb-2">
               <span>NETWORK STATUS:</span>
               <span className={status === 'error' ? 'text-destructive' : status !== 'idle' ? 'text-primary' : 'text-white'}>
                 {status === 'idle' ? 'STANDBY' : status === 'error' ? 'FAILURE' : 'ACTIVE'}
               </span>
             </div>
             <div className="flex justify-between border-b border-white/5 pb-2">
               <span>UPLINK ENCRYPTION:</span>
               <span className="text-white">SECURE</span>
             </div>
             <div className="flex justify-between pb-1">
                <span>RELAY LINK:</span>
                <span className="text-white">
                  {status === 'connecting'
                    ? 'SYNCING'
                    : status === 'idle' || status === 'error'
                      ? 'OFFLINE'
                      : 'LIVE'}
                </span>
             </div>
           </div>

           <div className="mt-4">
             <div className="text-primary font-mono text-sm tracking-widest mb-3 uppercase">Target Scenario</div>
             <ModeSelect 
               activeMode={activeMode} 
               onModeChange={onModeChange} 
               activeHuntRole={activeHuntRole} 
               onHuntRoleChange={onHuntRoleChange}
               compact={true}
               locked={modeLocked}
             />
           </div>
        </div>

        {/* Right side - Dynamic Flow */}
        <div className="flex-[1.5] w-full flex items-center justify-center">
           <UiPanel className="w-full max-w-lg p-10 relative overflow-hidden min-h-[450px] flex flex-col items-center justify-center shadow-2xl">
              
              {status === 'idle' && (
                <div className="flex flex-col gap-6 w-full animate-in fade-in zoom-in-95 duration-300">
                  <UiButton onClick={onQuickPlay} className="text-xl py-5" testId="button-quick-play">
                    QUICK DEPLOY
                  </UiButton>
                  
                  <div className="flex items-center gap-4 my-1 opacity-50">
                    <div className="h-px bg-white/20 flex-1" />
                    <span className="font-mono text-xs tracking-widest text-white/50">OR</span>
                    <div className="h-px bg-white/20 flex-1" />
                  </div>

                  <UiButton onClick={onCreatePrivate} variant="outline" testId="button-create-private">
                    CREATE SECURE CHANNEL
                  </UiButton>

                  <div className="bg-black/40 border border-white/10 p-5 clip-path-slant flex flex-col gap-3">
                    <div className="text-xs font-mono tracking-widest text-muted-foreground uppercase">Join Existing Channel</div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                        placeholder="ENTER 6-DIGIT CODE"
                        className="flex-1 bg-black/60 border border-white/20 text-white font-mono text-center tracking-widest uppercase focus:border-primary focus:outline-none placeholder:text-white/20"
                        maxLength={6}
                      />
                      <UiButton 
                        onClick={() => isValidCode && onJoinPrivate(joinCode)}
                        disabled={!isValidCode}
                        className="px-4"
                        testId="button-join-private"
                      >
                        JOIN
                      </UiButton>
                    </div>
                  </div>
                  
                  <UiButton onClick={onCancel} variant="outline" className="mt-4 w-full border-white/10 text-muted-foreground hover:border-white/30" testId="button-cancel-idle">
                    RETURN TO MENU
                  </UiButton>
                </div>
              )}

              {status === 'connecting' && (
                <div className="flex flex-col items-center gap-6 w-full animate-in fade-in duration-300">
                  <div className="w-16 h-16 border-[3px] border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
                  <div className="font-mono text-2xl tracking-[0.3em] text-primary animate-pulse">ESTABLISHING LINK</div>
                  <div className="text-muted-foreground font-mono text-sm tracking-widest">NEGOTIATING RELAY NODE...</div>
                  <UiButton onClick={onCancel} variant="outline" className="mt-8" testId="button-cancel-connecting">ABORT</UiButton>
                </div>
              )}

              {status === 'waiting' && (
                <div className="flex flex-col items-center gap-6 w-full animate-in fade-in duration-300">
                  <div className="w-full text-center border-b border-primary/20 pb-4 mb-2">
                    <div className="font-mono text-sm tracking-[0.3em] text-primary mb-2">CHANNEL CODE</div>
                    <div className="flex items-center justify-center gap-4">
                      <div className="font-mono text-5xl font-bold tracking-widest text-white text-shadow-neon select-all" data-testid="text-room-code">
                        {roomCode}
                      </div>
                      <button 
                        onClick={handleCopy}
                        className="w-10 h-10 border border-primary/50 bg-primary/10 flex items-center justify-center hover:bg-primary/30 transition-colors clip-path-slant group relative"
                        title="Copy to clipboard"
                      >
                        {copied ? (
                          <span className="text-primary text-xl">✓</span>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary group-hover:scale-110 transition-transform">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        )}
                        {copied && <span className="absolute -top-8 text-[10px] font-mono text-primary animate-in fade-in slide-in-from-bottom-2">COPIED</span>}
                      </button>
                    </div>
                  </div>
                  
                  <div className="w-12 h-12 border-[2px] border-primary/20 border-t-primary rounded-full animate-spin my-4" />
                  <div className="font-mono text-lg tracking-[0.2em] text-primary animate-pulse">WAITING FOR OPERATOR...</div>
                  
                  <UiButton onClick={onCancel} variant="destructive" className="mt-4 w-full" testId="button-cancel-waiting">
                    TERMINATE LINK
                  </UiButton>
                </div>
              )}

              {status === 'matched' && (
                <div className="flex flex-col items-center gap-8 w-full animate-in fade-in zoom-in-95 duration-500">
                  <div className="font-mono text-3xl tracking-[0.3em] text-primary text-shadow-neon text-center mb-2">
                    SQUAD ASSEMBLED
                  </div>
                  
                  <div className="flex flex-col gap-4 w-full">
                    {players.map((p, i) => (
                      <div key={p.id} className="border border-primary/40 bg-primary/10 p-5 clip-path-slant relative overflow-hidden">
                        <div className="absolute inset-0 bg-scanline opacity-20 pointer-events-none" />
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary/50 pointer-events-none" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary/50 pointer-events-none" />
                        
                        <div className="flex justify-between items-start mb-2">
                          <div className="text-xs font-mono text-primary/70 tracking-widest">OPERATOR {i + 1}</div>
                          {p.local && <div className="text-[10px] font-mono bg-primary text-primary-foreground px-2 py-0.5 tracking-widest font-bold">LOCAL</div>}
                        </div>
                        <div className="text-3xl font-bold font-mono text-white tracking-widest truncate" title={p.callsign}>
                          {p.callsign}
                        </div>
                        <div className="text-xs font-mono text-primary mt-3 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse shadow-[0_0_5px_currentColor]" />
                          SYNC OPTIMAL
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex gap-4 mt-6 w-full">
                    <UiButton onClick={onCancel} variant="outline" className="flex-1" testId="button-cancel-matched">
                      STAND DOWN
                    </UiButton>
                    <UiButton onClick={onDeploy} className="flex-[2] text-xl" testId="button-deploy">
                      INITIALIZE DROP
                    </UiButton>
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="flex flex-col items-center gap-8 w-full animate-in fade-in duration-300">
                  <div className="w-24 h-24 border-[4px] border-destructive rounded-full flex items-center justify-center mb-2 shadow-[0_0_30px_rgba(255,0,0,0.3)]">
                    <div className="w-3 h-12 bg-destructive rounded-sm" />
                  </div>
                  <div className="font-mono text-5xl tracking-widest text-destructive text-shadow-neon-red text-center">
                    LINK FAILED
                  </div>
                  <div className="bg-destructive/10 border border-destructive p-5 clip-path-slant text-destructive font-mono w-full text-center text-sm tracking-widest shadow-[inset_0_0_20px_rgba(255,0,0,0.1)]">
                    {error || "CONNECTION SEVERED UNEXPECTEDLY"}
                  </div>
                  <UiButton onClick={onCancel} variant="outline" className="mt-8 w-full border-white/20 hover:border-white" testId="button-cancel-error">
                    ACKNOWLEDGE
                  </UiButton>
                </div>
              )}

           </UiPanel>
        </div>
      </div>
    </div>
  );
}