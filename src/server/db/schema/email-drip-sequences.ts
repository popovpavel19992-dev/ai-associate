// src/server/db/schema/email-drip-sequences.ts
import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const emailDripSequences = pgTable(
  "email_drip_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("email_drip_sequences_org_active_idx").on(table.orgId, table.isActive),
  ],
);

export type EmailDripSequence = typeof emailDripSequences.$inferSelect;
export type NewEmailDripSequence = typeof emailDripSequences.$inferInsert;
