import { Router, type IRouter } from "express";
import { desc, gt, sql } from "drizzle-orm";
import { db, runsTable } from "@workspace/db";
import {
  CreateRunBody,
  CreateRunResponse,
  ListRecentRunsQueryParams,
  ListRecentRunsResponse,
  ListRunsQueryParams,
  ListRunsResponse,
  GetRunStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_LEADERBOARD_LIMIT = 20;
const DEFAULT_RECENT_LIMIT = 8;

/**
 * Submission is deliberately unauthenticated -- this is an arcade board, not a
 * ranked ladder. That makes the numbers unverifiable, so the goal here is only
 * to keep a casual forger from flooding or permanently topping the board:
 * reject results no real run could produce, and cap how fast one client can
 * post.
 */
const SUBMIT_WINDOW_MS = 10 * 60 * 1000;
const SUBMIT_MAX_PER_WINDOW = 10;
const MIN_RUN_SECONDS = 5;
const MAX_KILLS_PER_SECOND = 20;
const MAX_SCORE_PER_KILL = 5000;

const submissions = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (submissions.get(key) ?? []).filter(
    (at) => now - at < SUBMIT_WINDOW_MS,
  );

  if (recent.length >= SUBMIT_MAX_PER_WINDOW) {
    submissions.set(key, recent);
    return true;
  }

  recent.push(now);
  submissions.set(key, recent);

  // Opportunistic sweep so the map cannot grow without bound.
  if (submissions.size > 5000) {
    for (const [ip, times] of submissions) {
      if (times.every((at) => now - at >= SUBMIT_WINDOW_MS)) {
        submissions.delete(ip);
      }
    }
  }

  return false;
}

/** Returns a reason string when the numbers could not have come from a real run. */
function implausible(run: {
  score: number;
  wave: number;
  kills: number;
  durationSeconds: number;
}): string | null {
  if (run.durationSeconds < MIN_RUN_SECONDS) {
    return "Run is too short to be a completed run";
  }
  if (run.kills > run.durationSeconds * MAX_KILLS_PER_SECOND + 25) {
    return "Kill count is not achievable in that duration";
  }
  if (run.score > run.kills * MAX_SCORE_PER_KILL + 20000) {
    return "Score is not achievable with that kill count";
  }
  if (run.wave > run.kills + 1) {
    return "Wave reached is not achievable with that kill count";
  }
  return null;
}

/** Highest scores first. Rank is the row's position on the board. */
router.get("/runs", async (req, res): Promise<void> => {
  const params = ListRunsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? DEFAULT_LEADERBOARD_LIMIT;

  const rows = await db
    .select()
    .from(runsTable)
    .orderBy(desc(runsTable.score), desc(runsTable.createdAt))
    .limit(limit);

  res.json(
    ListRunsResponse.parse(
      rows.map((row, index) => ({ ...row, rank: index + 1 })),
    ),
  );
});

/** Newest runs first, for the live activity feed. */
router.get("/runs/recent", async (req, res): Promise<void> => {
  const params = ListRecentRunsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? DEFAULT_RECENT_LIMIT;

  const rows = await db
    .select()
    .from(runsTable)
    .orderBy(desc(runsTable.createdAt))
    .limit(limit);

  res.json(ListRecentRunsResponse.parse(rows));
});

/** Aggregate stats across every run ever recorded. */
router.get("/runs/stats", async (_req, res): Promise<void> => {
  const [totals] = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      bestScore: sql<number>`coalesce(max(${runsTable.score}), 0)::int`,
      bestWave: sql<number>`coalesce(max(${runsTable.wave}), 0)::int`,
      totalKills: sql<number>`coalesce(sum(${runsTable.kills}), 0)::int`,
      averageWave: sql<number>`coalesce(avg(${runsTable.wave}), 0)::float8`,
    })
    .from(runsTable);

  const [best] = await db
    .select({ callsign: runsTable.callsign })
    .from(runsTable)
    .orderBy(desc(runsTable.score), desc(runsTable.createdAt))
    .limit(1);

  res.json(
    GetRunStatsResponse.parse({
      totalRuns: totals?.totalRuns ?? 0,
      bestScore: totals?.bestScore ?? 0,
      bestWave: totals?.bestWave ?? 0,
      totalKills: totals?.totalKills ?? 0,
      averageWave: totals?.averageWave ?? 0,
      topCallsign: best?.callsign ?? null,
    }),
  );
});

/** Record a finished run and tell the player where it landed. */
router.post("/runs", async (req, res): Promise<void> => {
  const parsed = CreateRunBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid run payload");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const callsign = parsed.data.callsign.trim().slice(0, 16).toUpperCase();
  if (callsign.length === 0) {
    res.status(400).json({ error: "Callsign must not be blank" });
    return;
  }

  if (rateLimited(req.ip ?? "unknown")) {
    req.log.warn({ callsign }, "Run submission rate limit hit");
    res.status(429).json({ error: "Too many runs submitted. Try again later." });
    return;
  }

  const reason = implausible(parsed.data);
  if (reason) {
    req.log.warn({ callsign, reason }, "Rejected implausible run");
    res.status(400).json({ error: reason });
    return;
  }

  const [run] = await db
    .insert(runsTable)
    .values({
      callsign,
      score: Math.round(parsed.data.score),
      wave: Math.round(parsed.data.wave),
      kills: Math.round(parsed.data.kills),
      accuracy: parsed.data.accuracy,
      bestCombo: Math.round(parsed.data.bestCombo),
      durationSeconds: Math.round(parsed.data.durationSeconds),
    })
    .returning();

  if (!run) {
    res.status(400).json({ error: "Run could not be recorded" });
    return;
  }

  const [ahead] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runsTable)
    .where(gt(runsTable.score, run.score));

  res.status(201).json(
    CreateRunResponse.parse({ ...run, rank: (ahead?.count ?? 0) + 1 }),
  );
});

export default router;
