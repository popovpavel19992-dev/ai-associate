// src/server/db/schema/clients.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  pgEnum,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

export const clientTypeEnum = pgEnum("client_type", ["individual", "organization"]);
export const clientStatusEnum = pgEnum("client_status", ["active", "archived"]);

// Drizzle has no built-in tsvector type — declare a thin custom type so the
// column type-checks. The router never writes to this column; it's maintained
// by a BEFORE INSERT/UPDATE trigger (clients_search_vector_trigger) that
// recomputes the value from display_name, company_name, first/last_name,
// industry, and notes. See migration 0005_clients.sql for the trigger body.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    clientType: clientTypeEnum("client_type").notNull(),
    displayName: text("display_name").notNull(),
    status: clientStatusEnum("status").default("active").notNull(),

    // Individual fields
    firstName: text("first_name"),
    lastName: text("last_name"),
    dateOfBirth: date("date_of_birth"),

    // Organization fields
    companyName: text("company_name"),
    ein: text("ein"),
    industry: text("industry"),
    website: text("website"),

    // Address (shared)
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),
    country: text("country").default("US"),

    notes: text("notes"),

    // Trigger-maintained tsvector — populated by clients_search_vector_trigger
    // on INSERT/UPDATE. Never written by app code. Plain column (not GENERATED)
    // because Postgres requires IMMUTABLE expressions for STORED generated
    // columns and to_tsvector('english', ...) is not immutable.
    searchVector: tsvector("search_vector"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_clients_org_active").on(table.orgId).where(sql`status = 'active'`),
    index("idx_clients_solo_active")
      .on(table.userId)
      .where(sql`org_id IS NULL AND status = 'active'`),
    // GIN index on the generated column — declared at SQL level in the migration
    // because Drizzle's index builder does not yet support `using('gin')` reliably
    // for custom types. The schema-level index list omits it to avoid drift.
    index("idx_clients_updated_at").on(sql`updated_at DESC`),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
