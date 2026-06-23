CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"size_bytes" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
