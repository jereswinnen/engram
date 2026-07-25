-- Prerequisite: install the Railway PostgreSQL `pgvector` extension first.
-- This migration is additive and does not update or delete source data.
CREATE TABLE "transcript_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"recording_id" uuid NOT NULL,
	"transcription_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"start_seconds" double precision,
	"end_seconds" double precision,
	"embedding_model" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcript_embeddings" ADD CONSTRAINT "transcript_embeddings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_embeddings" ADD CONSTRAINT "transcript_embeddings_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_embeddings" ADD CONSTRAINT "transcript_embeddings_transcription_id_transcriptions_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_embeddings_owner_idx" ON "transcript_embeddings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "transcript_embeddings_recording_idx" ON "transcript_embeddings" USING btree ("recording_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_embeddings_transcription_chunk_model_unique" ON "transcript_embeddings" USING btree ("transcription_id","chunk_index","embedding_model");--> statement-breakpoint
CREATE INDEX "transcript_embeddings_embedding_hnsw_idx" ON "transcript_embeddings" USING hnsw ("embedding" vector_cosine_ops);
