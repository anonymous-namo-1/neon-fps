import {
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One completed run through the arena. Written once when a player dies and
 * submits their score; never updated afterwards.
 */
export const runsTable = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    callsign: text("callsign").notNull(),
    score: integer("score").notNull(),
    wave: integer("wave").notNull(),
    kills: integer("kills").notNull(),
    /** Shot accuracy percentage, 0-100. */
    accuracy: real("accuracy").notNull(),
    bestCombo: integer("best_combo").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("runs_score_idx").on(table.score),
    index("runs_created_at_idx").on(table.createdAt),
  ],
);

export const insertRunSchema = createInsertSchema(runsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runsTable.$inferSelect;
