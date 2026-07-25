CREATE TABLE "auth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"mechanism" text NOT NULL,
	"provider" text DEFAULT 'engram' NOT NULL,
	"client_id" text,
	"provider_grant_id" text,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_version" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "auth_connections_provider_grant_unique" UNIQUE("provider","client_id","provider_grant_id"),
	CONSTRAINT "auth_connections_legacy_identity_unique" UNIQUE("owner_id","mechanism","client_id","provider_grant_id"),
	CONSTRAINT "auth_connections_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "auth_connections_mechanism_check" CHECK ("auth_connections"."mechanism" in ('oauth', 'legacy-mac')),
	CONSTRAINT "auth_connections_status_check" CHECK ("auth_connections"."status" in ('pending', 'active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "plaud_oauth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text DEFAULT 'plaud' NOT NULL,
	"state_hash" text NOT NULL,
	"encrypted_verifier" text NOT NULL,
	"encrypted_authorization_url" text,
	"redirect_uri" text NOT NULL,
	"authorization_server_issuer" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaud_oauth_attempts_state_hash_unique" UNIQUE("state_hash"),
	CONSTRAINT "plaud_oauth_attempts_state_hash_check" CHECK (length("plaud_oauth_attempts"."state_hash") = 64),
	CONSTRAINT "plaud_oauth_attempts_expiry_check" CHECK ("plaud_oauth_attempts"."expires_at" > "plaud_oauth_attempts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "api_credentials" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "glossary" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "created_by_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "auth_connections" ADD CONSTRAINT "auth_connections_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaud_oauth_attempts" ADD CONSTRAINT "plaud_oauth_attempts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_connections_owner_id_idx" ON "auth_connections" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "auth_connections_owner_status_created_idx" ON "auth_connections" USING btree ("owner_id","status","created_at");--> statement-breakpoint
CREATE INDEX "auth_connections_client_id_idx" ON "auth_connections" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "plaud_oauth_attempts_owner_id_idx" ON "plaud_oauth_attempts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "plaud_oauth_attempts_expires_at_idx" ON "plaud_oauth_attempts" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary" ADD CONSTRAINT "glossary_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_connection_owner_fk" FOREIGN KEY ("created_by_connection_id","owner_id") REFERENCES "public"."auth_connections"("id","owner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speakers" ADD CONSTRAINT "speakers_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_credentials_owner_id_idx" ON "api_credentials" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "backups_owner_created_at_idx" ON "backups" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "glossary_owner_term_idx" ON "glossary" USING btree ("owner_id","term");--> statement-breakpoint
CREATE INDEX "recordings_owner_id_idx" ON "recordings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "recordings_owner_created_at_idx" ON "recordings" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "recordings_created_by_connection_id_idx" ON "recordings" USING btree ("created_by_connection_id");--> statement-breakpoint
CREATE INDEX "speakers_owner_id_idx" ON "speakers" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speakers_owner_normalized_name_unique" ON "speakers" USING btree ("owner_id","normalized_name");--> statement-breakpoint
ALTER TABLE "api_credentials" ADD CONSTRAINT "api_credentials_owner_provider_unique" UNIQUE("owner_id","provider");--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_owner_plaud_file_unique" UNIQUE("owner_id","plaud_file_id");--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_owner_unique" UNIQUE("owner_id");--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_owner_unique" UNIQUE("owner_id");--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_connection_requires_owner_check" CHECK ("recordings"."created_by_connection_id" is null or "recordings"."owner_id" is not null);