import type { GameModeId, HuntRole } from './contract';
import {
  HUNT_HEADSTART,
  HUNT_PULSE_INTERVAL,
  MODE_TUNING,
  ZONE_DAMAGE,
  ZONE_INTERVAL,
  ZONE_STEPS,
  objectiveFor,
} from './modes';

/**
 * Everything a mode is allowed to do to the world.
 *
 * Deliberately narrow: modes decide *what happens*, the engine decides *how*.
 * Nothing here exposes a mesh, a material or the physics state, so a new mode
 * can never quietly become a second copy of the simulation.
 */
export interface ModeHost {
  /** Distance of the player from the arena centre, on the ground plane. */
  playerRadius(): number;
  /** Metres per second the player is moving. */
  playerSpeed(): number;
  /** True while the trigger is held. */
  playerFiring(): boolean;
  /** Straight-line distance to the closest live enemy, or Infinity. */
  nearestEnemyDistance(): number;
  /** Live enemies of the rival-operator family. */
  operatorCount(): number;
  /** Drops a rival operator into the arena, at least `minDistance` away. */
  /** Returns false when the arena had nowhere to put the rival. */
  spawnOperator(minDistance: number): boolean;
  /** Removes one live operator without credit, as if a rival got them. */
  eliminateRandomOperator(): boolean;
  damagePlayer(amount: number): void;
  announce(title: string, sub: string | null, seconds: number): void;
  feed(text: string): void;
  /** Ends the run. `victory` decides which game-over screen is shown. */
  finishRun(victory: boolean): void;
  /** Puts the player back on the spawn at full health, for a new round. */
  resetRound(): void;
  /** Draws the collapsing grid at this radius. 0 hides it. */
  setZoneRadius(radius: number): void;
  /** Dims the arena. 1 is normal, 0.2 is a blackout. */
  setLightLevel(level: number): void;
  /** Hiders carry no weapon. */
  setPlayerArmed(armed: boolean): void;
  /** Starts the horde wave loop. Only ever called by the horde mode. */
  startWaveFlow(): void;
}

/**
 * The rules layer. One instance per run, ticked from the fixed simulation
 * step, so mode logic is as deterministic as the rest of the world.
 */
export class ModeRuntime {
  readonly mode: GameModeId;
  readonly huntRole: HuntRole;

  /** Rival operators still breathing. */
  opponents = 0;
  duelScore = { player: 0, rival: 0 };
  duelRound = 1;
  /** 0 to 1. In Blackout, reaching 1 as a hider loses the match. */
  detection = 0;
  hidersLeft = 0;
  /** Whatever the mode is counting down, in seconds. */
  timer = 0;
  zoneRadius = 0;
  zoneClosing = false;
  outsideZone = false;
  victory = false;
  /** True once the mode has decided the run is over. */
  finished = false;

  private readonly host: ModeHost;
  /** Live humans in the room besides the local player. Falls as they leave. */
  private humans: number;
  private zoneStep = 0;
  private zoneTimer = 0;
  private attritionTimer = 0;
  private pulseTimer = 0;
  private roundIntro = 0;
  /** Blackout hider: the release is one-shot, even if every hunter dies. */
  private huntersReleased = false;
  /** Blackout seeker: human hiders still breathing. */
  private humanHidersLeft = 0;

  constructor(
    mode: GameModeId,
    huntRole: HuntRole,
    host: ModeHost,
    humanOpponents = 0,
  ) {
    this.mode = mode;
    this.huntRole = huntRole;
    this.host = host;
    this.humans = Math.max(0, Math.floor(humanOpponents));
    this.humanHidersLeft = this.humans;
  }

  /**
   * Bots to drop for this mode.
   *
   * Every human in the room takes a slot off the bot count, so bringing a
   * friend to a duel gives you a real 1v1 rather than a 1v1 plus a bot, and a
   * royale duo faces six rivals rather than seven.
   */
  private botsToSpawn(): number {
    return Math.max(0, MODE_TUNING[this.mode].bots - this.humans);
  }

  get usesWaves(): boolean {
    return MODE_TUNING[this.mode].waves;
  }

  get usesUpgrades(): boolean {
    return MODE_TUNING[this.mode].upgrades;
  }

  /** Which enemy family the run draws from. */
  get infected(): boolean {
    return MODE_TUNING[this.mode].infected;
  }

  start(): void {
    const tuning = MODE_TUNING[this.mode];
    this.host.setLightLevel(tuning.lightLevel);
    this.host.setPlayerArmed(!(this.mode === 'hunt' && this.huntRole === 'hider'));

    switch (this.mode) {
      case 'horde':
        this.host.startWaveFlow();
        break;

      case 'royale': {
        // Count what actually landed. Claiming more rivals than the arena
        // could place leaves a run that can never reach zero.
        this.opponents = this.humans;
        for (let i = 0; i < this.botsToSpawn(); i++) {
          if (this.host.spawnOperator(26)) this.opponents += 1;
        }
        this.zoneStep = 0;
        this.zoneRadius = ZONE_STEPS[0]!;
        this.zoneTimer = ZONE_INTERVAL;
        this.host.setZoneRadius(this.zoneRadius);
        this.host.announce(
          'DROP IN',
          `${this.opponents} RIVAL${this.opponents === 1 ? '' : 'S'} ON THE GRID`,
          2.6,
        );
        break;
      }

      case 'duel':
        this.opponents =
          this.humans > 0 ? 1 : this.host.spawnOperator(22) ? 1 : 0;
        this.timer = tuning.roundSeconds;
        this.host.announce('ROUND 1', 'FIRST TO THREE', 2.2);
        break;

      case 'hunt': {
        this.timer = tuning.matchSeconds;
        if (this.huntRole === 'hider') {
          this.opponents = tuning.bots;
          this.host.announce(
            'LIGHTS OUT',
            `HIDE -- HUNTERS RELEASED IN ${HUNT_HEADSTART}s`,
            2.8,
          );
        } else {
          let placed = this.humans;
          for (let i = 0; i < this.botsToSpawn(); i++) {
            if (this.host.spawnOperator(30)) placed += 1;
          }
          this.hidersLeft = placed;
          this.opponents = placed;
          this.host.announce('LIGHTS OUT', 'FIND THEM ALL', 2.6);
        }
        this.pulseTimer = HUNT_PULSE_INTERVAL;
        break;
      }
    }
  }

  tick(dt: number): void {
    if (this.finished) return;
    if (this.roundIntro > 0) {
      this.roundIntro = Math.max(0, this.roundIntro - dt);
      return;
    }

    switch (this.mode) {
      case 'royale':
        this.tickRoyale(dt);
        break;
      case 'duel':
        this.tickDuel(dt);
        break;
      case 'hunt':
        this.tickHunt(dt);
        break;
      case 'horde':
        break;
    }
  }

  private tickRoyale(dt: number): void {
    // The grid collapses on a fixed schedule and the last ring is small
    // enough that the survivors cannot avoid each other.
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0 && this.zoneStep < ZONE_STEPS.length - 1) {
      this.zoneStep += 1;
      this.zoneTimer = ZONE_INTERVAL;
      this.zoneClosing = true;
      this.host.feed(`GRID COLLAPSING TO ${ZONE_STEPS[this.zoneStep]}m`);
      this.host.announce('GRID COLLAPSE', 'MOVE TO THE SAFE ZONE', 2.2);
    }

    const target = ZONE_STEPS[this.zoneStep]!;
    if (this.zoneRadius > target) {
      this.zoneRadius = Math.max(target, this.zoneRadius - dt * 2.4);
      this.host.setZoneRadius(this.zoneRadius);
    } else {
      this.zoneClosing = false;
    }
    this.timer = Math.max(0, this.zoneTimer);

    this.outsideZone = this.host.playerRadius() > this.zoneRadius;
    if (this.outsideZone) this.host.damagePlayer(ZONE_DAMAGE * dt);

    // Rivals fight each other off-screen. Without this a royale is just a
    // slow sweep of seven bots; with it the field thins while you fight and
    // the match keeps the shape players expect.
    this.attritionTimer -= dt;
    if (this.attritionTimer <= 0) {
      this.attritionTimer = 18 + Math.random() * 16;
      if (this.opponents > 1 && this.host.eliminateRandomOperator()) {
        this.opponents -= 1;
        this.host.feed(`RIVAL ELIMINATED -- ${this.opponents} LEFT`);
      }
    }

    if (this.opponents <= 0) this.win('LAST ONE STANDING', 'GRID SECURED');
  }

  private tickDuel(dt: number): void {
    this.timer = Math.max(0, this.timer - dt);
    if (this.timer > 0) return;

    // A round that runs out of clock goes to the rival: stalling is not a
    // strategy the mode should reward.
    this.host.feed('ROUND EXPIRED');
    this.loseRound();
  }

  private tickHunt(dt: number): void {
    this.timer = Math.max(0, this.timer - dt);

    if (this.huntRole === 'hider') {
      // The hunters are released after a head start.
      const elapsed = MODE_TUNING.hunt.matchSeconds - this.timer;
      if (
        elapsed >= HUNT_HEADSTART &&
        this.host.operatorCount() === 0 &&
        !this.huntersReleased
      ) {
        this.huntersReleased = true;
        for (let i = 0; i < this.botsToSpawn(); i++) {
          this.host.spawnOperator(34);
        }
        this.host.announce('HUNTERS RELEASED', 'STAY QUIET', 2);
      }

      // Detection is noise plus proximity rather than a line-of-sight trace:
      // it is the part the player can actually control, and it makes moving
      // slowly next to a wall the correct play.
      const distance = this.host.nearestEnemyDistance();
      const proximity =
        distance < 18 ? 1 - distance / 18 : 0;
      const noise =
        Math.min(1, this.host.playerSpeed() / 9) * 0.7 +
        (this.host.playerFiring() ? 0.6 : 0);
      const gain = proximity * (0.25 + noise) * dt * 1.15;
      const decay = dt * 0.28;
      this.detection = Math.max(0, Math.min(1, this.detection + gain - decay));

      if (this.detection >= 1) {
        this.host.feed('SPOTTED');
        this.lose('FOUND', 'THE HUNTERS GOT YOU');
        return;
      }
      if (this.timer <= 0) this.win('SURVIVED THE DARK', 'NEVER SEEN');
      return;
    }

    // Seeker: a scanner pulse periodically paints the hiders.
    this.pulseTimer -= dt;
    if (this.pulseTimer <= 0) {
      this.pulseTimer = HUNT_PULSE_INTERVAL;
      const distance = this.host.nearestEnemyDistance();
      this.host.feed(
        Number.isFinite(distance)
          ? `SCAN -- NEAREST HIDER ${Math.round(distance)}m`
          : 'SCAN -- NO CONTACTS',
      );
    }
    this.detection = 1 - this.pulseTimer / HUNT_PULSE_INTERVAL;
    // Human hiders are not enemies in the enemy list, so they are tracked
    // separately and only removed by `onOperatorKilled`.
    this.hidersLeft = this.host.operatorCount() + this.humanHidersLeft;
    if (this.hidersLeft <= 0) this.win('ALL FOUND', 'ARENA SWEPT');
    else if (this.timer <= 0) this.lose('OUT OF TIME', 'THE HIDERS WIN');
  }

  /**
   * A human rival dropped out of the room -- quit, closed the tab, or timed
   * out. They were counted as an opponent at the start of the match, so
   * without this the objective can never be met: a Royale would sit at one
   * remaining rival who no longer exists, and a Duel would wait forever for a
   * round win. A bot takes the empty slot where one can be placed, otherwise
   * the match resolves as if the rival had been eliminated.
   */
  onHumanLeft(): void {
    if (this.humans <= 0) return;
    this.humans -= 1;
    if (this.finished) return;

    if (this.mode === 'hunt') {
      if (this.huntRole === 'seeker') {
        this.humanHidersLeft = Math.max(0, this.humanHidersLeft - 1);
        this.hidersLeft = this.host.operatorCount() + this.humanHidersLeft;
        this.host.feed('HIDER LEFT THE GRID');
        if (this.hidersLeft <= 0) this.win('ALL FOUND', 'ARENA SWEPT');
      }
      return;
    }

    // Backfill so the arena still has someone to fight.
    if (this.host.spawnOperator(26)) {
      this.host.feed('RIVAL DISCONNECTED -- REPLACEMENT DEPLOYED');
      return;
    }

    if (this.mode === 'royale') {
      this.opponents = Math.max(0, this.opponents - 1);
      this.host.feed(`RIVAL DISCONNECTED -- ${this.opponents} LEFT`);
      if (this.opponents <= 0) this.win('LAST ONE STANDING', 'GRID SECURED');
      return;
    }

    if (this.mode === 'duel') {
      this.host.feed('RIVAL DISCONNECTED');
      this.duelScore.player += 1;
      this.nextRound(true);
    }
  }

  /**
   * The player downed a rival. `human` is true when the rival was another
   * player rather than a bot, which matters for Blackout: a human hider is
   * not in the enemy list, so the seeker's tally has to remember them.
   */
  onOperatorKilled(human = false): void {
    if (this.finished) return;
    if (human) this.humanHidersLeft = Math.max(0, this.humanHidersLeft - 1);
    if (this.mode === 'royale') {
      this.opponents = Math.max(0, this.opponents - 1);
      this.host.feed(`RIVAL DOWN -- ${this.opponents} LEFT`);
      if (this.opponents <= 0) this.win('LAST ONE STANDING', 'GRID SECURED');
      return;
    }
    if (this.mode === 'duel') {
      this.duelScore.player += 1;
      this.host.feed(`ROUND ${this.duelRound} WON`);
      this.nextRound(true);
      return;
    }
    if (this.mode === 'hunt' && this.huntRole === 'seeker') {
      this.hidersLeft = Math.max(0, this.hidersLeft - 1);
      this.host.feed(`HIDER FOUND -- ${this.hidersLeft} LEFT`);
      if (this.hidersLeft <= 0) this.win('ALL FOUND', 'ARENA SWEPT');
    }
  }

  /**
   * The player's health hit zero. Modes get to decide whether that is the end
   * of the run or just the end of a round.
   */
  onPlayerDied(): 'end' | 'round' {
    if (this.mode !== 'duel' || this.finished) return 'end';
    this.loseRound();
    return this.finished ? 'end' : 'round';
  }

  private loseRound(): void {
    this.duelScore.rival += 1;
    this.host.feed(`ROUND ${this.duelRound} LOST`);
    this.nextRound(false);
  }

  private nextRound(playerWon: boolean): void {
    const needed = MODE_TUNING.duel.roundsToWin;
    if (this.duelScore.player >= needed) {
      this.win('MATCH WON', `${this.duelScore.player} - ${this.duelScore.rival}`);
      return;
    }
    if (this.duelScore.rival >= needed) {
      this.lose('MATCH LOST', `${this.duelScore.player} - ${this.duelScore.rival}`);
      return;
    }

    this.duelRound += 1;
    this.timer = MODE_TUNING.duel.roundSeconds;
    this.roundIntro = 2;
    this.host.resetRound();
    this.opponents = this.host.spawnOperator(22) ? 1 : 0;
    this.host.announce(
      `ROUND ${this.duelRound}`,
      playerWon ? 'PRESS THE ADVANTAGE' : 'SHAKE IT OFF',
      2,
    );
  }

  private win(title: string, sub: string): void {
    if (this.finished) return;
    this.finished = true;
    this.victory = true;
    this.host.announce(title, sub, 3);
    this.host.finishRun(true);
  }

  private lose(title: string, sub: string): void {
    if (this.finished) return;
    this.finished = true;
    this.victory = false;
    this.host.announce(title, sub, 3);
    this.host.finishRun(false);
  }

  objective(wave: number): string {
    return objectiveFor(this.mode, {
      wave,
      opponents: this.opponents,
      duelScore: this.duelScore,
      huntRole: this.huntRole,
      modeTimer: this.timer,
      hidersLeft: this.hidersLeft,
    });
  }
}
