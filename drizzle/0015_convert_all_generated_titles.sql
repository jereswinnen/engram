UPDATE "recordings" AS "recording"
SET "original_title" = coalesce("recording"."original_title", "recording"."title"),
    "title" = "enhancement"."title",
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
  AND "recording"."title_origin" IN ('provider', 'filename', 'device');
