ALTER TABLE "recordings" ADD COLUMN "original_title" text;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "title_origin" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE "recordings"
SET "original_title" = "title",
    "title_origin" = CASE
      WHEN "source" = 'mac' THEN 'device'
      WHEN "source" = 'plaud' THEN 'provider'
      ELSE 'legacy'
    END;--> statement-breakpoint
UPDATE "recordings" AS "recording"
SET "title" = "enhancement"."title",
    "title_origin" = 'generated'
FROM (
  SELECT DISTINCT ON ("recording_id")
    "recording_id",
    "title"
  FROM "ai_enhancements"
  WHERE "title" IS NOT NULL AND length(trim("title")) > 0
  ORDER BY "recording_id", "created_at" DESC
) AS "enhancement"
WHERE "recording"."id" = "enhancement"."recording_id"
  AND "recording"."title_origin" = 'device';--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_title_origin_check" CHECK ("recordings"."title_origin" in ('user', 'filename', 'device', 'provider', 'generated', 'legacy'));
