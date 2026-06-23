ALTER TABLE "ai_enhancements" RENAME COLUMN "summary" TO "overview";--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN "decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN "chapters" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN "open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DELETE FROM "ai_enhancements";
