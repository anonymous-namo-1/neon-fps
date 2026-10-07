import { randomInt, randomUUID } from "node:crypto";
import type {
  DamageEvent,
  IncomingHit,
  MatchSession,
  MatchSessionGameMode,
  MatchSessionMode,
  MultiplayerPlayer,
  PlayerNetworkState,
} from "@workspace/api-zod";

interface RoomPlayer extends MultiplayerPlayer {
  sessionToken: string;
  lastSeen: number;
  /** Damage other clients reported against this player, drained on their read. */
  pending: IncomingHit[];
  /** Start of the rolling window used to rate-limit damage this player reports. */
  damageWindowAt: number;
  /** Damage this player has reported inside the current window. */
  damageInWindow: number;
}

interface Room {
  code: string;
  mode: MatchSessionMode;
  gameMode: MatchSessionGameMode;
  hostId: string;
  arenaId: string;
  createdAt: number;
  players: Map<string, RoomPlayer>;
}

const rooms = new Map<string, Room>();
const PLAYER_TIMEOUT_MS = 30_000;
const ROOM_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A slow reader must not let a fast shooter grow the queue without bound. */
const MAX_PENDING_HITS = 64;
/** Ceiling per reported hit. Clients are not trusted to send sane numbers. */
const MAX_HIT_DAMAGE = 500;
/**
 * Rolling damage budget per shooter. The wire format allows 32 hits per state
 * post at ten posts a second, which is orders of magnitude above anything the
 * game can actually produce; without a budget one edited client could flood
 * the room. This is a sanity ceiling, not anti-cheat -- hit detection is still
 * client-side, so a determined cheat can land damage it did not earn. It just
 * cannot spray an unbounded amount of it.
 */
const DAMAGE_WINDOW_MS = 1_000;
const MAX_DAMAGE_PER_WINDOW = 2_500;

/** Modes where operators are hostile to each other. Mirrors MODE_TUNING.pvp. */
const PVP_MODES = new Set<MatchSessionGameMode>(["royale", "duel", "hunt"]);

function roomCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    for (let index = 0; index < 6; index++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not allocate a multiplayer room code");
}

function cleanCallsign(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 16).toUpperCase();
}

function createPlayer(callsign: string): RoomPlayer {
  return {
    id: randomUUID(),
    callsign: cleanCallsign(callsign) || "OPERATOR",
    state: null,
    sessionToken: randomUUID(),
    lastSeen: Date.now(),
    pending: [],
    damageWindowAt: 0,
    damageInWindow: 0,
  };
}

function sweep(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const [id, player] of room.players) {
      if (now - player.lastSeen > PLAYER_TIMEOUT_MS) room.players.delete(id);
    }
    if (
      room.players.size === 0 ||
      now - room.createdAt > ROOM_MAX_AGE_MS
    ) {
      rooms.delete(code);
      continue;
    }
    if (!room.players.has(room.hostId)) {
      room.hostId = room.players.keys().next().value as string;
    }
  }
}

/**
 * Builds the view of the room for one reader, and drains that reader's
 * damage queue in the same pass.
 *
 * Draining on read is what makes each hit land exactly once: the shooter
 * resolves the hit locally and reports it, the server holds it until the
 * victim's next request, and the victim applies it to their own health. The
 * victim stays the only writer of their own health, so two clients can never
 * disagree about it.
 */
function session(room: Room, playerId: string): MatchSession {
  const localPlayer = room.players.get(playerId);
  if (!localPlayer) throw new Error("Cannot create a session for a missing player");
  const incoming = localPlayer.pending;
  localPlayer.pending = [];
  return {
    roomCode: room.code,
    playerId,
    sessionToken: localPlayer.sessionToken,
    mode: room.mode,
    status: room.players.size >= 2 ? "matched" : "waiting",
    hostId: room.hostId,
    arenaId: room.arenaId,
    gameMode: room.gameMode,
    players: [...room.players.values()].map(
      ({ lastSeen: _, sessionToken: __, pending: ___, ...player }) => player,
    ),
    incoming,
  };
}

/** Queues shooter-reported damage against the named targets in this room. */
function applyHits(
  room: Room,
  shooter: RoomPlayer,
  hits: readonly DamageEvent[] | undefined,
): void {
  if (!hits?.length) return;
  // Friendly fire is a room rule, not a client preference. Horde is co-op, so
  // a squadmate cannot be damaged no matter what their client reports.
  if (!PVP_MODES.has(room.gameMode)) return;

  const now = Date.now();
  if (now - shooter.damageWindowAt >= DAMAGE_WINDOW_MS) {
    shooter.damageWindowAt = now;
    shooter.damageInWindow = 0;
  }

  for (const hit of hits) {
    if (hit.targetId === shooter.id) continue;
    const target = room.players.get(hit.targetId);
    if (!target) continue;
    // Nothing to add to a player who has already reported themselves down;
    // their own client is authoritative for coming back.
    if (target.state?.dead) continue;

    const damage = Math.min(
      MAX_HIT_DAMAGE,
      Math.max(0, Number.isFinite(hit.damage) ? hit.damage : 0),
    );
    if (damage <= 0) continue;
    if (shooter.damageInWindow + damage > MAX_DAMAGE_PER_WINDOW) break;
    if (target.pending.length >= MAX_PENDING_HITS) continue;

    shooter.damageInWindow += damage;
    target.pending.push({
      fromId: shooter.id,
      fromCallsign: shooter.callsign,
      damage,
      headshot: hit.headshot === true,
    });
  }
}

/** The host owns the room's game mode; everyone else's request is ignored. */
function applyGameMode(
  room: Room,
  playerId: string,
  gameMode: MatchSessionGameMode | undefined,
): void {
  if (!gameMode || playerId !== room.hostId) return;
  room.gameMode = gameMode;
}

export function createPrivateRoom(
  callsign: string,
  arenaId: string,
  gameMode: MatchSessionGameMode = "horde",
): MatchSession {
  sweep();
  const player = createPlayer(callsign);
  const code = roomCode();
  const room: Room = {
    code,
    mode: "private",
    gameMode,
    hostId: player.id,
    arenaId,
    createdAt: Date.now(),
    players: new Map([[player.id, player]]),
  };
  rooms.set(code, room);
  return session(room, player.id);
}

export function joinPrivateRoom(
  rawCode: string,
  callsign: string,
): MatchSession | "missing" | "full" {
  sweep();
  const room = rooms.get(rawCode.toUpperCase());
  if (!room || room.mode !== "private") return "missing";
  if (room.players.size >= 2) return "full";
  const player = createPlayer(callsign);
  room.players.set(player.id, player);
  return session(room, player.id);
}

export function joinQuickPlay(
  callsign: string,
  arenaId: string,
  gameMode: MatchSessionGameMode = "horde",
): MatchSession {
  sweep();
  for (const room of rooms.values()) {
    if (
      room.mode !== "quick" ||
      room.players.size !== 1 ||
      room.arenaId !== arenaId ||
      room.gameMode !== gameMode
    ) continue;
    const player = createPlayer(callsign);
    room.players.set(player.id, player);
    return session(room, player.id);
  }

  const player = createPlayer(callsign);
  const code = roomCode();
  const room: Room = {
    code,
    mode: "quick",
    gameMode,
    hostId: player.id,
    arenaId,
    createdAt: Date.now(),
    players: new Map([[player.id, player]]),
  };
  rooms.set(code, room);
  return session(room, player.id);
}

export function pollRoom(
  rawCode: string,
  playerId: string,
  sessionToken: string,
  gameMode?: MatchSessionGameMode,
): MatchSession | null {
  sweep();
  const room = rooms.get(rawCode.toUpperCase());
  const player = room?.players.get(playerId);
  if (!room || !player || player.sessionToken !== sessionToken) return null;
  player.lastSeen = Date.now();
  applyGameMode(room, playerId, gameMode);
  return session(room, playerId);
}

export function updatePlayerState(
  rawCode: string,
  playerId: string,
  sessionToken: string,
  state: PlayerNetworkState,
  hits?: readonly DamageEvent[],
  gameMode?: MatchSessionGameMode,
): MatchSession | null {
  sweep();
  const room = rooms.get(rawCode.toUpperCase());
  const player = room?.players.get(playerId);
  if (!room || !player || player.sessionToken !== sessionToken) return null;
  player.state = state;
  player.lastSeen = Date.now();
  applyGameMode(room, playerId, gameMode);
  applyHits(room, player, hits);
  return session(room, playerId);
}

export function leaveRoom(
  rawCode: string,
  playerId: string,
  sessionToken: string,
): void {
  sweep();
  const code = rawCode.toUpperCase();
  const room = rooms.get(code);
  if (!room || room.players.get(playerId)?.sessionToken !== sessionToken) return;
  room.players.delete(playerId);
  if (room.players.size === 0) {
    rooms.delete(code);
  } else if (room.hostId === playerId) {
    room.hostId = room.players.keys().next().value as string;
  }
}