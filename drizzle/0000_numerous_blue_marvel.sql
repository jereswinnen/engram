CREATE TABLE "ai_enhancements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"kind" text DEFAULT 'summary' NOT NULL,
	"title" text,
	"summary" text NOT NULL,
	"action_items" jsonb NOT NULL,
	"key_points" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_credentials_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"duration_seconds" integer,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"error_message" text,
	"plaud_file_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_plaud_file_id_unique" UNIQUE("plaud_file_id")
);
--> statement-breakpoint
CREATE TABLE "storage_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backend" text DEFAULT 'r2' NOT NULL,
	"bucket" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_cursor" text,
	"last_synced_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "transcriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"full_text" text NOT NULL,
	"language" text,
	"segments" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language_default" text,
	"llm_provider" text DEFAULT 'openai' NOT NULL,
	"llm_model" text DEFAULT 'gpt-5.4-mini-2026-03-17' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD CONSTRAINT "ai_enhancements_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;