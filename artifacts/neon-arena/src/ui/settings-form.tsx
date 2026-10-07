import { GameSettings, QualityLevel } from '@/game/contract';

const QUALITY_OPTIONS: { id: QualityLevel; label: string; hint: string }[] = [
  { id: 'low', label: 'PERF', hint: 'Bloom off, half render scale. For weak machines.' },
  { id: 'medium', label: 'BALANCED', hint: 'Bloom at half strength, fewer particles.' },
  { id: 'high', label: 'MAX', hint: 'Full bloom and particle density.' },
];

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  testId: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <label className="text-sm text-muted-foreground uppercase tracking-wider font-mono">{label}</label>
        <span className="text-primary font-mono" data-testid={`text-${testId}`}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-testid={`input-${testId}`}
        className="w-full accent-primary bg-secondary h-2 appearance-none outline-none cursor-pointer"
      />
    </div>
  );
}

export function SettingsForm({
  settings,
  onSettingsChange,
}: {
  settings: GameSettings;
  onSettingsChange: (s: GameSettings) => void;
}) {
  const quality =
    QUALITY_OPTIONS.find((q) => q.id === settings.quality) ?? QUALITY_OPTIONS[2]!;

  return (
    <div className="flex flex-col gap-5 w-full max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-primary border-b border-primary/30 pb-2">SYSTEM PARAMETERS</h2>

      <Slider
        label="Sensory Gain (Sensitivity)"
        value={settings.sensitivity}
        display={`${settings.sensitivity.toFixed(2)}x`}
        min={0.2}
        max={3}
        step={0.05}
        testId="sensitivity"
        onChange={(v) => onSettingsChange({ ...settings, sensitivity: v })}
      />

      <Slider
        label="Master Output"
        value={settings.volume}
        display={`${Math.round(settings.volume * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        testId="volume"
        onChange={(v) => onSettingsChange({ ...settings, volume: v })}
      />

      <Slider
        label="Effects Output"
        value={settings.effectsVolume}
        display={`${Math.round(settings.effectsVolume * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        testId="effects-volume"
        onChange={(v) => onSettingsChange({ ...settings, effectsVolume: v })}
      />

      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground uppercase tracking-wider font-mono">Frame Rate Readout</label>
        <button
          type="button"
          onClick={() => onSettingsChange({ ...settings, showFps: !settings.showFps })}
          data-testid="button-show-fps"
          className={`w-12 h-6 border clip-path-slant flex items-center px-1 transition-colors ${settings.showFps ? 'bg-primary/20 border-primary' : 'bg-secondary border-white/20'}`}
        >
          <div className={`w-4 h-4 bg-primary transition-transform ${settings.showFps ? 'translate-x-5' : 'translate-x-0 bg-white/50'}`} />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm text-muted-foreground uppercase tracking-wider font-mono">Y-Axis Inversion</label>
        <button
          type="button"
          onClick={() => onSettingsChange({ ...settings, invertY: !settings.invertY })}
          data-testid="button-invert-y"
          className={`w-12 h-6 border clip-path-slant flex items-center px-1 transition-colors ${settings.invertY ? 'bg-primary/20 border-primary' : 'bg-secondary border-white/20'}`}
        >
          <div className={`w-4 h-4 bg-primary transition-transform ${settings.invertY ? 'translate-x-5' : 'translate-x-0 bg-white/50'}`} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-muted-foreground uppercase tracking-wider font-mono">Visual Fidelity</label>
          <div className="flex gap-2">
            {QUALITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onSettingsChange({ ...settings, quality: option.id })}
                data-testid={`button-quality-${option.id}`}
                className={`px-3 py-1 font-mono text-xs clip-path-slant border transition-colors ${settings.quality === option.id ? 'bg-primary text-black border-primary' : 'border-white/20 text-muted-foreground hover:bg-white/10'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] font-mono text-muted-foreground/80 text-right">{quality.hint}</p>
      </div>
    </div>
  );
}
