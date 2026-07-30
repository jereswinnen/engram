ALTER TABLE "ai_enhancements" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "ai_enhancements" AS enhancement
SET "search_text" = concat_ws(E'\n',
  enhancement."overview",
  (SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(enhancement."key_points") AS value),
  (SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(enhancement."decisions") AS value),
  (SELECT string_agg(
    concat_ws(E'\n', item ->> 'text', item ->> 'owner', item ->> 'due'),
    E'\n'
  ) FROM jsonb_array_elements(enhancement."action_items") AS item),
  (SELECT string_agg(
    concat_ws(E'\n', item ->> 'title', item ->> 'gist'),
    E'\n'
  ) FROM jsonb_array_elements(enhancement."chapters") AS item),
  (SELECT string_agg(value, E'\n') FROM jsonb_array_elements_text(enhancement."open_questions") AS value)
);--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, ''))) STORED;--> statement-breakpoint
CREATE INDEX "ai_enhancements_recording_created_idx" ON "ai_enhancements" USING btree ("recording_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_enhancements_search_idx" ON "ai_enhancements" USING gin ("search_vector");
