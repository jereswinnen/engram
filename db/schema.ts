import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, index, customType } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ---------------------------------------------------------------------------
// Better Auth tables
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

// ---------------------------------------------------------------------------
// App tables
// ---------------------------------------------------------------------------

export const recordings = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  source: text("source").notNull().default("upload"),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  durationSeconds: integer("duration_seconds"),
  status: text("status").notNull().default("uploaded"),
  errorMessage: text("error_message"),
  plaudFileId: text("plaud_file_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const transcriptions = pgTable(
  "transcriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordingId: uuid("recording_id").notNull().references(() => recordings.id, { onDelete: "cascade" }),
    fullText: text("full_text").notNull(),
    rawText: text("raw_text"),
    language: text("language"),
    segments: jsonb("segments").notNull().$type<{ start: number; end: number; text: string; speaker?: string }[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(full_text, ''))`,
    ),
  },
  (t) => [
    index("idx_transcriptions_search").using("gin", t.searchVector),
  ],
);

export const aiEnhancements = pgTable("ai_enhancements", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordingId: uuid("recording_id").notNull().references(() => recordings.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("summary"),
  title: text("title"),
  summary: text("summary").notNull(),
  actionItems: jsonb("action_items").notNull().$type<string[]>(),
  keyPoints: jsonb("key_points").notNull().$type<string[]>(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apiCredentials = pgTable("api_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().unique(),
  ciphertext: text("ciphertext").notNull(), // AES-256-GCM payload
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const storageConfig = pgTable("storage_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  backend: text("backend").notNull().default("r2"),
  bucket: text("bucket").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const userSettings = pgTable("user_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  languageDefault: text("language_default"),
  llmProvider: text("llm_provider").notNull().default("openai"),
  llmModel: text("llm_model").notNull().default("gpt-5.4-mini-2026-03-17"),
});

export const syncState = pgTable("sync_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  lastCursor: text("last_cursor"),
  lastSyncedAt: timestamp("last_synced_at"),
  lastResult: jsonb("last_result").$type<{
    ranAt: string;
    newCount: number;
    skippedCount: number;
    failedCount: number;
    error?: string;
  }>(),
});

export const glossary = pgTable("glossary", {
  id: uuid("id").primaryKey().defaultRandom(),
  term: text("term").notNull(),
  aliases: jsonb("aliases").notNull().$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
