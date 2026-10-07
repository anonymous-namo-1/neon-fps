import React from 'react';
import { PauseMenuProps } from '@/game/contract';
import { UiPanel, UiButton, GlitchHeading } from './shared';
import { SettingsForm } from './settings-form';

export function PauseMenu({ snapshot, settings, onSettingsChange, onResume, onRestart, onQuit }: PauseMenuProps) {
  return (
    <div className="absolute inset-0 bg-black/80 z-0 flex items-center justify-center pointer-events-auto backdrop-blur-sm">
      <div className="absolute inset-0 bg-scanline pointer-events-none opacity-20" />
      
      <div className="relative w-full max-w-4xl px-8 flex flex-col md:flex-row gap-12 items-start justify-center">
        {/* Left Col - Menu */}
        <div className="flex-1 flex flex-col gap-8 max-w-sm w-full">
          <div>
            <h2 className="text-accent font-mono tracking-[0.4em] text-sm mb-2 opacity-80">SYSTEM SUSPENDED</h2>
            <GlitchHeading className="text-4xl md:text-5xl mb-8">PAUSED</GlitchHeading>
          </div>

          <div className="flex flex-col gap-4">
            <UiButton onClick={onResume} className="py-4 text-xl">RESUME</UiButton>
            <UiButton onClick={onRestart} variant="outline" className="text-muted-foreground border-white/20 hover:text-white">RESTART RUN</UiButton>
            <UiButton onClick={onQuit} variant="destructive" className="mt-4">ABORT RUN</UiButton>
          </div>

          <div className="mt-8 pt-8 border-t border-white/10">
            <div className="grid grid-cols-2 gap-4 font-mono text-sm">
              <div className="flex flex-col">
                <span className="text-muted-foreground">WAVE</span>
                <span className="text-white text-xl">{snapshot.wave}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">SCORE</span>
                <span className="text-primary text-xl">{snapshot.score.toLocaleString()}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">KILLS</span>
                <span className="text-white text-xl">{snapshot.kills}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">TIME</span>
                <span className="text-white text-xl">{Math.floor(snapshot.timeSeconds / 60)}:{(snapshot.timeSeconds % 60).toFixed(0).padStart(2, '0')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col - Settings */}
        <div className="flex-1 w-full max-w-md">
          <UiPanel className="p-8">
            <SettingsForm settings={settings} onSettingsChange={onSettingsChange} />
          </UiPanel>
        </div>
      </div>
    </div>
  );
}
