// Apply a range of raw SQL migrations transactionally.
// Each file runs in its own BEGIN/COMMIT. On error: ROLLBACK that file, abort
// the run, print the offending file. User decides whether to re-run skipping it.
//
// Usage:
//   pnpm tsx scripts/apply-migrations-batch.ts 0029 0053
//   pnpm tsx scripts/apply-migrations-batch.ts 0046 0046     # single file
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = "src/server/db/migrations";

async function main() {
  const [fromArg, toArg] = process.argv.slice(2);
  if (!fromArg || !toArg) {
    console.error(
      "usage: tsx scripts/apply-migrations-batch.ts <from> <to>  (e.g. 0029 0053)",
    );
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const all = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const range = all.filter((f) => {
    const num = f.slice(0, 4);
    return num >= fromArg && num <= toArg;
  });
  if (range.length === 0) {
    console.error(`no migration files matched ${fromArg}..${toArg}`);
    process.exit(1);
  }

  console.log(
    `Applying ${range.length} migrations to ${new URL(url).host} (${fromArg}..${toArg}):`,
  );
  for (const f of range) console.log("  •", f);
  console.log();

  const sql = postgres(url, { max: 1, ssl: "prefer" });
  try {
    for (const f of range) {
      const path = join(MIGRATIONS_DIR, f);
      const content = readFileSync(path, "utf8");
      process.stdout.write(`[${f}] applying… `);
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(content);
        });
        console.log("✓");
      } catch (e) {
        console.log("✗");
        console.error(`\n--- error in ${f} ---`);
        console.error(e instanceof Error ? e.message : e);
        console.error(`--- aborting; ${range.indexOf(f)} of ${range.length} applied successfully ---`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`\nAll ${range.length} migrations applied.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
