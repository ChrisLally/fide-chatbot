CREATE TABLE IF NOT EXISTS "EntityComment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entityId" text NOT NULL,
  "body" text NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EntityComment_entityId_idx" ON "EntityComment" ("entityId");
