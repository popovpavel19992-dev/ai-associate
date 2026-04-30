// scripts/check-tables.ts
//
// Quick read-only diagnostic for the Supabase / Postgres schema. Lists every
// public table; pass --probe to also check column-level migration markers.
//
// Usage:
//   pnpm tsx scripts/check-tables.ts
//   pnpm tsx scripts/check-tables.ts --probe
import postgres from "postgres";

async function listTables(sql: postgres.Sql) {
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name`;
  console.log(`Tables: ${rows.length}`);
  for (const r of rows) console.log(" ", r.table_name);
}

async function probeColumn(
  sql: postgres.Sql,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`;
  return rows.length > 0;
}

async function probeTable(sql: postgres.Sql, table: string): Promise<boolean> {
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return rows.length > 0;
}

async function probe(sql: postgres.Sql) {
  const checks: Array<[string, () => Promise<boolean>]> = [
    ["users.ical_token_hash (0042)", () => probeColumn(sql, "users", "ical_token_hash")],
    ["organizations.slug (0046)", () => probeColumn(sql, "organizations", "slug")],
    ["case_discovery_requests (0031)", () => probeTable(sql, "case_discovery_requests")],
    ["case_witness_lists (0034)", () => probeTable(sql, "case_witness_lists")],
    ["bulk_action_logs (0050)", () => probeTable(sql, "bulk_action_logs")],
    ["push_subscriptions.user_agent (0052)", () => probeColumn(sql, "push_subscriptions", "user_agent")],
    ["digest_preferences (0053)", () => probeTable(sql, "digest_preferences")],
    ["external_inbound_events (0054)", () => probeTable(sql, "external_inbound_events")],
  ];
  for (const [label, fn] of checks) {
    const ok = await fn();
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { max: 1, ssl: "prefer" });
  try {
    await listTables(sql);
    if (process.argv.includes("--probe")) {
      console.log("\nMigration markers:");
      await probe(sql);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
