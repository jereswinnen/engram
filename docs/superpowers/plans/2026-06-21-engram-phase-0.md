# Engram Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Engram skeleton so a manually-uploaded Dutch multi-speaker audio file flows through store → diarized transcript → structured summary → minimal viewing UI, deployable behind a login on Railway — with no Plaud device.

**Architecture:** Next.js 16 App Router monolith on Railway. Audio bytes live in Cloudflare R2 (S3-compatible); metadata/transcripts/summaries in Postgres via Drizzle. The pipeline runs as route handlers (Scribe's batch API is a single call). ElevenLabs Scribe v2 does diarized transcription via a hand-written REST adapter; the Vercel AI SDK does structured LLM enhancement. Better Auth (single-user, no email flows) is added last, just before deploy.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, pnpm, Drizzle ORM + postgres.js, Cloudflare R2 via `@aws-sdk/client-s3`, ElevenLabs Scribe v2, Vercel AI SDK (`ai` + `@ai-sdk/openai`) + Zod, Better Auth, shadcn/ui, Vitest for tests.

## Global Constraints

- **Next.js 16 has breaking changes vs. training data.** Before writing ANY Next.js code (route handlers, config, middleware), read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices. Verify route-handler signatures and `next.config` shape against installed docs.
- **Package manager is pnpm.** Never use npm/yarn. Add shadcn components with `pnpm dlx shadcn@latest add <component>`.
- **No mail provider.** No Resend/SMTP/email anywhere. Auth uses email/password with verification disabled and no email-based reset, plus optional passkey.
- **Secrets via `.env` locally (gitignored), Railway env vars in prod.** Never commit keys.
- **Default LLM model:** `gpt-5.4-mini-2026-03-17` (OpenAI), behind a swappable provider config.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- **TDD:** failing test → run it fail → minimal impl → run it pass → commit. Frequent commits.
- **Dutch-first:** transcription auto-detects language; LLM prompts request Dutch output.

## File Structure

```
src/
  db/
    schema.ts            # Drizzle table definitions (all Phase 0 tables)
    index.ts             # db client (postgres.js + drizzle)
  lib/
    crypto/
      secrets.ts         # AES-256-GCM encrypt/decrypt
    storage/
      types.ts           # Storage interface
      r2.ts              # R2/S3 adapter
      index.ts           # active storage selector
    transcription/
      scribe.ts          # ElevenLabs Scribe adapter (ported from docs/)
      types.ts           # TranscriptResult / TranscriptSegment
    ai/
      enhance.ts         # Vercel AI SDK generateObject enhancement
      schema.ts          # Zod schema for enhancement output
    config.ts            # env parsing (DATABASE_URL, R2_*, ELEVENLABS_API_KEY, OPENAI_API_KEY, LLM_MODEL, ENCRYPTION_KEY)
  app/
    api/recordings/route.ts                 # POST create+upload, GET list
    api/recordings/[id]/transcribe/route.ts # POST transcribe
    api/recordings/[id]/enhance/route.ts    # POST enhance
    api/recordings/[id]/audio/route.ts      # GET redirect to presigned R2 URL
    page.tsx                                 # recordings list
    upload/page.tsx                          # upload form
    recordings/[id]/page.tsx                 # detail: audio + transcript + summary
    login/page.tsx                           # (Task 9) login
  auth.ts                # (Task 9) Better Auth server instance
  middleware.ts          # (Task 9) route protection
drizzle/                 # generated migrations
drizzle.config.ts
vitest.config.ts
PROGRESS.md              # living build tracker
.env.example
```

---

### Task 1: Scaffold project + test harness

**Files:**
- Create: project root files via `create-next-app`, `vitest.config.ts`, `PROGRESS.md`, `.env.example`, `src/lib/__tests__/smoke.test.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces: a runnable Next.js 16 app, `pnpm test` running Vitest, `pnpm dev` serving.

- [ ] **Step 1: Scaffold Next.js 16 with pnpm**

Run in the repo root (it already contains git + docs):
```bash
pnpm dlx create-next-app@latest . --typescript --app --src-dir --no-tailwind --eslint --use-pnpm
```
If the directory-not-empty prompt blocks it, scaffold in a temp dir and copy `src/`, `package.json`, `next.config.*`, `tsconfig.json`, configs over, preserving existing `docs/`, `AGENTS.md`, `.git`. Confirm `pnpm dev` serves the default page, then stop it.

- [ ] **Step 2: Read the Next.js 16 docs that this plan touches**

```bash
ls node_modules/next/dist/docs/
```
Read the route-handlers, `next.config`, and middleware guides. Note any signature differences from older Next.js (params may be async, etc.). Record gotchas inline in `PROGRESS.md`.

- [ ] **Step 3: Add Vitest**

```bash
pnpm add -D vitest
```
Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Write a smoke test**

`src/lib/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test harness", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test (expect PASS)**

Run: `pnpm test`
Expected: 1 passed.

- [ ] **Step 6: Initialize shadcn + create scaffolding files**

```bash
pnpm dlx shadcn@latest init
```
Accept defaults (this project skipped Tailwind in step 1 — if shadcn requires Tailwind, let it add Tailwind during init; that is expected). Create `PROGRESS.md` with the Phase 0 checklist (the 10 task titles, all unchecked) and `.env.example` listing every env var from `src/lib/config.ts` (added in later tasks) with placeholder values. Ensure `.env` and `.env.local` are in `.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with pnpm, Vitest, shadcn"
```

---

### Task 2: Database schema + Drizzle migration

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `src/lib/config.ts`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` from env.
- Produces: `db` (drizzle client) from `src/db/index.ts`; table objects `recordings`, `transcriptions`, `aiEnhancements`, `apiCredentials`, `storageConfig`, `userSettings`, `syncState` from `src/db/schema.ts`. `recordings` has columns: `id` (uuid pk), `title` (text), `source` (text, default `'upload'`), `storageKey` (text), `contentType` (text), `durationSeconds` (integer, nullable), `status` (text, default `'uploaded'`), `errorMessage` (text, nullable), `plaudFileId` (text, nullable, unique), `createdAt` (timestamp). `transcriptions`: `id`, `recordingId` (fk), `fullText` (text), `language` (text, nullable), `segments` (jsonb), `createdAt`. `aiEnhancements`: `id`, `recordingId` (fk), `kind` (text default `'summary'`), `title` (text, nullable), `summary` (text), `actionItems` (jsonb), `keyPoints` (jsonb), `model` (text), `createdAt`.

- [ ] **Step 1: Install Drizzle + driver**

```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

- [ ] **Step 2: Write `src/lib/config.ts`**

```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  databaseUrl: () => required("DATABASE_URL"),
  encryptionKey: () => required("ENCRYPTION_KEY"), // 32-byte hex (64 chars)
  elevenLabsApiKey: () => required("ELEVENLABS_API_KEY"),
  openAiApiKey: () => required("OPENAI_API_KEY"),
  llmModel: () => process.env.LLM_MODEL ?? "gpt-5.4-mini-2026-03-17",
  r2: () => ({
    endpoint: required("R2_ENDPOINT"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET"),
  }),
};
```
Getters are functions so tests/build don't throw on import when a var is absent.

- [ ] **Step 3: Write `src/db/schema.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/db/index.ts` and `drizzle.config.ts`**

`src/db/index.ts`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "@/lib/config";
import * as schema from "./schema";

const client = postgres(config.databaseUrl());
export const db = drizzle(client, { schema });
```
`drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```
Add scripts to `package.json`: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`.

- [ ] **Step 5: Write a schema-shape test**

`src/db/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { recordings, transcriptions, aiEnhancements } from "./schema";

describe("schema", () => {
  it("recordings has expected columns", () => {
    expect(Object.keys(recordings)).toEqual(
      expect.arrayContaining(["id", "title", "storageKey", "status", "plaudFileId"]),
    );
  });
  it("transcriptions references recordings", () => {
    expect(transcriptions.recordingId).toBeDefined();
  });
  it("aiEnhancements has summary fields", () => {
    expect(Object.keys(aiEnhancements)).toEqual(
      expect.arrayContaining(["summary", "actionItems", "keyPoints", "model"]),
    );
  });
});
```

- [ ] **Step 6: Run the test (expect PASS)**

Run: `pnpm test src/db/schema.test.ts`
Expected: 3 passed.

- [ ] **Step 7: Generate + apply the migration**

With `DATABASE_URL` set in `.env`:
```bash
pnpm db:generate
pnpm db:migrate
```
Expected: a migration file appears in `drizzle/`; migrate reports success. (If no `DATABASE_URL` yet, generate-only is fine; apply when the DB is available.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Drizzle schema, db client, and config loader"
```

---

### Task 3: AES-256-GCM secret encryption

**Files:**
- Create: `src/lib/crypto/secrets.ts`
- Test: `src/lib/crypto/secrets.test.ts`

**Interfaces:**
- Consumes: `ENCRYPTION_KEY` (32-byte hex string) via `config.encryptionKey()`.
- Produces: `encryptSecret(plaintext: string): string` and `decryptSecret(payload: string): string`. Payload format: `ivHex:authTagHex:cipherHex`.

- [ ] **Step 1: Write the failing test**

`src/lib/crypto/secrets.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./secrets";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "0".repeat(64); // 32 bytes hex
});

describe("secrets", () => {
  it("round-trips a value", () => {
    const enc = encryptSecret("plaud-token-123");
    expect(enc).not.toContain("plaud-token-123");
    expect(decryptSecret(enc)).toBe("plaud-token-123");
  });

  it("produces distinct ciphertext each call (random IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("rejects tampered payloads", () => {
    const enc = encryptSecret("secret");
    const tampered = enc.slice(0, -2) + (enc.endsWith("00") ? "ff" : "00");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/crypto/secrets.test.ts`
Expected: FAIL ("Cannot find module './secrets'").

- [ ] **Step 3: Implement `src/lib/crypto/secrets.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "@/lib/config";

function key(): Buffer {
  const k = Buffer.from(config.encryptionKey(), "hex");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return k;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/crypto/secrets.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add AES-256-GCM secret encryption util"
```

---

### Task 4: R2 storage layer

**Files:**
- Create: `src/lib/storage/types.ts`, `src/lib/storage/r2.ts`, `src/lib/storage/index.ts`
- Test: `src/lib/storage/r2.test.ts` (unit, key-building + presign), plus a documented live round-trip smoke

**Interfaces:**
- Consumes: `config.r2()`.
- Produces: `Storage` interface — `put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>`, `presignedGetUrl(key: string, ttlSeconds?: number): Promise<string>`, `delete(key: string): Promise<void>`; plus `buildAudioKey(recordingId: string, filename: string): string`. Default export `storage` from `index.ts` (the active backend).

- [ ] **Step 1: Install the S3 SDK**

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Write the interface `src/lib/storage/types.ts`**

```ts
export interface Storage {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  presignedGetUrl(key: string, ttlSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export function buildAudioKey(recordingId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  return `audio/${recordingId}.${ext}`;
}
```

- [ ] **Step 3: Write the failing test for `buildAudioKey`**

`src/lib/storage/r2.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildAudioKey } from "./types";

describe("buildAudioKey", () => {
  it("builds a namespaced key preserving extension", () => {
    expect(buildAudioKey("abc-123", "meeting.mp3")).toBe("audio/abc-123.mp3");
  });
  it("falls back to .bin when no extension", () => {
    expect(buildAudioKey("abc-123", "noext")).toBe("audio/abc-123.bin");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/lib/storage/r2.test.ts`
Expected: FAIL ("Cannot find module './types'").

- [ ] **Step 5: Implement `src/lib/storage/r2.ts` and `index.ts`**

`src/lib/storage/r2.ts`:
```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@/lib/config";
import type { Storage } from "./types";

export function createR2Storage(): Storage {
  const r2 = config.r2();
  const client = new S3Client({
    region: "auto",
    endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });

  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async presignedGetUrl(key, ttlSeconds = 3600) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: r2.bucket, Key: key }), { expiresIn: ttlSeconds });
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
    },
  };
}
```
`src/lib/storage/index.ts`:
```ts
import { createR2Storage } from "./r2";
import type { Storage } from "./types";

let _storage: Storage | undefined;
export function getStorage(): Storage {
  if (!_storage) _storage = createR2Storage();
  return _storage;
}
export { buildAudioKey } from "./types";
export type { Storage } from "./types";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/lib/storage/r2.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Live round-trip smoke (requires R2 creds)**

With `R2_*` set in `.env`, run this one-off script (create `scripts/r2-smoke.ts`, run with `pnpm dlx tsx scripts/r2-smoke.ts`, then delete the script):
```ts
import { getStorage, buildAudioKey } from "@/lib/storage";
const s = getStorage();
const key = buildAudioKey("smoke-test", "x.txt");
await s.put(key, Buffer.from("hello"), "text/plain");
const url = await s.presignedGetUrl(key, 60);
console.log("GET", await (await fetch(url)).text()); // expect "hello"
await s.delete(key);
console.log("ok");
```
Expected: prints `GET hello` then `ok`. Record result in `PROGRESS.md`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/storage
git commit -m "feat: add R2 storage interface and adapter"
```

---

### Task 5: ElevenLabs Scribe transcription adapter

**Files:**
- Create: `src/lib/transcription/types.ts`, `src/lib/transcription/scribe.ts`
- Test: `src/lib/transcription/scribe.test.ts`

**Interfaces:**
- Consumes: `config.elevenLabsApiKey()`. Source for the port: `docs/elevenlabs-provider.ts`.
- Produces: `TranscriptSegment { start; end; text; speaker? }`, `TranscriptResult { text; language?; segments; raw? }`, `wordsToSegments(words): TranscriptSegment[]` (exported for testing), and `transcribeWithScribe(input: { cloudStorageUrl?: string; audioData?: Blob; filename?: string }, options): Promise<TranscriptResult>`.

- [ ] **Step 1: Write `src/lib/transcription/types.ts`**

```ts
export interface TranscriptSegment { start: number; end: number; text: string; speaker?: string; }
export interface TranscriptResult { text: string; language?: string; segments: TranscriptSegment[]; raw?: unknown; }
```

- [ ] **Step 2: Write the failing test for `wordsToSegments`**

`src/lib/transcription/scribe.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { wordsToSegments } from "./scribe";

describe("wordsToSegments", () => {
  it("groups consecutive words by speaker", () => {
    const segs = wordsToSegments([
      { text: "Hallo", start: 0, end: 1, speaker_id: "A" },
      { text: " daar", start: 1, end: 2, speaker_id: "A" },
      { text: "Goeie", start: 2, end: 3, speaker_id: "B" },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ speaker: "A", text: "Hallo daar", start: 0, end: 2 });
    expect(segs[1]).toMatchObject({ speaker: "B", text: "Goeie", start: 2, end: 3 });
  });

  it("drops audio_event tokens", () => {
    const segs = wordsToSegments([
      { text: "(gelach)", type: "audio_event", speaker_id: "A" },
      { text: "Hoi", start: 1, end: 2, type: "word", speaker_id: "A" },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("Hoi");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/transcription/scribe.test.ts`
Expected: FAIL ("Cannot find module './scribe'").

- [ ] **Step 4: Implement `src/lib/transcription/scribe.ts`**

Port `docs/elevenlabs-provider.ts`: copy `ScribeWord`, `ScribeResponse`, `wordsToSegments` (export it), and `transcribeWithScribe` verbatim, changing imports to use `./types` for `TranscriptResult`/`TranscriptSegment` and replacing the inline `apiKey` option with a default from `config.elevenLabsApiKey()`. Keep `diarize` defaulting to `true`, `model_id` defaulting to `"scribe_v2"`, and leave `language_code` unset by default (Dutch auto-detect). Prefer the `cloud_storage_url` path (presigned R2 GET).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/transcription/scribe.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Live smoke (requires ELEVENLABS_API_KEY + sample file)**

Upload the sample Dutch clip to R2 (reuse Task 4's storage), presign it, and call `transcribeWithScribe({ cloudStorageUrl })`. Verify: Dutch text is accurate, multiple `speaker` ids appear, segments have sane timestamps. Record quality notes in `PROGRESS.md`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/transcription
git commit -m "feat: add ElevenLabs Scribe transcription adapter"
```

---

### Task 6: LLM enhancement layer (Vercel AI SDK)

**Files:**
- Create: `src/lib/ai/schema.ts`, `src/lib/ai/enhance.ts`
- Test: `src/lib/ai/enhance.test.ts`

**Interfaces:**
- Consumes: `config.openAiApiKey()`, `config.llmModel()`, a transcript string.
- Produces: `enhancementSchema` (Zod) describing `{ title: string; summary: string; actionItems: string[]; keyPoints: string[] }`; `Enhancement` (inferred type); `enhanceTranscript(transcript: string, opts?: { model?: string }): Promise<Enhancement>`.

- [ ] **Step 1: Install the AI SDK**

```bash
pnpm add ai @ai-sdk/openai zod
```

- [ ] **Step 2: Write `src/lib/ai/schema.ts`**

```ts
import { z } from "zod";

export const enhancementSchema = z.object({
  title: z.string().describe("Korte, beschrijvende titel in het Nederlands"),
  summary: z.string().describe("Beknopte samenvatting in het Nederlands"),
  actionItems: z.array(z.string()).describe("Concrete actiepunten, met spreker indien duidelijk"),
  keyPoints: z.array(z.string()).describe("Belangrijkste besproken punten"),
});

export type Enhancement = z.infer<typeof enhancementSchema>;
```

- [ ] **Step 3: Write the failing test (schema validation, no network)**

`src/lib/ai/enhance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { enhancementSchema } from "./schema";

describe("enhancementSchema", () => {
  it("accepts a well-formed object", () => {
    const parsed = enhancementSchema.parse({
      title: "Wekelijkse sync",
      summary: "Het team besprak de planning.",
      actionItems: ["Jan: stuur de offerte"],
      keyPoints: ["Deadline verschoven"],
    });
    expect(parsed.actionItems).toHaveLength(1);
  });
  it("rejects missing fields", () => {
    expect(() => enhancementSchema.parse({ title: "x" })).toThrow();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/lib/ai/enhance.test.ts`
Expected: FAIL ("Cannot find module './schema'").

- [ ] **Step 5: Implement `src/lib/ai/enhance.ts`**

```ts
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "@/lib/config";
import { enhancementSchema, type Enhancement } from "./schema";

export async function enhanceTranscript(
  transcript: string,
  opts: { model?: string } = {},
): Promise<Enhancement> {
  const openai = createOpenAI({ apiKey: config.openAiApiKey() });
  const model = opts.model ?? config.llmModel();
  const { object } = await generateObject({
    model: openai(model),
    schema: enhancementSchema,
    system:
      "Je bent een assistent die vergaderingen samenvat. Antwoord altijd in het Nederlands. " +
      "De transcriptie is gediarizeerd (sprekers gelabeld); attribueer actiepunten aan de juiste spreker waar mogelijk.",
    prompt: `Transcriptie:\n\n${transcript}`,
  });
  return object;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/lib/ai/enhance.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Live smoke (requires OPENAI_API_KEY)**

Run `enhanceTranscript` against the Task 5 sample transcript. Verify Dutch output, sensible title/summary/action items. Record in `PROGRESS.md`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai
git commit -m "feat: add LLM enhancement layer via Vercel AI SDK"
```

---

### Task 7: Pipeline route handlers

**Files:**
- Create: `src/app/api/recordings/route.ts`, `src/app/api/recordings/[id]/transcribe/route.ts`, `src/app/api/recordings/[id]/enhance/route.ts`, `src/app/api/recordings/[id]/audio/route.ts`, `src/lib/pipeline.ts`
- Test: `src/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `db`, `getStorage`, `buildAudioKey`, `transcribeWithScribe`, `enhanceTranscript`.
- Produces: `runTranscription(recordingId: string): Promise<void>` and `runEnhancement(recordingId: string): Promise<void>` in `src/lib/pipeline.ts` (status transitions + persistence, testable with mocks). Route handlers thin-wrap these. `POST /api/recordings` (multipart: `file`, `title?`) → creates row, stores audio, kicks transcription. `GET /api/recordings` → list. `POST /api/recordings/[id]/transcribe`, `POST .../enhance` → re-run a stage. `GET /api/recordings/[id]/audio` → 302 to presigned URL.

- [ ] **Step 1: Read the Next.js 16 route-handler docs**

```bash
ls node_modules/next/dist/docs/
```
Confirm the exact `route.ts` export signature and how dynamic `params` are accessed (they may be a `Promise` in Next.js 16). Use the installed-doc form in every handler below.

- [ ] **Step 2: Write the failing test for `runTranscription` status flow**

`src/lib/pipeline.test.ts` (mock db + adapters; verify status transitions and that a thrown adapter sets `status='error'`):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updates: any[] = [];
vi.mock("@/db", () => ({
  db: {
    update: () => ({ set: (v: any) => ({ where: async () => { updates.push(v); } }) }),
    query: { recordings: { findFirst: async () => ({ id: "r1", storageKey: "audio/r1.mp3" }) } },
    insert: () => ({ values: async () => {} }),
  },
}));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({ presignedGetUrl: async () => "https://signed" }),
  buildAudioKey: () => "audio/r1.mp3",
}));
vi.mock("@/lib/transcription/scribe", () => ({
  transcribeWithScribe: vi.fn(async () => ({ text: "hoi", language: "nld", segments: [] })),
}));

beforeEach(() => { updates.length = 0; });

describe("runTranscription", () => {
  it("sets transcribing then transcribed", async () => {
    const { runTranscription } = await import("./pipeline");
    await runTranscription("r1");
    expect(updates.map((u) => u.status)).toEqual(["transcribing", "transcribed"]);
  });

  it("sets error when the adapter throws", async () => {
    const scribe = await import("@/lib/transcription/scribe");
    (scribe.transcribeWithScribe as any).mockRejectedValueOnce(new Error("boom"));
    const { runTranscription } = await import("./pipeline");
    await runTranscription("r1");
    expect(updates.at(-1).status).toBe("error");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/pipeline.test.ts`
Expected: FAIL ("Cannot find module './pipeline'").

- [ ] **Step 4: Implement `src/lib/pipeline.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings, transcriptions, aiEnhancements } from "@/db/schema";
import { getStorage } from "@/lib/storage";
import { transcribeWithScribe } from "@/lib/transcription/scribe";
import { enhanceTranscript } from "@/lib/ai/enhance";
import { config } from "@/lib/config";

async function setStatus(id: string, status: string, errorMessage: string | null = null) {
  await db.update(recordings).set({ status, errorMessage }).where(eq(recordings.id, id));
}

export async function runTranscription(id: string): Promise<void> {
  try {
    await setStatus(id, "transcribing");
    const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, id) });
    if (!rec) throw new Error(`recording ${id} not found`);
    const url = await getStorage().presignedGetUrl(rec.storageKey, 3600);
    const result = await transcribeWithScribe({ cloudStorageUrl: url });
    await db.insert(transcriptions).values({
      recordingId: id, fullText: result.text, language: result.language ?? null, segments: result.segments,
    });
    await setStatus(id, "transcribed");
  } catch (e) {
    await setStatus(id, "error", e instanceof Error ? e.message : String(e));
  }
}

export async function runEnhancement(id: string): Promise<void> {
  try {
    await setStatus(id, "enhancing");
    const t = await db.query.transcriptions.findFirst({ where: eq(transcriptions.recordingId, id) });
    if (!t) throw new Error(`transcription for ${id} not found`);
    const e = await enhanceTranscript(t.fullText);
    await db.insert(aiEnhancements).values({
      recordingId: id, title: e.title, summary: e.summary,
      actionItems: e.actionItems, keyPoints: e.keyPoints, model: config.llmModel(),
    });
    await setStatus(id, "done");
  } catch (err) {
    await setStatus(id, "error", err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/lib/pipeline.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Implement the route handlers**

Use the Next.js 16 signatures confirmed in Step 1. `src/app/api/recordings/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { getStorage, buildAudioKey } from "@/lib/storage";
import { runTranscription, runEnhancement } from "@/lib/pipeline";

export async function GET() {
  const rows = await db.query.recordings.findMany();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  const title = (form.get("title") as string) || file.name;

  const [rec] = await db.insert(recordings).values({
    title, source: "upload", storageKey: "pending", contentType: file.type || "application/octet-stream",
  }).returning();

  const key = buildAudioKey(rec.id, file.name);
  await getStorage().put(key, Buffer.from(await file.arrayBuffer()), rec.contentType);
  await db.update(recordings).set({ storageKey: key }).where(eq(recordings.id, rec.id));

  // fire-and-forget the pipeline (Phase 0: route stays warm long enough on Railway)
  runTranscription(rec.id).then(() => runEnhancement(rec.id)).catch(() => {});
  return NextResponse.json({ id: rec.id }, { status: 201 });
}
```
(Add `import { eq } from "drizzle-orm";`.) `src/app/api/recordings/[id]/transcribe/route.ts` and `.../enhance/route.ts` call `runTranscription`/`runEnhancement` for the param id and return `{ ok: true }`. `src/app/api/recordings/[id]/audio/route.ts` looks up the recording, presigns its `storageKey`, and returns `NextResponse.redirect(url)`.

- [ ] **Step 7: Run the full suite (expect PASS)**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add recording pipeline routes (upload/transcribe/enhance/audio)"
```

---

### Task 8: Minimal UI

**Files:**
- Create: `src/app/page.tsx`, `src/app/upload/page.tsx`, `src/app/recordings/[id]/page.tsx`
- Modify: `src/app/layout.tsx` (nav link)
- Add shadcn components as needed.

**Interfaces:**
- Consumes: the Task 7 API routes. Server components fetch via `db` directly where convenient; the upload form posts multipart to `POST /api/recordings`.

- [ ] **Step 1: Add shadcn components**

```bash
pnpm dlx shadcn@latest add button card input
```

- [ ] **Step 2: Recordings list `src/app/page.tsx`**

Server component: query `db.query.recordings.findMany()` (newest first), render a `Card` per recording with title, created date, and `status` badge, linking to `/recordings/[id]`. Include a header link to `/upload`.

- [ ] **Step 3: Upload form `src/app/upload/page.tsx`**

Client component with a file `Input`, optional title `Input`, and a submit `Button` that POSTs `FormData` to `/api/recordings`, then redirects to `/recordings/[id]` on the returned id. Show a basic uploading state.

- [ ] **Step 4: Detail page `src/app/recordings/[id]/page.tsx`**

Server component (use the Next.js 16 async-params form from Task 7 Step 1): load the recording, its transcription, and its latest `ai_enhancements` row. Render:
- An HTML5 `<audio controls src="/api/recordings/[id]/audio">`.
- Summary card: title, summary, action items list, key points list (or "in behandeling…" if status not `done`).
- Transcript: segments rendered as `Speaker {speaker}: {text}` with `start` timestamps.
- If `status === 'error'`, show `errorMessage` and a "Retry" button hitting the transcribe route.

- [ ] **Step 5: Manual verification**

Run `pnpm dev`. Upload the sample Dutch file. Confirm: it appears in the list, status advances to `done`, audio plays, transcript shows speakers, summary is good Dutch. Record in `PROGRESS.md`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add minimal recordings UI (list, upload, detail)"
```

---

### Task 9: Better Auth (single-user, no email)

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/login/page.tsx`, `src/middleware.ts`, `src/lib/auth-client.ts`
- Modify: `src/db/schema.ts` (Better Auth tables via its generator) + migration

**Interfaces:**
- Produces: a protected app — all routes except `/login` and `/api/auth/*` require a session. Single seeded user; sign-in via email/password (verification off) and optional passkey.

- [ ] **Step 1: Read the Better Auth skill + install**

Invoke the `better-auth-best-practices` skill (and `better-auth-security-best-practices`) for current config patterns. Then:
```bash
pnpm add better-auth
```

- [ ] **Step 2: Configure `src/auth.ts`**

Single-user, email/password, **`emailVerification` disabled, no email reset**, Drizzle adapter against `db`. Optionally enable the passkey plugin. Set `BETTER_AUTH_SECRET` (generate: `openssl rand -hex 32`) and `BETTER_AUTH_URL` in `.env`. Follow the exact shape the skill specifies (it overrides any guess here).

- [ ] **Step 3: Generate + run Better Auth's schema migration**

Use Better Auth's CLI/generator to emit its tables, then `pnpm db:generate && pnpm db:migrate`. Expected: auth tables created.

- [ ] **Step 4: Mount the handler + middleware**

`src/app/api/auth/[...all]/route.ts` mounts Better Auth's handler. `src/middleware.ts` redirects unauthenticated requests to `/login` (allowlist `/login`, `/api/auth`). `src/app/login/page.tsx` is an email/password form (+ passkey button if enabled) using `src/lib/auth-client.ts`.

- [ ] **Step 5: Seed the single user**

Create a one-off `scripts/seed-user.ts` that signs up your account (email + password from env), run it once with `pnpm dlx tsx scripts/seed-user.ts`, then delete it. Document the credentials location in `PROGRESS.md` (not the values).

- [ ] **Step 6: Manual verification**

Run `pnpm dev`. Confirm: visiting `/` redirects to `/login`; after login the recordings UI loads; logout works; the pipeline still runs end-to-end while authenticated.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Better Auth single-user login (no email flows)"
```

---

### Task 10: Deploy to Railway

**Files:**
- Create: `railway.json` or Railway dashboard config; update `PROGRESS.md`
- Modify: `package.json` (ensure `build`/`start` scripts; add a release/migrate step)

**Interfaces:**
- Produces: a public Railway URL serving Engram behind login, backed by managed Postgres, with the full pipeline working from a phone.

- [ ] **Step 1: Provision Railway services**

Create a Railway project: an app service (this repo) + a managed Postgres plugin. Confirm Railway injects `DATABASE_URL`.

- [ ] **Step 2: Set environment variables**

In the app service, set: `DATABASE_URL` (from the Postgres plugin), `ENCRYPTION_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `LLM_MODEL`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the Railway URL).

- [ ] **Step 3: Configure build + release migration**

Ensure `pnpm build` / `pnpm start` work. Add a release/deploy step that runs `pnpm db:migrate` before start (Railway "pre-deploy command" or a start script that migrates then starts). Verify the build uses pnpm (lockfile committed).

- [ ] **Step 4: Deploy + seed**

Trigger a deploy. Once live, run the user-seed step against the production DB (one-off, then ensure it can't re-run). Confirm migrations applied.

- [ ] **Step 5: End-to-end verification from a phone**

On your phone: open the Railway URL → log in → upload the sample Dutch file → confirm it transcribes, summarizes, plays back, and shows speakers. This is the Phase 0 acceptance test.

- [ ] **Step 6: Finalize PROGRESS.md + commit + open PR**

Check off all Phase 0 items in `PROGRESS.md`, note the live URL location (not secrets), commit, and merge/PR the `phase-0` branch.

```bash
git add -A
git commit -m "feat: deploy Engram Phase 0 to Railway"
```

---

## Self-Review

**Spec coverage:**
- Stack/pnpm/shadcn → Task 1. Postgres+Drizzle schema (all 7 tables) → Task 2. AES-256-GCM → Task 3. R2 storage interface → Task 4. Scribe v2 diarized adapter → Task 5. Vercel AI SDK + structured output → Task 6. Pipeline + status/error handling → Task 7. Minimal UI (list/upload/detail + audio) → Task 8. Better Auth single-user no-email → Task 9. Railway deploy + phone acceptance → Task 10. All spec sections map to a task.
- Spec "out of scope" items (waveform, search, export, MCP sync, worker) are correctly absent.
- `api_credentials`/`sync_state` created but unused in Phase 0 — matches spec intent (reserved for Phase 1); encryption util built now per spec.

**Placeholder scan:** No "TBD/TODO/handle edge cases" left as instructions. The few "follow the skill's exact shape" notes (Next.js 16 docs in Tasks 1/7, Better Auth skill in Task 9) are deliberate deference to authoritative installed sources, not vague placeholders — they name the exact source and what to confirm.

**Type consistency:** `Storage` methods (`put`/`presignedGetUrl`/`delete`) consistent across Tasks 4 and 7. `buildAudioKey` signature consistent. `TranscriptResult`/`TranscriptSegment` shared via `transcription/types.ts` (Task 5) and consumed in Task 7. `Enhancement` fields (`title`/`summary`/`actionItems`/`keyPoints`) consistent across Tasks 6, 7, 8. `runTranscription`/`runEnhancement` signatures consistent across Tasks 7's tests, impl, and route handlers. Schema column names (`storageKey`, `recordingId`, etc.) consistent throughout.
