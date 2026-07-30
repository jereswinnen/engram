CREATE TABLE "mcp_rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_digest" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_rate_limit_request_count_check" CHECK ("mcp_rate_limit_buckets"."request_count" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_rate_limit_bucket_unique" ON "mcp_rate_limit_buckets" USING btree ("key_digest","window_start");--> statement-breakpoint
CREATE INDEX "mcp_rate_limit_expires_at_idx" ON "mcp_rate_limit_buckets" USING btree ("expires_at");