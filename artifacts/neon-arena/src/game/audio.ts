/**
 * Fully procedural WebAudio sound design. No audio files are downloaded --
 * every shot, impact and layer of the ambient bed is synthesised at runtime,
 * which keeps the game a single fast-loading bundle.
 */

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private droneOscs: OscillatorNode[] = [];
  private droneFilter: BiquadFilterNode | null = null;
  private pulseTimer: number | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;

  private volume = 0.7;
  /** Weapon and impact level, relative to master. */
  private effectsVolume = 0.85;
  private intensity = 0;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.effectsVolume;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.0;
      this.musicBus.connect(this.master);

      this.noise = this.makeNoise(this.ctx);
    }
    void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Level of everything except the ambient bed, so the player can keep the
   * music while pulling gunfire down.
   */
  setEffectsVolume(v: number): void {
    this.effectsVolume = v;
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    }
  }

  dispose(): void {
    this.stopAmbient();
    this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
  }

  private makeNoise(ctx: Ctx): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Short burst of filtered noise. */
  private burst(
    when: number,
    duration: number,
    gain: number,
    type: BiquadFilterType,
    freqFrom: number,
    freqTo: number,
    q = 1,
  ): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.noise) return;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freqFrom, when);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(20, freqTo),
      when + duration,
    );

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    src.connect(filter).connect(env).connect(bus);
    src.start(when);
    src.stop(when + duration + 0.02);
  }

  /** Pitched tone with an exponential frequency sweep. */
  private tone(
    when: number,
    duration: number,
    gain: number,
    type: OscillatorType,
    freqFrom: number,
    freqTo: number,
    detune = 0,
  ): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freqFrom, when);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, freqTo),
      when + duration,
    );

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    osc.connect(env).connect(bus);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  /* ----------------------------- weapons ----------------------------- */

  pulseShot(overdrive: boolean): void {
    const t = this.now();
    this.burst(t, 0.075, 0.28, 'bandpass', 2600, 700, 1.4);
    this.tone(t, 0.09, 0.2, 'square', overdrive ? 320 : 240, 70);
    this.tone(t, 0.05, 0.09, 'sawtooth', 1400, 500);
  }

  plasmaShot(charge: number): void {
    const t = this.now();
    const power = 0.5 + charge;
    this.tone(t, 0.34 * power, 0.3, 'sawtooth', 420 * (1 + charge), 60);
    this.tone(t, 0.28 * power, 0.16, 'square', 180, 40);
    this.burst(t, 0.22, 0.2, 'lowpass', 3200, 300, 0.7);
  }

  startCharge(): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.chargeOsc) return;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.1);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(400, ctx.currentTime);

    osc.connect(filter).connect(gain).connect(bus);
    osc.start();
    this.chargeOsc = osc;
    this.chargeGain = gain;
  }

  updateCharge(amount: number): void {
    if (!this.ctx || !this.chargeOsc) return;
    this.chargeOsc.frequency.setTargetAtTime(
      120 + amount * 520,
      this.ctx.currentTime,
      0.05,
    );
  }

  stopCharge(): void {
    const ctx = this.ctx;
    if (!ctx || !this.chargeOsc || !this.chargeGain) return;
    const osc = this.chargeOsc;
    this.chargeGain.gain.cancelScheduledValues(ctx.currentTime);
    this.chargeGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
    osc.stop(ctx.currentTime + 0.12);
    this.chargeOsc = null;
    this.chargeGain = null;
  }

  reload(): void {
    const t = this.now();
    this.burst(t, 0.05, 0.16, 'highpass', 1800, 900, 1);
    this.burst(t + 0.16, 0.06, 0.18, 'bandpass', 1200, 500, 2);
    this.tone(t + 0.3, 0.07, 0.1, 'square', 500, 220);
  }

  dryFire(): void {
    this.burst(this.now(), 0.04, 0.12, 'highpass', 3000, 1600, 2);
  }

  /* ----------------------------- feedback ---------------------------- */

  hit(crit: boolean): void {
    const t = this.now();
    if (crit) {
      this.tone(t, 0.1, 0.22, 'square', 1500, 900);
      this.tone(t + 0.02, 0.12, 0.14, 'sine', 2400, 1600);
    } else {
      this.tone(t, 0.055, 0.13, 'square', 900, 620);
    }
  }

  kill(): void {
    const t = this.now();
    this.tone(t, 0.1, 0.16, 'square', 780, 520);
    this.tone(t + 0.05, 0.14, 0.13, 'square', 1040, 700);
    this.burst(t, 0.18, 0.14, 'lowpass', 2400, 200, 0.8);
  }

  explode(scale: number): void {
    const t = this.now();
    this.burst(t, 0.45 * scale, 0.34, 'lowpass', 1800, 90, 0.9);
    this.tone(t, 0.4 * scale, 0.2, 'sine', 160, 32);
  }

  hurt(): void {
    const t = this.now();
    this.burst(t, 0.22, 0.26, 'lowpass', 900, 120, 1.2);
    this.tone(t, 0.18, 0.18, 'sawtooth', 190, 60);
  }

  shieldBreak(): void {
    const t = this.now();
    this.tone(t, 0.3, 0.16, 'triangle', 1300, 240);
    this.burst(t, 0.25, 0.16, 'highpass', 3000, 900, 1.5);
  }

  dash(): void {
    const t = this.now();
    this.burst(t, 0.26, 0.2, 'bandpass', 500, 3800, 1.1);
    this.tone(t, 0.16, 0.09, 'sine', 420, 900);
  }

  jump(): void {
    this.burst(this.now(), 0.09, 0.07, 'highpass', 900, 2200, 1);
  }

  land(): void {
    this.burst(this.now(), 0.1, 0.1, 'lowpass', 700, 140, 1);
  }

  enemyShot(): void {
    const t = this.now();
    this.tone(t, 0.16, 0.1, 'triangle', 700, 220);
    this.burst(t, 0.1, 0.07, 'bandpass', 1600, 600, 3);
  }

  enemySpawn(): void {
    const t = this.now();
    this.tone(t, 0.5, 0.09, 'sine', 90, 300);
    this.burst(t + 0.25, 0.25, 0.08, 'bandpass', 400, 2200, 2);
  }

  /* ----------------------------- moments ----------------------------- */

  waveStart(wave: number): void {
    const t = this.now();
    const root = 110 * Math.pow(2, ((wave - 1) % 5) / 12);
    [1, 1.5, 2, 3].forEach((mult, i) => {
      this.tone(t + i * 0.09, 0.7, 0.11, 'sawtooth', root * mult, root * mult);
    });
    this.burst(t, 0.9, 0.1, 'lowpass', 300, 2600, 0.7);
  }

  waveClear(): void {
    const t = this.now();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(t + i * 0.07, 0.45, 0.13, 'triangle', f, f);
    });
  }

  upgradePick(): void {
    const t = this.now();
    [660, 880, 1320].forEach((f, i) => {
      this.tone(t + i * 0.05, 0.3, 0.12, 'square', f, f * 1.01);
    });
  }

  overdriveStart(): void {
    const t = this.now();
    this.tone(t, 1.1, 0.24, 'sawtooth', 80, 700);
    this.burst(t, 1.1, 0.18, 'bandpass', 300, 5000, 1.4);
    this.tone(t + 0.5, 0.9, 0.16, 'square', 220, 440);
  }

  overdriveEnd(): void {
    this.tone(this.now(), 0.7, 0.16, 'sawtooth', 520, 90);
  }

  gameOver(): void {
    const t = this.now();
    this.tone(t, 2.2, 0.22, 'sawtooth', 220, 34);
    this.tone(t + 0.2, 2.0, 0.14, 'square', 165, 28);
    this.burst(t, 1.6, 0.14, 'lowpass', 1200, 60, 0.8);
  }

  /* ----------------------------- ambient ----------------------------- */

  startAmbient(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || this.droneOscs.length > 0) return;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 2;
    filter.connect(bus);
    this.droneFilter = filter;

    [55, 55.4, 82.5, 110.2].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.16 / (i + 1);
      osc.connect(g).connect(filter);
      osc.start();
      this.droneOscs.push(osc);
    });

    bus.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5);

    // A slow heartbeat that speeds up as waves get harder.
    const beat = () => {
      if (!this.ctx || !this.musicBus) return;
      const t = this.ctx.currentTime;
      this.tone(t, 0.3, 0.06 + this.intensity * 0.07, 'sine', 62, 40);
      const interval = 1.35 - this.intensity * 0.65;
      this.pulseTimer = window.setTimeout(beat, interval * 1000);
    };
    beat();
  }

  /** 0 = calm, 1 = frantic. Drives filter brightness and heartbeat rate. */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
    if (this.droneFilter && this.ctx) {
      this.droneFilter.frequency.setTargetAtTime(
        380 + this.intensity * 900,
        this.ctx.currentTime,
        1.2,
      );
    }
  }

  stopAmbient(): void {
    if (this.pulseTimer !== null) {
      window.clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
    if (this.ctx && this.musicBus) {
      this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    }
    const oscs = this.droneOscs;
    this.droneOscs = [];
    const stopAt = this.ctx ? this.ctx.currentTime + 1.2 : 0;
    oscs.forEach((o) => {
      try {
        o.stop(stopAt);
      } catch {
        /* already stopped */
      }
    });
    this.droneFilter = null;
  }
}
