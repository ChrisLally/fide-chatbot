import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import path from "node:path";

config({ path: ".env" });
config({ path: ".env.local" });

const pgliteDataDir =
  process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".pglite");

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  breakpoints: true,
  dbCredentials: {
    url: pgliteDataDir,
  },
});
