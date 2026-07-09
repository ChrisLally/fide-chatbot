import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { getDb, getPgliteDataDir } from "../lib/db/client";
import { chat, user } from "../lib/db/schema";

config({ path: ".env" });
config({ path: ".env.local" });

async function main() {
  console.log("PGLITE_DATA_DIR=", getPgliteDataDir());

  const db = await getDb();
  const tables = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`
  );
  console.log(
    "tables:",
    (tables as { rows?: Array<{ tablename: string }> }).rows?.map(
      (r) => r.tablename
    ) ?? tables
  );

  const [u] = await db
    .insert(user)
    .values({
      email: `verify-${Date.now()}@test.local`,
      password: "x",
    })
    .returning({ id: user.id, email: user.email });
  console.log("user ok", u);

  const chatId = crypto.randomUUID();
  await db.insert(chat).values({
    id: chatId,
    createdAt: new Date(),
    userId: u.id,
    title: "verify",
    visibility: "private",
  });
  const [c] = await db.select().from(chat).where(eq(chat.id, chatId));
  console.log("chat ok", { id: c.id, userId: c.userId, title: c.title });

  await db.delete(chat).where(eq(chat.id, chatId));
  await db.delete(user).where(eq(user.id, u.id));
  console.log("cleanup ok");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
