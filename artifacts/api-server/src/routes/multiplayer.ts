import { Router, type IRouter } from "express";
import {
  CreatePrivateRoomBody,
  CreatePrivateRoomResponse,
  JoinPrivateRoomBody,
  JoinPrivateRoomParams,
  JoinPrivateRoomResponse,
  JoinQuickPlayBody,
  JoinQuickPlayResponse,
  LeaveMultiplayerRoomBody,
  LeaveMultiplayerRoomParams,
  PollMultiplayerRoomBody,
  PollMultiplayerRoomParams,
  PollMultiplayerRoomResponse,
  UpdateMultiplayerStateBody,
  UpdateMultiplayerStateParams,
  UpdateMultiplayerStateResponse,
} from "@workspace/api-zod";
import {
  createPrivateRoom,
  joinPrivateRoom,
  joinQuickPlay,
  leaveRoom,
  pollRoom,
  updatePlayerState,
} from "../lib/multiplayer-rooms";

const router: IRouter = Router();

router.post("/multiplayer/private", (req, res): void => {
  const body = CreatePrivateRoomBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  res.status(201).json(
    CreatePrivateRoomResponse.parse(
      createPrivateRoom(
        body.data.callsign,
        body.data.arenaId,
        body.data.gameMode,
      ),
    ),
  );
});

router.post("/multiplayer/private/:code/join", (req, res): void => {
  const params = JoinPrivateRoomParams.safeParse(req.params);
  const body = JoinPrivateRoomBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid room code or callsign" });
    return;
  }
  const result = joinPrivateRoom(params.data.code, body.data.callsign);
  if (result === "missing") {
    res.status(404).json({ error: "That room no longer exists" });
    return;
  }
  if (result === "full") {
    res.status(409).json({ error: "That room already has two players" });
    return;
  }
  res.json(JoinPrivateRoomResponse.parse(result));
});

router.post("/multiplayer/quick", (req, res): void => {
  const body = JoinQuickPlayBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  res.json(
    JoinQuickPlayResponse.parse(
      joinQuickPlay(body.data.callsign, body.data.arenaId, body.data.gameMode),
    ),
  );
});

router.post("/multiplayer/rooms/:code/poll", (req, res): void => {
  const params = PollMultiplayerRoomParams.safeParse(req.params);
  const body = PollMultiplayerRoomBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid room heartbeat" });
    return;
  }
  const result = pollRoom(
    params.data.code,
    body.data.playerId,
    body.data.sessionToken,
    body.data.gameMode,
  );
  if (!result) {
    res.status(404).json({ error: "Room connection expired" });
    return;
  }
  res.json(PollMultiplayerRoomResponse.parse(result));
});

router.post("/multiplayer/rooms/:code/state", (req, res): void => {
  const params = UpdateMultiplayerStateParams.safeParse(req.params);
  const body = UpdateMultiplayerStateBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid player state" });
    return;
  }
  const result = updatePlayerState(
    params.data.code,
    body.data.playerId,
    body.data.sessionToken,
    body.data.state,
    body.data.hits,
    body.data.gameMode,
  );
  if (!result) {
    res.status(404).json({ error: "Room connection expired" });
    return;
  }
  res.json(UpdateMultiplayerStateResponse.parse(result));
});

router.post("/multiplayer/rooms/:code/leave", (req, res): void => {
  const params = LeaveMultiplayerRoomParams.safeParse(req.params);
  const body = LeaveMultiplayerRoomBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid room departure" });
    return;
  }
  leaveRoom(params.data.code, body.data.playerId, body.data.sessionToken);
  res.status(204).send();
});

export default router;