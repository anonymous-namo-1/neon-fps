import React, { useEffect, useState } from 'react';
import { HudProps, MarkerKind } from '@/game/contract';
import { modifierInfo } from '@/game/progression';
import { motion, AnimatePresence } from 'framer-motion';

export function Hud({ snapshot, showFps = false, movementStyle = 'classic' }: HudProps) {
  // Destructure for easier access
  const {
    health, maxHealth, shield, maxShield,
    dashCharges, maxDashCharges, dashRecharge,
    weapons, activeWeapon,
    wave, enemiesRemaining, enemiesTotal, waveCountdown,
    score, combo, comboTimer, kills, timeSeconds,
    overdrive, overdriveActive, overdriveRemaining,
    markerId, markerKind, damageId, damageAngle,
    announcement, announcementSub, feed, modifiers,
    scoped, zoomLevel, fps,
    mode, objective, opponents, modeTimer, outsideZone, zoneClosing,
    duelScore, duelRound, huntRole, detection, hidersLeft, rivals,
    boostFuel, sliding,
  } = snapshot;

  const clock = `${Math.floor(modeTimer / 60)}:${Math.floor(modeTimer % 60).toString().padStart(2, '0')}`;

  const currentWeapon = weapons.find(w => w.id === activeWeapon);

  // Health and Shield percentages
  const hpPct = Math.max(0, health / maxHealth);
  const shPct = Math.max(0, shield / maxShield);
  
  // Is health critically low?
  const isCritical = health > 0 && hpPct < 0.25;

  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden font-mono select-none">
      
      {/* Low Health Screen Effect */}
      <AnimatePresence>
        {isCritical && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.1, 0.4, 0.1] }}
            transition={{ repeat: Infinity, duration: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 shadow-[inset_0_0_150px_rgba(255,0,0,0.8)] pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Overdrive Screen Effect */}
      <AnimatePresence>
        {overdriveActive && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.05, 0.15, 0.05] }}
            transition={{ repeat: Infinity, duration: 0.5 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-primary pointer-events-none mix-blend-overlay"
          />
        )}
      </AnimatePresence>

      {/* Outside the collapsing grid: the one warning that has to beat the
          rest of the HUD for attention, because it is a timer on your life. */}
      <AnimatePresence>
        {outsideZone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.25, 0.6, 0.25] }}
            transition={{ repeat: Infinity, duration: 0.9 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 shadow-[inset_0_0_180px_rgba(255,61,113,0.9)] pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Top Left: Run Info */}
      <div className="absolute top-6 left-8 flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold text-white font-sans tracking-widest text-shadow-neon">
            {mode === 'horde' ? `WAVE ${wave}` : mode === 'duel' ? `ROUND ${duelRound}` : clock}
          </span>
          {mode === 'horde' && waveCountdown > 0 && (
            <span className="text-primary font-bold">NEXT IN {Math.ceil(waveCountdown)}s</span>
          )}
          {mode === 'duel' && (
            <span className="text-primary font-bold text-2xl">{duelScore.player} - {duelScore.rival}</span>
          )}
          {mode === 'royale' && (
            <span className="text-primary font-bold">{opponents} RIVALS LEFT</span>
          )}
          {mode === 'hunt' && huntRole === 'seeker' && (
            <span className="text-primary font-bold">{hidersLeft} HIDING</span>
          )}
        </div>

        {objective && (
          <span className={`text-xs tracking-[0.3em] uppercase ${outsideZone ? 'text-destructive animate-pulse' : zoneClosing ? 'text-accent' : 'text-white/50'}`}>
            {outsideZone ? 'RETURN TO THE GRID' : objective}
          </span>
        )}

        {/* Blackout hiders live and die by this meter, so it sits with the
            objective rather than in the corner with the run stats. */}
        {mode === 'hunt' && huntRole === 'hider' && (
          <div className="w-56 flex flex-col gap-1">
            <div className="flex justify-between text-[10px] tracking-widest uppercase">
              <span className={detection > 0.65 ? 'text-destructive animate-pulse' : 'text-muted-foreground'}>DETECTION</span>
              <span className="text-white/60">{Math.round(detection * 100)}%</span>
            </div>
            <div className="w-full h-2 bg-black/50 border border-white/20 clip-path-slant overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${detection > 0.65 ? 'bg-destructive' : 'bg-accent'}`}
                style={{ width: `${detection * 100}%` }}
              />
            </div>
          </div>
        )}
        
        {/* Online only. Without a bar per rival there is no way to tell a shot
            that landed from a shot that missed, which reads as "damage is
            broken" even when it is working. */}
        {rivals.length > 0 && (
          <div className="flex flex-col gap-1 bg-black/40 backdrop-blur-md px-3 py-2 border border-white/10 clip-path-slant w-56">
            {rivals.map((rival) => (
              <div key={rival.callsign} className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] tracking-widest uppercase">
                  <span className={rival.hostile ? 'text-destructive' : 'text-accent'}>
                    {rival.hostile ? '' : '+ '}{rival.callsign}
                  </span>
                  <span className="text-white/60">
                    {rival.dead ? 'DOWN' : `${Math.round((rival.health / rival.maxHealth) * 100)}%`}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-black/50 border border-white/20 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-100 ${rival.hostile ? 'bg-destructive' : 'bg-accent'}`}
                    style={{ width: `${rival.dead ? 0 : Math.max(0, (rival.health / rival.maxHealth) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-4 items-center bg-black/40 backdrop-blur-md p-2 border border-white/10 clip-path-slant w-fit max-w-[380px]">
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">ENEMIES</span>
            <div className="flex items-end gap-1">
              <span className="text-xl font-bold text-white leading-none">{enemiesRemaining}</span>
              <span className="text-xs text-white/50 mb-0.5">/ {enemiesTotal}</span>
            </div>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">SCORE</span>
            <span className="text-xl font-bold text-primary leading-none text-shadow-neon">{score.toLocaleString()}</span>
          </div>
          <div className="w-px h-8 bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">TIME</span>
            <span className="text-xl font-bold text-white/80 leading-none">
              {Math.floor(timeSeconds / 60)}:{(timeSeconds % 60).toFixed(0).padStart(2, '0')}
            </span>
          </div>
          {/* Lives in this panel rather than a corner of its own: the kill
              feed owns the top right and would cover a chip parked there. */}
          {showFps && (
            <>
              <div className="w-px h-8 bg-white/10" />
              <div className="flex flex-col" data-testid="hud-fps">
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">FPS</span>
                <span
                  className={`text-xl font-bold leading-none ${
                    fps >= 50 ? 'text-primary' : fps >= 30 ? 'text-yellow-400' : 'text-red-400'
                  }`}
                >
                  {fps}
                </span>
              </div>
            </>
          )}
        </div>

        {modifiers.length > 0 && (
          <div className="flex gap-2 flex-wrap max-w-[300px]" data-testid="hud-modifiers">
            {modifiers.map((id) => {
              const modifier = modifierInfo(id);
              if (!modifier) return null;
              return (
                <span
                  key={id}
                  className="text-[10px] tracking-widest uppercase text-accent border border-accent/40 bg-accent/10 px-2 py-0.5"
                >
                  {modifier.name}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Top Center: Combo Meter */}
      {combo > 1 && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
          <div className="text-3xl font-bold font-sans italic text-accent tracking-widest drop-shadow-[0_0_8px_rgba(255,165,0,0.8)]">
            {combo}x COMBO
          </div>
          <div className="w-48 h-1.5 bg-black/50 overflow-hidden">
            <div 
              className="h-full bg-accent origin-left"
              style={{ width: `${comboTimer * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Top Right: Kill Feed */}
      <div className="absolute top-6 right-8 flex flex-col gap-1 items-end w-64">
        <AnimatePresence>
          {feed.map((entry) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className={`text-sm px-2 py-0.5 border-r-2 bg-black/40 backdrop-blur-sm truncate w-full text-right ${
                entry.tone === 'kill' ? 'text-white border-white/50' :
                entry.tone === 'crit' ? 'text-accent border-accent' :
                entry.tone === 'warn' ? 'text-destructive border-destructive' :
                entry.tone === 'wave' ? 'text-primary border-primary font-bold' :
                'text-purple-400 border-purple-400'
              }`}
            >
              {entry.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Bottom Left: Health & Armor */}
      <div className="absolute bottom-8 left-8 flex flex-col gap-2 w-80">
        
        {/* Shield Bar */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-end">
            <span className="text-xs text-primary font-bold tracking-widest uppercase">OVERSHIELD</span>
            <span className="text-sm font-bold text-primary">{Math.ceil(shield)}</span>
          </div>
          <div className="w-full h-3 bg-black/50 border border-primary/30 p-0.5 clip-path-slant relative">
            <div 
              className="h-full bg-primary/80 transition-all duration-75"
              style={{ width: `${shPct * 100}%` }}
            />
          </div>
        </div>

        {/* Health Bar */}
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex justify-between items-end">
            <span className={`text-xs font-bold tracking-widest uppercase ${isCritical ? 'text-destructive animate-pulse' : 'text-white'}`}>INTEGRITY</span>
            <span className={`text-2xl font-bold leading-none ${isCritical ? 'text-destructive text-shadow-neon-red' : 'text-white'}`}>{Math.ceil(health)}</span>
          </div>
          <div className={`w-full h-6 bg-black/50 border p-0.5 clip-path-slant ${isCritical ? 'border-destructive' : 'border-white/30'}`}>
            <div 
              className={`h-full transition-all duration-75 ${isCritical ? 'bg-destructive' : 'bg-white'}`}
              style={{ width: `${hpPct * 100}%` }}
            />
          </div>
        </div>

        {/* Mobility: dash charges, or the boost tank when the player has
            chosen slide & boost. Same slot, because it is the same question --
            how much movement do I have banked right now. */}
        {movementStyle === 'slide' ? (
          <div className="flex flex-col gap-1 mt-2">
            <div className="flex justify-between text-[10px] tracking-widest uppercase">
              <span className={sliding ? 'text-accent' : 'text-muted-foreground'}>
                {sliding ? 'SLIDING' : 'BOOST'}
              </span>
              <span className="text-white/50">{Math.round(boostFuel * 100)}%</span>
            </div>
            <div className="w-full h-2 bg-black/50 border border-white/20 clip-path-slant overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${boostFuel < 0.25 ? 'bg-destructive' : 'bg-accent'}`}
                style={{ width: `${boostFuel * 100}%` }}
              />
            </div>
          </div>
        ) : (
        <div className="flex gap-2 mt-2">
          {Array.from({ length: maxDashCharges }).map((_, i) => {
            const isAvailable = i < dashCharges;
            const isRecharging = i === dashCharges;
            return (
              <div key={i} className="flex-1 h-2 bg-black/50 border border-white/20 clip-path-slant relative overflow-hidden">
                {isAvailable && <div className="absolute inset-0 bg-primary" />}
                {isRecharging && (
                  <div 
                    className="absolute top-0 left-0 bottom-0 bg-primary/40"
                    style={{ width: `${dashRecharge * 100}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Bottom Right: Weapon & Overdrive */}
      <div className="absolute bottom-8 right-8 flex flex-col gap-4 w-80 items-end text-right">
        
        {/* Overdrive Meter */}
        <div className="w-full flex flex-col gap-1">
          <div className="flex justify-between items-end">
            <span className={`text-sm font-bold ${overdriveActive || overdrive >= 1 ? 'text-accent animate-pulse' : 'text-accent'}`}>
              {overdriveActive ? 'OVERDRIVE ACTIVE' : overdrive >= 1 ? 'OVERDRIVE READY [E]' : 'OVERDRIVE'}
            </span>
            <span className="text-xs text-accent/70">{Math.floor(overdrive * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-black/50 border border-accent/30 clip-path-slant-reverse overflow-hidden p-0.5">
            <div 
              className={`h-full bg-accent transition-all duration-75 ${overdriveActive ? 'opacity-100' : ''}`}
              style={{ width: `${overdriveActive ? overdriveRemaining * 100 : overdrive * 100}%` }}
            />
          </div>
        </div>

        {/* Active Weapon */}
        {currentWeapon && (
          <div className="bg-black/60 backdrop-blur-md p-4 border-r-4 border-primary clip-path-slant-reverse flex flex-col items-end min-w-[250px]">
            <div className="text-primary font-bold font-sans tracking-[0.2em] text-xl mb-1 text-shadow-neon">{currentWeapon.name}</div>
            
            <div className="flex items-end gap-2 mb-2">
              <span className={`text-5xl font-bold leading-none ${currentWeapon.ammo === 0 ? 'text-destructive' : 'text-white'}`}>
                {currentWeapon.ammo}
              </span>
              <span className="text-xl text-white/40 leading-none mb-1">/ {currentWeapon.magazine}</span>
            </div>

            {/* Reloading Bar */}
            {currentWeapon.reloading ? (
              <div className="w-full h-1.5 bg-black/80 mt-1 relative">
                <div 
                  className="absolute top-0 right-0 bottom-0 bg-white"
                  style={{ width: `${currentWeapon.reloadProgress * 100}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-black mix-blend-difference z-10">RELOADING</div>
              </div>
            ) : currentWeapon.chargeable ? (
              /* Charge Bar */
              <div className="w-full h-1.5 bg-black/80 mt-1 relative">
                <div 
                  className="absolute top-0 right-0 bottom-0 bg-primary"
                  style={{ width: `${currentWeapon.charge * 100}%` }}
                />
              </div>
            ) : (
              <div className="w-full h-1.5 bg-transparent mt-1" /> /* Spacer */
            )}
          </div>
        )}
        
        {/* Inactive Weapons */}
        <div className="flex gap-2">
          {weapons.filter(w => w.id !== activeWeapon).map(w => (
            <div key={w.id} className="px-3 py-1 bg-black/40 border border-white/10 text-xs text-white/40 clip-path-slant-reverse">
              {w.name}
            </div>
          ))}
        </div>
      </div>

      {/* Scope Vignette */}
      <AnimatePresence>
        {scoped && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 pointer-events-none shadow-[inset_0_0_220px_90px_rgba(0,0,0,0.85)]"
          />
        )}
      </AnimatePresence>

      {/* Center Screen: Crosshair & Markers */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 flex items-center justify-center">
        
        {/* Simple dot crosshair */}
        <div className="w-1.5 h-1.5 bg-white rounded-full opacity-80 mix-blend-difference" />

        {/* Scope reticle */}
        {scoped && (
          <>
            <div className="absolute w-16 h-16 rounded-full border border-white/70" />
            <div className="absolute w-28 h-px bg-white/40" />
            <div className="absolute h-28 w-px bg-white/40" />
            <span className="absolute top-[63%] text-[10px] text-white/80 tracking-[0.3em]">
              {zoomLevel.toFixed(1)}X
            </span>
          </>
        )}

        {/* Hit Markers */}
        <HitMarker markerId={markerId} kind={markerKind} />

        {/* Damage Indicator */}
        <DamageIndicator damageId={damageId} angle={damageAngle} />
        
      </div>

      {/* Center Announcements */}
      <AnimatePresence>
        {announcement && (
          <motion.div 
            key={announcement}
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(10px)" }}
            transition={{ duration: 0.3 }}
            className="absolute top-[30%] left-1/2 -translate-x-1/2 flex flex-col items-center text-center"
          >
            <h1 className="text-6xl md:text-8xl font-sans font-bold uppercase tracking-[0.2em] text-white text-shadow-neon">
              {announcement}
            </h1>
            {announcementSub && (
              <p className="text-xl text-primary font-mono tracking-widest mt-2 bg-black/50 px-4 py-1 border border-primary/30">
                {announcementSub}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

// Separate component to handle animation remounts based on ID
function HitMarker({ markerId, kind }: { markerId: number, kind: MarkerKind }) {
  const [markers, setMarkers] = useState<{id: number, kind: MarkerKind}[]>([]);

  useEffect(() => {
    if (markerId > 0) {
      setMarkers(prev => [...prev, { id: markerId, kind }]);
      // Clean up after animation duration
      setTimeout(() => {
        setMarkers(prev => prev.filter(m => m.id !== markerId));
      }, 300);
    }
  }, [markerId, kind]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {markers.map(m => (
        <motion.div
          key={m.id}
          initial={{ opacity: 1, scale: 0.5 }}
          animate={{ opacity: 0, scale: 1.5 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {/* X shape for hit marker */}
          <div className="relative w-8 h-8">
            <div className={`absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 ${m.kind === 'kill' ? 'border-destructive' : m.kind === 'crit' ? 'border-accent' : 'border-white'}`} />
            <div className={`absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 ${m.kind === 'kill' ? 'border-destructive' : m.kind === 'crit' ? 'border-accent' : 'border-white'}`} />
            <div className={`absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 ${m.kind === 'kill' ? 'border-destructive' : m.kind === 'crit' ? 'border-accent' : 'border-white'}`} />
            <div className={`absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 ${m.kind === 'kill' ? 'border-destructive' : m.kind === 'crit' ? 'border-accent' : 'border-white'}`} />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function DamageIndicator({ damageId, angle }: { damageId: number, angle: number }) {
  const [indicators, setIndicators] = useState<{id: number, angle: number}[]>([]);

  useEffect(() => {
    if (damageId > 0) {
      setIndicators(prev => [...prev, { id: damageId, angle }]);
      setTimeout(() => {
        setIndicators(prev => prev.filter(m => m.id !== damageId));
      }, 1000);
    }
  }, [damageId, angle]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {indicators.map(ind => (
        <motion.div
          key={ind.id}
          initial={{ opacity: 0.8, scale: 0.8 }}
          animate={{ opacity: 0, scale: 1.2 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `rotate(${ind.angle}rad)` }}
        >
          {/* Arrow pointing OUTWARDS from center towards the damage source. 
              Angle 0 is straight ahead, which means the indicator should show AT THE TOP of the screen (y-negative).
              So rotate(0) means arrow at the top. */}
          <div className="absolute -top-32 w-16 h-8 text-destructive">
            <svg viewBox="0 0 100 50" fill="currentColor" className="w-full h-full drop-shadow-[0_0_10px_rgba(255,0,0,0.8)]">
              <path d="M0,50 L50,0 L100,50 Z" />
            </svg>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
