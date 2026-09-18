# Chatbot

Local Catalina Quest chatbot (Next.js + PGlite). Not part of the fide-internal monorepo.

## Quick start

```bash
cd /home/ubuntu/Desktop/fide-clients/catalina-quest/chatbot
pnpm install
pnpm exec tsx lib/db/migrate.ts   # first time / after wipe
pnpm dev
```

## Database (PGlite)

- Data dir: `.pglite` (override with `PGLITE_DATA_DIR` in `.env`)
- Migrations run automatically on app boot via `lib/db/client.ts`
- Manual migrate: `pnpm exec tsx lib/db/migrate.ts`
- Sanity check: `pnpm exec tsx scripts/verify-pglite.ts`

If you see `Failed to save chat` with a foreign-key error, clear site cookies for localhost (stale guest session) or wipe and remigrate:

```bash
rm -rf .pglite
pnpm exec tsx lib/db/migrate.ts
```

Do not run production (`fide-chatbot.service`) and `pnpm dev` against the same `.pglite` at once — they fight over the lock.

## Production (`https://test.fide.work/demo`)

Long-running host is systemd + nginx:

1. `fide-chatbot.service` — `pnpm start` in this directory, enabled on boot
2. `/etc/fide/chatbot.env` — `IS_DEMO=1` + `PORT=3000` (sets Next `basePath=/demo`)
3. nginx (`sqlpage-linux`) — proxies `/demo` and `/demo-assets` → `127.0.0.1:3000`

Redeploy after code changes:

```bash
pnpm run deploy
```

That is `IS_DEMO=1 pnpm build` plus a restart of `fide-chatbot.service`.

## Data upload inbox

Context drawer → **Upload data** posts to `/api/data/upload` and writes files into `data-inbox/` (override with `DATA_UPLOAD_DIR`). Filenames are `YYYYMMDDTHHMMSSZ__original-name.ext`. This is staging only — not ingested into the Catalina world model yet. Allowed: `.xlsx`, `.xls`, `.csv`, `.md`, `.txt`, `.pdf`, `.json` (max 50MB).
