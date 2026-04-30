// Apply a single raw SQL migration file against DATABASE_URL.
// Usage: pnpm tsx scripts/apply-migration.ts src/server/db/migrations/0054_calendar_two_way_sync.sql
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/apply-migration.ts <path/to/migration.sql>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  const sql = readFileSync(file!, "utf8");
  const client = postgres(url!, { max: 1, ssl: "prefer" });
  console.log(`Applying ${file} (${sql.length} chars) to ${new URL(url!).host} ...`);
  try {
    await client.unsafe(sql);
    console.log("✓ applied");
  } catch (e) {
    console.error("✗ failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
