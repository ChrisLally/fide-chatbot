import { config } from "dotenv";
import { getDb } from "./client";

config({ path: ".env" });
config({ path: ".env.local" });

const runMigrate = async () => {
  console.log("Running migrations...");
  const start = Date.now();
  await getDb();
  const end = Date.now();
  console.log("Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("Migration failed");
  console.error(err);
  console.error(
    "If PGlite was interrupted (e.g. Ctrl+C during dev), try: rm -rf .pglite && pnpm exec tsx lib/db/migrate.ts"
  );
  process.exit(1);
});
