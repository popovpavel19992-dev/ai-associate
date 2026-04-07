import { pgTable, uuid, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const caseMemberRoleEnum = pgEnum("case_member_role", ["lead", "contributor"]);

export const caseMembers = pgTable(
  "case_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: caseMemberRoleEnum("role").default("contributor").notNull(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_members_case_user_unique").on(table.caseId, table.userId),
    index("case_members_case_idx").on(table.caseId),
    index("case_members_user_idx").on(table.userId),
  ],
);
