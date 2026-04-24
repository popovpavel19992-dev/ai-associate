// src/server/db/schema/email-drip-sequence-steps.ts
import { pgTable, uuid, integer, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { emailDripSequences } from "./email-drip-sequences";
import { emailTemplates } from "./email-templates";

export const emailDripSequenceSteps = pgTable(
  "email_drip_sequence_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceId: uuid("sequence_id").references(() => emailDripSequences.id, { onDelete: "cascade" }).notNull(),
    stepOrder: integer("step_order").notNull(),
    templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "restrict" }).notNull(),
    delayDays: integer("delay_days").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("email_drip_sequence_steps_seq_order_idx").on(table.sequenceId, table.stepOrder),
    check(
      "email_drip_sequence_steps_delay_check",
      sql`${table.delayDays} >= 0 AND ${table.delayDays} <= 365`,
    ),
    check(
      "email_drip_sequence_steps_order_check",
      sql`${table.stepOrder} >= 0 AND ${table.stepOrder} <= 9`,
    ),
    unique("email_drip_sequence_steps_unique_order").on(table.sequenceId, table.stepOrder),
  ],
);

export type EmailDripSequenceStep = typeof emailDripSequenceSteps.$inferSelect;
export type NewEmailDripSequenceStep = typeof emailDripSequenceSteps.$inferInsert;
