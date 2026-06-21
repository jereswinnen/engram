import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

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

export const transcriptions = pgTable("transcriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordingId: uuid("recording_id").notNull().references(() => recordings.id, { onDelete: "cascade" }),
  fullText: text("full_text").notNull(),
  language: text("language"),
  segments: jsonb("segments").notNull().$type<{ start: number; end: number; text: string; speaker?: string }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
});
