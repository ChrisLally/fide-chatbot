import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as typeof globalThis & {
  pgliteClient?: PGlite;
  pgliteDb?: DrizzleDb;
  pgliteInitPromise?: Promise<DrizzleDb>;
};

export function getPgliteDataDir() {
  return process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".pglite");
}

async function openPglite(dataDir: string): Promise<PGlite> {
  const open = async () => {
    const client = new PGlite(dataDir);
    await client.waitReady;
    return client;
  };

  const lockPath = path.join(dataDir, "postmaster.pid");
  let lastError: unknown;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await open();
    } catch (error) {
      lastError = error;
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw new Error(
    `PGlite failed to open at ${dataDir}. The data directory was not removed.`,
    { cause: lastError }
  );
}

async function initDb(): Promise<DrizzleDb> {
  const client = await openPglite(getPgliteDataDir());

  const db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "lib/db/migrations"),
  });

  globalForDb.pgliteClient = client;
  globalForDb.pgliteDb = db;
  return db;
}

export async function getDb(): Promise<DrizzleDb> {
  if (globalForDb.pgliteDb) {
    return globalForDb.pgliteDb;
  }

  if (!globalForDb.pgliteInitPromise) {
    globalForDb.pgliteInitPromise = initDb().catch((error) => {
      globalForDb.pgliteInitPromise = undefined;
      throw error;
    });
  }

  return globalForDb.pgliteInitPromise;
}
