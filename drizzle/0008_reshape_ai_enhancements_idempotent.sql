-- Custom SQL migration file, put your code below! --

-- Corrective, idempotent reshape of ai_enhancements.
-- Migration 0006 was recorded as applied on production but its column changes
-- never took effect (the table still had `summary` and lacked the new columns),
-- so the app's queries for `overview`/`decisions`/`chapters`/`open_questions`
-- failed. drizzle treats 0006 as done, so this fresh migration re-applies the
-- changes safely (idempotent: a no-op on any environment where 0006 did apply).

-- Rename summary -> overview only if it hasn't happened yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_enhancements' AND column_name = 'summary'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_enhancements' AND column_name = 'overview'
  ) THEN
    ALTER TABLE "ai_enhancements" RENAME COLUMN "summary" TO "overview";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN IF NOT EXISTS "decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN IF NOT EXISTS "chapters" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN IF NOT EXISTS "open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Old rows hold the pre-Phase-2 flat shape (string[] action_items, no new fields);
-- clear them so the app never renders an incompatible row. Recordings are
-- re-enhanced via the Regenerate button.
DELETE FROM "ai_enhancements";
