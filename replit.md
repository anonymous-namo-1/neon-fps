# Neon Arena

A browser-based wave-survival FPS: hold a neon industrial arena against escalating waves of hostiles, pick an upgrade between waves, and post your run to a global leaderboard.

## Run & Operate

- `pnpm --filter @workspace/neon-arena run dev` — run the game client
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/neon-arena run typecheck` — typecheck the game (faster than `build`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

Both services already have managed workflows; restart those rather than adding new ones.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Game: React 19 + Three.js 0.185 (`WebGLRenderer` + `EffectComposer` bloom), Tailwind 4
- Audio: procedural Web Audio — no audio files ship with the game
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `artifacts/neon-arena/src/game/` — the engine. `engine.ts` owns the render loop, movement, combat and wave flow; `enemies.ts`, `particles.ts`, `viewmodel.ts`, `audio.ts`, `upgrades.ts`, `spatial-hash.ts` are its subsystems.
- `artifacts/neon-arena/src/game/arena/` — the map registry. `builder.ts` holds the shared `ArenaBuilder` and theme types; one file per map (`grid.ts`, `reactor.ts`, `coldstore.ts`); `index.ts` exports `ARENAS`. **To add a map, write one file and register it in `index.ts`** — nothing else needs to change.
- `artifacts/neon-arena/src/game/contract.ts` — **the boundary between engine and UI.** Every prop the React layer receives is defined here. Change this first, then both sides.
- `artifacts/neon-arena/src/game/progression.ts` — career progression: the unlock table, run modifiers, XP curve and the persisted record. Pure TypeScript, so the UI imports the catalogues directly.
- `artifacts/neon-arena/src/game/use-game.ts` — owns the engine instance and republishes snapshots into React. Also owns storage: settings, the saved kit, and banking each finished run.
- `artifacts/neon-arena/src/ui/` — the screens: menu (with loadout and settings panels), HUD, pause, intermission, game over.
- `lib/api-spec/openapi.yaml` — source of truth for the API. Regenerate clients after editing.
- `lib/db/src/schema/runs.ts` — leaderboard table.
- `artifacts/api-server/src/routes/runs.ts` — leaderboard endpoints.

## Architecture decisions

- **The simulation runs on a fixed timestep** (`SIM_STEP` 1/60, capped at `MAX_SIM_STEPS` per frame) and rendering interpolates between the last two states via `present(frameDt, alpha)`. Gameplay must go in `simulate()`, never in the render path, or it becomes frame-rate dependent.
- **Maps are a registry, not a file.** Each arena batches its boxes into one `InstancedMesh` per material at build time, which is why an arena costs ~5 draw calls instead of ~200.
- **The engine does not re-render React.** It publishes an immutable `GameSnapshot` about 30 times a second; React renders from that. The render loop never touches component state, so a slow UI cannot stall the game.
- **The engine/UI contract is a file, not a convention.** `contract.ts` exists so the 3D layer and the React layer can be worked on independently without guessing prop shapes.
- **Enemies hover above a sampled surface height** rather than pathfinding. It removes navmesh complexity entirely and suits the machine aesthetic.
- **No audio assets.** Every weapon, impact and ambient bed is synthesised at runtime, so the game ships with no media payload and no loading screen.
- **Progression lives outside the engine.** The engine never touches storage: it takes a `RunConfig` at `start()` and reports the result in the snapshot. `use-game.ts` banks XP, and unlocks are derived from lifetime XP rather than stored as a list, so the unlock table can be re-tuned without migrating anyone's save.
- **Leaderboard writes are unauthenticated.** Any client can post a run. This is a deliberate trade for an arcade-style board; if scores start mattering, the run needs server-side validation.

## Product

- Movement-first FPS feel: sprint, air control, and a dash with invulnerability frames.
- Three maps, selected from the menu: THE GRID, REACTOR, COLD STORAGE. Two are unlocked by levelling.
- Four weapons — a hitscan pulse rifle, a chargeable plasma lance with splash, a shard-burst shotgun with range falloff, and an arc tether that chains up to four targets. Two are carried per run, chosen in the loadout screen; number keys address slots, not weapons.
- Career progression across runs: XP from score, waves and kills earns operator levels, which unlock weapons, maps and run modifiers. Modifiers are optional handicaps that pay a score multiplier.
- Settings for mouse sensitivity, master and effects volume, Y inversion, and three graphics tiers (`low` drops the bloom pass and pixel ratio, `medium` halves bloom and thins particles).
- Six enemy roles (skitter, spectre, splitter, brute, seeker, warden) mixed into escalating waves. The seeker is a suicide bomber that friendly-fires; the warden is a turret whose frontal shield must be flanked or baited into firing.
- A combo multiplier, an overdrive meter, and a between-wave upgrade draft from a weighted pool.
- A run summary at game over: score, wave, accuracy, best combo, kills per archetype, XP earned and anything it unlocked.
- Persistent global leaderboard with rank returned on submit.

## Gotchas

- **Test through the proxy** (`http://127.0.0.1/`), never the raw Vite port. The API client calls root-relative `/api/...` paths that only resolve through the proxy.
- **`type: integer` is banned in the OpenAPI spec.** Orval emits a zod v4 API for it and the catalog pins zod v3. Use `type: number`.
- **After a DB schema change, run the workspace `typecheck:libs` before the api-server typecheck**, or the server will not see the new table.
- **The preview screenshot tool cannot render WebGL** (no GPU in that browser). A WebGL context error there does not mean the game is broken.
- **Keep `emissiveIntensity` near 1.0.** Under ACES tone mapping, higher values desaturate to white and the bloom pass smears them across the frame.
- Server code logs through `req.log` or the shared `logger` — never `console.log`.
- **The engine reuses shared scratch vectors (`v1`–`v4`) across nested calls.** `v3`/`v4` are live inside the enemy AI switch (`v4` is the desired velocity), so any helper reachable from there needs its own vector — this has caused silent steering corruption more than once. Give new helpers a named member vector.
- **Anything that damages in a radius must snapshot its targets before applying damage.** Killing a splitter splices the enemy array and appends children mid-iteration, so a live loop both skips enemies and hits newborns.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
