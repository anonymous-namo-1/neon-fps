import React, { useState } from 'react';
import { ENEMY_KINDS, GameOverProps, GameSnapshot } from '@/game/contract';
import { modifierInfo } from '@/game/progression';
import { UiPanel, UiButton, GlitchHeading, StatRow } from './shared';
import { useCreateRun, getListRunsQueryKey, getGetRunStatsQueryKey, getListRecentRunsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

export function GameOver({ snapshot, reward, progression, payout, onRestart, onQuit }: GameOverProps) {
  const won = snapshot.victory;
  const [callsign, setCallsign] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const createRun = useCreateRun();

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!callsign.trim() || submitted) return;

    createRun.mutate({
      data: {
        callsign: callsign.trim().substring(0, 16).toUpperCase(),
        score: snapshot.score,
        wave: snapshot.wave,
        kills: snapshot.kills,
        accuracy: Math.round(snapshot.accuracy),
        bestCombo: snapshot.bestCombo,
        durationSeconds: Math.round(snapshot.timeSeconds),
      }
    }, {
      onSuccess: (data) => {
        setSubmitted(true);
        if (data.rank) setRank(data.rank);
        
        // Invalidate leaderboards
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRunStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRecentRunsQueryKey() });
      }
    });
  };

  const killed = ENEMY_KINDS.map((kind) => ({
    ...kind,
    count: snapshot.killsByKind[kind.id] ?? 0,
  })).filter((k) => k.count > 0);
  const mostKilled = killed.reduce((max, k) => Math.max(max, k.count), 0);

  // Each mode ends on its own note; "wave reached" means nothing in a duel.
  function victoryTitle(mode: GameSnapshot['mode']): string {
    if (mode === 'royale') return 'LAST ONE STANDING';
    if (mode === 'duel') return 'MATCH WON';
    if (mode === 'hunt') return snapshot.huntRole === 'hider' ? 'NEVER FOUND' : 'ALL HIDERS FOUND';
    return 'ARENA CLEARED';
  }

  const xpPercent = Math.min(
    100,
    (progression.xpIntoLevel / progression.xpForLevel) * 100,
  );
  const levelledUp = reward !== null && reward.levelAfter > reward.levelBefore;

  return (
    <div className="absolute inset-0 bg-black/90 z-0 flex items-start justify-center pointer-events-auto backdrop-blur-md overflow-y-auto custom-scrollbar">
      <div className="absolute inset-0 bg-scanline pointer-events-none opacity-20" />
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[300px] blur-[120px] pointer-events-none ${won ? 'bg-primary/10' : 'bg-destructive/10'}`} />

      <div className="relative w-full max-w-5xl px-8 py-10 flex flex-col items-center">
        <h2 className={`font-mono tracking-[0.4em] text-lg mb-2 ${won ? 'text-primary' : 'text-destructive'}`}>
          {won ? 'OBJECTIVE COMPLETE' : 'SYSTEM FAILURE'}
        </h2>
        <GlitchHeading
          className={`mb-8 ${won ? 'text-primary text-shadow-neon' : 'text-destructive text-shadow-neon-red'}`}
        >
          {won ? victoryTitle(snapshot.mode) : 'OPERATOR DOWN'}
        </GlitchHeading>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          {/* Run summary */}
          <div className="flex flex-col gap-6">
            <UiPanel className="p-6">
              <h3 className="text-primary font-bold text-xl mb-4 border-b border-primary/30 pb-2 flex justify-between items-end">
                <span>RUN TELEMETRY</span>
                {reward?.personalBest && (
                  <span className="text-[10px] font-mono tracking-widest text-accent" data-testid="text-personal-best">
                    NEW PERSONAL BEST
                  </span>
                )}
              </h3>
              <div className="flex flex-col gap-2">
                <StatRow label="Final Score" value={snapshot.score.toLocaleString()} highlight />
                {snapshot.mode === 'horde' && <StatRow label="Wave Reached" value={snapshot.wave} />}
                {snapshot.mode === 'royale' && <StatRow label="Rivals Left" value={snapshot.opponents} />}
                {snapshot.mode === 'duel' && (
                  <StatRow label="Rounds" value={`${snapshot.duelScore.player} - ${snapshot.duelScore.rival}`} />
                )}
                {snapshot.mode === 'hunt' && (
                  <StatRow label="Role" value={snapshot.huntRole === 'hider' ? 'HIDER' : 'SEEKER'} />
                )}
                <StatRow label="Total Kills" value={snapshot.kills} />
                <StatRow label="Best Combo" value={`${snapshot.bestCombo}x`} />
                <StatRow label="Accuracy" value={`${Math.round(snapshot.accuracy)}%`} />
                <StatRow label="Shots Fired" value={snapshot.shotsFired} />
                <StatRow label="Uptime" value={`${Math.floor(snapshot.timeSeconds / 60)}:${Math.floor(snapshot.timeSeconds % 60).toString().padStart(2, '0')}`} />
              </div>

              {snapshot.modifiers.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2" data-testid="summary-modifiers">
                  {snapshot.modifiers.map((id) => {
                    const modifier = modifierInfo(id);
                    if (!modifier) return null;
                    return (
                      <span key={id} className="text-[10px] font-mono tracking-widest uppercase text-accent border border-accent/40 bg-accent/10 px-2 py-0.5">
                        {modifier.name} x{modifier.scoreMul.toFixed(2)}
                      </span>
                    );
                  })}
                </div>
              )}
            </UiPanel>

            {payout && (
              <UiPanel className="p-6" data-testid="panel-payout">
                <h3 className="text-accent font-bold text-xl mb-4 border-b border-accent/30 pb-2 flex justify-between items-end">
                  <span>CREDITS BANKED</span>
                  <span className="text-3xl font-mono text-accent" data-testid="text-credits-earned">
                    +{payout.total.toLocaleString()}
                  </span>
                </h3>
                <div className="flex flex-col gap-1">
                  {payout.lines.filter((line) => line.amount > 0).map((line) => (
                    <div key={line.label} className="flex justify-between font-mono text-xs text-muted-foreground">
                      <span>{line.label}</span>
                      <span className="text-white/70">+{line.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
                  Spend them in the shop on guns, skins and trails.
                </p>
              </UiPanel>
            )}

            <UiPanel className="p-6">
              <h3 className="text-primary font-bold text-xl mb-4 border-b border-primary/30 pb-2">HOSTILES NEUTRALISED</h3>
              {killed.length === 0 ? (
                <p className="font-mono text-sm text-muted-foreground">NO CONFIRMED KILLS.</p>
              ) : (
                <div className="flex flex-col gap-2" data-testid="panel-kills-by-kind">
                  {killed.map((kind) => (
                    <div key={kind.id} className="flex items-center gap-3" data-testid={`row-kills-${kind.id}`}>
                      <span className="font-mono text-xs tracking-widest w-20 shrink-0" style={{ color: kind.accent }}>
                        {kind.name}
                      </span>
                      <div className="flex-1 h-2 bg-white/5">
                        <div
                          className="h-full"
                          style={{
                            width: `${(kind.count / mostKilled) * 100}%`,
                            backgroundColor: kind.accent,
                          }}
                        />
                      </div>
                      <span className="font-mono text-sm text-white w-8 text-right">{kind.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </UiPanel>
          </div>

          {/* Progression and archive */}
          <div className="flex flex-col gap-6">
            <UiPanel className="p-6" data-testid="panel-reward">
              <h3 className="text-primary font-bold text-xl mb-4 border-b border-primary/30 pb-2 flex justify-between items-end">
                <span>OPERATOR RECORD</span>
                <span className="text-xs text-muted-foreground font-mono">LEVEL {progression.level}</span>
              </h3>

              {reward && (
                <>
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-xs text-muted-foreground font-mono tracking-widest uppercase">XP Earned</span>
                    <span className="text-3xl font-mono font-bold text-accent" data-testid="text-xp-earned">
                      +{reward.xpEarned.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 mb-4">
                    {reward.breakdown.map((line) => (
                      <div key={line.label} className="flex justify-between font-mono text-xs text-muted-foreground">
                        <span>{line.label}</span>
                        <span className="text-white/70">+{line.xp.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="h-2 w-full bg-white/10">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${xpPercent}%` }} />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1">
                <span>{progression.xpIntoLevel.toLocaleString()} / {progression.xpForLevel.toLocaleString()} XP</span>
                {progression.nextUnlock && (
                  <span>NEXT: {progression.nextUnlock.name} @ LV {progression.nextUnlock.level}</span>
                )}
              </div>

              {levelledUp && (
                <div className="mt-4 p-3 border border-accent/40 bg-accent/10 clip-path-slant text-center" data-testid="text-level-up">
                  <div className="text-[10px] font-mono tracking-widest text-muted-foreground">PROMOTION</div>
                  <div className="text-lg font-bold text-accent">LEVEL {reward!.levelAfter}</div>
                </div>
              )}

              {reward && reward.unlocked.length > 0 && (
                <div className="mt-3 flex flex-col gap-2" data-testid="panel-unlocks">
                  {reward.unlocked.map((unlock) => (
                    <div key={unlock.id} className="p-3 border border-primary/40 bg-primary/10 clip-path-slant" data-testid={`row-unlock-${unlock.id}`}>
                      <div className="text-[10px] font-mono tracking-widest text-primary">
                        {unlock.kind === 'weapon' ? 'WEAPON UNLOCKED' : unlock.kind === 'arena' ? 'SECTOR UNLOCKED' : 'MODIFIER UNLOCKED'}
                      </div>
                      <div className="font-bold tracking-wider text-white">{unlock.name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{unlock.description}</div>
                    </div>
                  ))}
                </div>
              )}
            </UiPanel>

            <UiPanel className="p-6 flex flex-col justify-center border-accent/30">
              {!submitted ? (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="text-center">
                    <h3 className="text-accent font-bold text-xl mb-1">ARCHIVE RESULT</h3>
                    <p className="text-muted-foreground text-sm font-mono">Upload telemetry to global databanks.</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-white/70 font-mono tracking-wider">ENTER CALLSIGN</label>
                    <input 
                      type="text" 
                      value={callsign}
                      onChange={(e) => setCallsign(e.target.value)}
                      maxLength={16}
                      data-testid="input-callsign"
                      className="bg-black/50 border border-accent/50 p-4 text-2xl font-mono text-accent text-center uppercase focus:outline-none focus:border-accent focus:box-shadow-neon clip-path-slant transition-all placeholder:text-accent/20"
                      placeholder="GHOST"
                      autoFocus
                    />
                  </div>

                  <UiButton 
                    onClick={() => handleSubmit()} 
                    disabled={!callsign.trim() || createRun.isPending}
                    className="bg-accent/20 text-accent border-accent hover:bg-accent hover:text-black py-3"
                    testId="button-transmit"
                  >
                    {createRun.isPending ? 'UPLOADING...' : 'TRANSMIT'}
                  </UiButton>
                </form>
              ) : (
                <div className="flex flex-col items-center justify-center text-center gap-4 py-8">
                  <div className="w-16 h-16 rounded-full border-4 border-primary flex items-center justify-center text-primary mb-2">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-primary font-bold text-2xl">UPLOAD COMPLETE</h3>
                  {rank && (
                    <div className="mt-4 p-4 border border-primary/30 bg-primary/5 clip-path-slant w-full">
                      <div className="text-xs text-muted-foreground font-mono mb-1">GLOBAL RANKING</div>
                      <div className="text-4xl font-mono font-bold text-white">#{rank}</div>
                    </div>
                  )}
                </div>
              )}
            </UiPanel>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full mt-6">
          <UiButton onClick={onRestart} className="w-full" testId="button-redeploy">REDEPLOY — SAME KIT</UiButton>
          <UiButton onClick={onQuit} variant="outline" className="w-full" testId="button-disconnect">RETURN TO STAGING</UiButton>
        </div>
      </div>
    </div>
  );
}
