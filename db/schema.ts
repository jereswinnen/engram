import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
  customType,
  unique,
  foreignKey,
  check,
  uniqueIndex,
  doublePrecision,
  vector,
} from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector"
  },
})

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
})

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
  (table) => [index("session_userId_idx").on(table.userId)]
)

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
  (table) => [index("account_userId_idx").on(table.userId)]
)

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
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
})

export const oauthClient = pgTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    public: boolean("public"),
    type: text("type"),
    requirePKCE: boolean("require_pkce"),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("oauthClient_userId_idx").on(table.userId)]
)

export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    authTime: timestamp("auth_time"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthRefreshToken_clientId_idx").on(table.clientId),
    index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
    index("oauthRefreshToken_userId_idx").on(table.userId),
    index("oauth_refresh_token_reference_id_idx").on(table.referenceId),
  ]
)

export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthAccessToken_clientId_idx").on(table.clientId),
    index("oauthAccessToken_sessionId_idx").on(table.sessionId),
    index("oauthAccessToken_userId_idx").on(table.userId),
    index("oauthAccessToken_refreshId_idx").on(table.refreshId),
    index("oauth_access_token_reference_id_idx").on(table.referenceId),
  ]
)

export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("oauthConsent_clientId_idx").on(table.clientId),
    index("oauthConsent_userId_idx").on(table.userId),
    index("oauth_consent_reference_id_idx").on(table.referenceId),
  ]
)

// ---------------------------------------------------------------------------
// App tables
// ---------------------------------------------------------------------------

export const authConnections = pgTable(
  "auth_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    mechanism: text("mechanism").notNull(),
    provider: text("provider").notNull().default("engram"),
    clientId: text("client_id"),
    providerGrantId: text("provider_grant_id"),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    scopes: jsonb("scopes").notNull().$type<string[]>().default([]),
    clientVersion: text("client_version"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    index("auth_connections_owner_id_idx").on(t.ownerId),
    index("auth_connections_owner_status_created_idx").on(
      t.ownerId,
      t.status,
      t.createdAt
    ),
    index("auth_connections_client_id_idx").on(t.clientId),
    unique("auth_connections_provider_grant_unique").on(
      t.provider,
      t.clientId,
      t.providerGrantId
    ),
    unique("auth_connections_legacy_identity_unique").on(
      t.ownerId,
      t.mechanism,
      t.clientId,
      t.providerGrantId
    ),
    unique("auth_connections_id_owner_unique").on(t.id, t.ownerId),
    check(
      "auth_connections_mechanism_check",
      sql`${t.mechanism} in ('oauth', 'legacy-mac')`
    ),
    check(
      "auth_connections_status_check",
      sql`${t.status} in ('pending', 'active', 'revoked')`
    ),
  ]
)

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    createdByConnectionId: uuid("created_by_connection_id"),
    title: text("title").notNull(),
    originalTitle: text("original_title"),
    titleOrigin: text("title_origin").notNull().default("legacy"),
    source: text("source").notNull().default("upload"),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    durationSeconds: integer("duration_seconds"),
    status: text("status").notNull().default("uploaded"),
    errorMessage: text("error_message"),
    plaudFileId: text("plaud_file_id").unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("recordings_owner_id_idx").on(t.ownerId),
    index("recordings_owner_created_at_idx").on(t.ownerId, t.createdAt),
    index("recordings_created_by_connection_id_idx").on(
      t.createdByConnectionId
    ),
    unique("recordings_owner_plaud_file_unique").on(t.ownerId, t.plaudFileId),
    foreignKey({
      name: "recordings_connection_owner_fk",
      columns: [t.createdByConnectionId, t.ownerId],
      foreignColumns: [authConnections.id, authConnections.ownerId],
    }),
    check(
      "recordings_connection_requires_owner_check",
      sql`${t.createdByConnectionId} is null or ${t.ownerId} is not null`
    ),
    check(
      "recordings_title_origin_check",
      sql`${t.titleOrigin} in ('user', 'filename', 'device', 'provider', 'generated', 'legacy')`
    ),
  ]
)

export const transcriptions = pgTable(
  "transcriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    fullText: text("full_text").notNull(),
    rawText: text("raw_text"),
    language: text("language"),
    segments: jsonb("segments")
      .notNull()
      .$type<
        { start: number; end: number; text: string; speaker?: string }[]
      >(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(full_text, ''))`
    ),
  },
  (t) => [index("idx_transcriptions_search").using("gin", t.searchVector)]
)

export const transcriptEmbeddings = pgTable(
  "transcript_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    transcriptionId: uuid("transcription_id")
      .notNull()
      .references(() => transcriptions.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    startSeconds: doublePrecision("start_seconds"),
    endSeconds: doublePrecision("end_seconds"),
    embeddingModel: text("embedding_model").notNull(),
    embeddingVersion: text("embedding_version")
      .notNull()
      .default("transcript-passage-v1"),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(content, ''))`
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("transcript_embeddings_owner_idx").on(t.ownerId),
    index("transcript_embeddings_recording_idx").on(t.recordingId),
    uniqueIndex("transcript_embeddings_transcription_chunk_model_unique").on(
      t.transcriptionId,
      t.chunkIndex,
      t.embeddingModel
    ),
    index("transcript_embeddings_embedding_hnsw_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops")
    ),
    index("transcript_embeddings_search_idx").using("gin", t.searchVector),
  ]
)

export const mcpRateLimitBuckets = pgTable(
  "mcp_rate_limit_buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyDigest: text("key_digest").notNull(),
    windowStart: timestamp("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mcp_rate_limit_bucket_unique").on(t.keyDigest, t.windowStart),
    index("mcp_rate_limit_expires_at_idx").on(t.expiresAt),
    check("mcp_rate_limit_request_count_check", sql`${t.requestCount} > 0`),
  ]
)

export const aiEnhancements = pgTable(
  "ai_enhancements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("summary"),
    title: text("title"),
    overview: text("overview").notNull(),
    keyPoints: jsonb("key_points").notNull().$type<string[]>(),
    decisions: jsonb("decisions").notNull().$type<string[]>().default([]),
    actionItems: jsonb("action_items")
      .notNull()
      .$type<{ text: string; owner?: string | null; due?: string | null }[]>(),
    chapters: jsonb("chapters")
      .notNull()
      .$type<{ title: string; gist: string; startSeconds?: number | null }[]>()
      .default([]),
    openQuestions: jsonb("open_questions")
      .notNull()
      .$type<string[]>()
      .default([]),
    searchText: text("search_text").notNull().default(""),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(search_text, ''))`
    ),
    model: text("model").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_enhancements_recording_created_idx").on(
      t.recordingId,
      t.createdAt
    ),
    index("ai_enhancements_search_idx").using("gin", t.searchVector),
  ]
)

export const apiCredentials = pgTable(
  "api_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    provider: text("provider").notNull().unique(),
    ciphertext: text("ciphertext").notNull(), // AES-256-GCM payload
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("api_credentials_owner_id_idx").on(t.ownerId),
    unique("api_credentials_owner_provider_unique").on(t.ownerId, t.provider),
  ]
)

export const storageConfig = pgTable("storage_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  backend: text("backend").notNull().default("r2"),
  bucket: text("bucket").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

export const userSettings = pgTable(
  "user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    languageDefault: text("language_default"),
    llmProvider: text("llm_provider").notNull().default("openai"),
    llmModel: text("llm_model").notNull().default("gpt-5.4-mini-2026-03-17"),
  },
  (t) => [unique("user_settings_owner_unique").on(t.ownerId)]
)

export const syncState = pgTable(
  "sync_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    lastCursor: text("last_cursor"),
    lastSyncedAt: timestamp("last_synced_at"),
    runningSince: timestamp("running_since"),
    lastResult: jsonb("last_result").$type<{
      ranAt: string
      newCount: number
      skippedCount: number
      failedCount: number
      deferredCount: number
      processingErrorCount?: number
      note?: string
      error?: string
    }>(),
  },
  (t) => [unique("sync_state_owner_unique").on(t.ownerId)]
)

export const glossary = pgTable(
  "glossary",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    term: text("term").notNull(),
    aliases: jsonb("aliases").notNull().$type<string[]>().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("glossary_owner_term_idx").on(t.ownerId, t.term)]
)

export const backups = pgTable(
  "backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("pending"),
    storageKey: text("storage_key"),
    sizeBytes: integer("size_bytes"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("backups_owner_created_at_idx").on(t.ownerId, t.createdAt)]
)

export const speakers = pgTable(
  "speakers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull().unique(),
    normalizedName: text("normalized_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("speakers_owner_id_idx").on(t.ownerId),
    uniqueIndex("speakers_owner_normalized_name_unique").on(
      t.ownerId,
      t.normalizedName
    ),
  ]
)

export const plaudOAuthAttempts = pgTable(
  "plaud_oauth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("plaud"),
    stateHash: text("state_hash").notNull().unique(),
    encryptedVerifier: text("encrypted_verifier").notNull(),
    encryptedAuthorizationUrl: text("encrypted_authorization_url"),
    redirectUri: text("redirect_uri").notNull(),
    authorizationServerIssuer: text("authorization_server_issuer"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("plaud_oauth_attempts_owner_id_idx").on(t.ownerId),
    index("plaud_oauth_attempts_expires_at_idx").on(t.expiresAt),
    check(
      "plaud_oauth_attempts_state_hash_check",
      sql`length(${t.stateHash}) = 64`
    ),
    check(
      "plaud_oauth_attempts_expiry_check",
      sql`${t.expiresAt} > ${t.createdAt}`
    ),
  ]
)

export const recordingSpeakers = pgTable(
  "recording_speakers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    speakerId: uuid("speaker_id")
      .notNull()
      .references(() => speakers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("recording_speakers_recording_label").on(t.recordingId, t.label),
  ]
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  oauthClients: many(oauthClient),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
  oauthConsents: many(oauthConsent),
  recordings: many(recordings),
  authConnections: many(authConnections),
  apiCredentials: many(apiCredentials),
  userSettings: many(userSettings),
  syncState: many(syncState),
  glossary: many(glossary),
  backups: many(backups),
  speakers: many(speakers),
  plaudOAuthAttempts: many(plaudOAuthAttempts),
}))

export const sessionRelations = relations(session, ({ one, many }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}))

export const oauthClientRelations = relations(oauthClient, ({ one, many }) => ({
  user: one(user, {
    fields: [oauthClient.userId],
    references: [user.id],
  }),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
  oauthConsents: many(oauthConsent),
}))

export const oauthRefreshTokenRelations = relations(
  oauthRefreshToken,
  ({ one, many }) => ({
    oauthClient: one(oauthClient, {
      fields: [oauthRefreshToken.clientId],
      references: [oauthClient.clientId],
    }),
    session: one(session, {
      fields: [oauthRefreshToken.sessionId],
      references: [session.id],
    }),
    user: one(user, {
      fields: [oauthRefreshToken.userId],
      references: [user.id],
    }),
    oauthAccessTokens: many(oauthAccessToken),
  })
)

export const oauthAccessTokenRelations = relations(
  oauthAccessToken,
  ({ one }) => ({
    oauthClient: one(oauthClient, {
      fields: [oauthAccessToken.clientId],
      references: [oauthClient.clientId],
    }),
    session: one(session, {
      fields: [oauthAccessToken.sessionId],
      references: [session.id],
    }),
    user: one(user, {
      fields: [oauthAccessToken.userId],
      references: [user.id],
    }),
    oauthRefreshToken: one(oauthRefreshToken, {
      fields: [oauthAccessToken.refreshId],
      references: [oauthRefreshToken.id],
    }),
  })
)

export const oauthConsentRelations = relations(oauthConsent, ({ one }) => ({
  oauthClient: one(oauthClient, {
    fields: [oauthConsent.clientId],
    references: [oauthClient.clientId],
  }),
  user: one(user, {
    fields: [oauthConsent.userId],
    references: [user.id],
  }),
}))

export const authConnectionRelations = relations(
  authConnections,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [authConnections.ownerId],
      references: [user.id],
    }),
    recordings: many(recordings),
  })
)

export const recordingRelations = relations(recordings, ({ one, many }) => ({
  owner: one(user, { fields: [recordings.ownerId], references: [user.id] }),
  createdByConnection: one(authConnections, {
    fields: [recordings.createdByConnectionId],
    references: [authConnections.id],
  }),
  transcriptions: many(transcriptions),
  transcriptEmbeddings: many(transcriptEmbeddings),
  aiEnhancements: many(aiEnhancements),
  recordingSpeakers: many(recordingSpeakers),
}))

export const transcriptEmbeddingRelations = relations(
  transcriptEmbeddings,
  ({ one }) => ({
    owner: one(user, {
      fields: [transcriptEmbeddings.ownerId],
      references: [user.id],
    }),
    recording: one(recordings, {
      fields: [transcriptEmbeddings.recordingId],
      references: [recordings.id],
    }),
    transcription: one(transcriptions, {
      fields: [transcriptEmbeddings.transcriptionId],
      references: [transcriptions.id],
    }),
  })
)
