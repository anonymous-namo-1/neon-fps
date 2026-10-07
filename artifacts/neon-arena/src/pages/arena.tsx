import { useGame } from '@/game/use-game';
import { GameOver } from '@/ui/game-over';
import { Hud } from '@/ui/hud';
import { Intermission } from '@/ui/intermission';
import { MainMenu } from '@/ui/main-menu';
import { PauseMenu } from '@/ui/pause-menu';

export default function Arena() {
  const {
    canvasRef,
    snapshot,
    settings,
    setSettings,
    personalBest,
    progression,
    lastReward,
    lastPayout,
    loadout,
    setLoadout,
    modifiers,
    setModifiers,
    mode,
    setMode,
    modeLocked,
    huntRole,
    setHuntRole,
    store,
    purchase,
    equip,
    watchAd,
    adState,
    multiplayer,
    actions,
    error,
  } = useGame();

  const { phase } = snapshot;
  const inRun =
    phase === 'playing' || phase === 'paused' || phase === 'intermission';

  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full touch-none outline-none"
        data-testid="canvas-arena"
      />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-md border border-destructive/50 bg-black/80 p-8 text-center">
            <h1 className="mb-3 text-2xl font-bold tracking-widest text-destructive">
              RENDERER OFFLINE
            </h1>
            <p className="font-mono text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {!error && inRun && (
        <Hud
          snapshot={snapshot}
          showFps={settings.showFps}
          movementStyle={settings.movementStyle}
        />
      )}

      {!error && phase === 'menu' && (
        <MainMenu
          onStart={actions.start}
          settings={settings}
          onSettingsChange={setSettings}
          personalBest={personalBest}
          arenaId={snapshot.arenaId}
          onArenaChange={actions.setArena}
          progression={progression}
          loadout={loadout}
          onLoadoutChange={setLoadout}
          modifiers={modifiers}
          onModifiersChange={setModifiers}
          mode={mode}
          onModeChange={setMode}
          modeLocked={modeLocked}
          huntRole={huntRole}
          onHuntRoleChange={setHuntRole}
          store={store}
          onPurchase={purchase}
          onEquip={equip}
          onWatchAd={watchAd}
          ad={adState}
          online={multiplayer}
        />
      )}

      {phase === 'intermission' && (
        <Intermission snapshot={snapshot} onChoose={actions.chooseUpgrade} />
      )}

      {phase === 'paused' && (
        <PauseMenu
          snapshot={snapshot}
          settings={settings}
          onSettingsChange={setSettings}
          onResume={actions.resume}
          onRestart={actions.restart}
          onQuit={actions.quit}
        />
      )}

      {phase === 'dead' && (
        <GameOver
          snapshot={snapshot}
          reward={lastReward}
          progression={progression}
          payout={lastPayout}
          onRestart={actions.restart}
          onQuit={actions.quit}
        />
      )}
    </div>
  );
}
