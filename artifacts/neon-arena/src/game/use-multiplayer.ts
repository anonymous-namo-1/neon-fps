import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  createPrivateRoom,
  joinPrivateRoom,
  joinQuickPlay,
  leaveMultiplayerRoom,
  pollMultiplayerRoom,
  updateMultiplayerState,
  type MatchSession,
} from '@workspace/api-client-react';
import type { GameEngine } from './engine';
import type { GameModeId } from './contract';

export type OnlineStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'matched'
  | 'error';

const CALLSIGN_KEY = 'neon-arena:callsign:v1';

function loadCallsign(): string {
  const saved = window.localStorage.getItem(CALLSIGN_KEY);
  if (saved) return saved;
  const generated = `OP-${Math.floor(1000 + Math.random() * 9000)}`;
  window.localStorage.setItem(CALLSIGN_KEY, generated);
  return generated;
}

function errorMessage(cause: unknown): string {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'data' in cause &&
    typeof cause.data === 'object' &&
    cause.data !== null &&
    'error' in cause.data &&
    typeof cause.data.error === 'string'
  ) {
    return cause.data.error;
  }
  return cause instanceof Error ? cause.message : 'Network link failed';
}

export function useMultiplayer(
  engineRef: RefObject<GameEngine | null>,
  arenaId: string,
  inRun: boolean,
  gameMode: GameModeId,
) {
  const [session, setSession] = useState<MatchSession | null>(null);
  const [status, setStatus] = useState<OnlineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<MatchSession | null>(null);
  const failures = useRef(0);
  const generation = useRef(0);
  const requestInFlight = useRef(false);
  sessionRef.current = session;

  const accept = useCallback(
    (next: MatchSession) => {
      failures.current = 0;
      sessionRef.current = next;
      setSession(next);
      setStatus(next.status);
      setError(null);
      if (!inRun) engineRef.current?.setArena(next.arenaId);
      engineRef.current?.setRemotePlayers(
        next.players
          .filter((player) => player.id !== next.playerId && player.state)
          .map((player) => ({
            id: player.id,
            callsign: player.callsign,
            ...player.state!,
          })),
      );
      // The server drains this queue as it builds the response, so every
      // accepted response is the only chance to apply these hits.
      if (next.incoming.length > 0) {
        engineRef.current?.applyIncomingDamage(next.incoming);
      }
    },
    [engineRef, inRun],
  );

  const connect = useCallback(
    async (request: () => Promise<MatchSession>) => {
      const requestGeneration = ++generation.current;
      setStatus('connecting');
      setError(null);
      try {
        const next = await request();
        if (generation.current === requestGeneration) accept(next);
      } catch (cause) {
        if (generation.current !== requestGeneration) return;
        setSession(null);
        setStatus('error');
        setError(errorMessage(cause));
      }
    },
    [accept],
  );

  const cancel = useCallback(() => {
    generation.current += 1;
    const current = sessionRef.current;
    if (current) {
      void leaveMultiplayerRoom(current.roomCode, {
        playerId: current.playerId,
        sessionToken: current.sessionToken,
      }).catch(() => undefined);
    }
    sessionRef.current = null;
    setSession(null);
    setStatus('idle');
    setError(null);
    engineRef.current?.setRemotePlayers([]);
  }, [engineRef]);

  useEffect(() => {
    const delay = inRun ? 100 : 650;
    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      if (!current || requestInFlight.current) return;
      const requestGeneration = generation.current;
      requestInFlight.current = true;
      // Only the host's mode is honoured, so it is safe to always send it:
      // it keeps the room in sync without a separate lobby round trip.
      const request =
        inRun && engineRef.current
          ? updateMultiplayerState(current.roomCode, {
              playerId: current.playerId,
              sessionToken: current.sessionToken,
              state: {
                ...engineRef.current.getNetworkState(),
                updatedAt: Date.now(),
              },
              hits: engineRef.current.drainHits(),
              gameMode,
            })
          : pollMultiplayerRoom(current.roomCode, {
              playerId: current.playerId,
              sessionToken: current.sessionToken,
              gameMode,
            });
      void request
        .then((next) => {
          if (
            generation.current === requestGeneration &&
            sessionRef.current?.playerId === current.playerId
          ) {
            accept(next);
          }
        })
        .catch((cause) => {
          if (
            generation.current !== requestGeneration ||
            sessionRef.current?.playerId !== current.playerId
          ) {
            return;
          }
          failures.current += 1;
          if (failures.current < 3) return;
          setStatus('error');
          setError(errorMessage(cause));
          engineRef.current?.setRemotePlayers([]);
        })
        .finally(() => {
          requestInFlight.current = false;
        });
    }, delay);
    return () => window.clearInterval(timer);
  }, [accept, engineRef, inRun, gameMode]);

  useEffect(() => {
    const leave = () => {
      const current = sessionRef.current;
      if (!current) return;
      navigator.sendBeacon(
        `/api/multiplayer/rooms/${current.roomCode}/leave`,
        new Blob([JSON.stringify({
          playerId: current.playerId,
          sessionToken: current.sessionToken,
        })], {
          type: 'application/json',
        }),
      );
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, []);

  const callsign = useRef(loadCallsign()).current;
  return {
    status,
    mode: session?.mode ?? null,
    roomCode: session?.roomCode ?? null,
    error,
    /** The room's mode. Everyone plays the host's choice. */
    roomGameMode: session?.gameMode ?? null,
    isHost: session ? session.hostId === session.playerId : false,
    players:
      session?.players.map((player) => ({
        id: player.id,
        callsign: player.callsign,
        local: player.id === session.playerId,
      })) ?? [],
    connected: session !== null,
    createPrivate: () =>
      connect(() => createPrivateRoom({ callsign, arenaId, gameMode })),
    joinPrivate: (code: string) =>
      connect(() => joinPrivateRoom(code, { callsign, arenaId })),
    quickPlay: () =>
      connect(() => joinQuickPlay({ callsign, arenaId, gameMode })),
    cancel,
  };
}