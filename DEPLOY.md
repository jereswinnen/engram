# Engram — Railway Deployment Runbook

End-to-end instructions for getting Engram live on Railway with managed Postgres and
Cloudflare R2 storage. Follow steps in order.

---

## 1. Create Railway project + Postgres plugin

1. Create a new project at [railway.com](https://railway.com).
2. Click **+ Add** → **Database** → **PostgreSQL** to provision a managed Postgres instance.
3. Click **+ Add** → **GitHub repo** (or **Deploy from template**) and point it at this repo.
4. In the app service, open **Variables**. Railway automatically injects `DATABASE_URL`
   from the Postgres plugin — confirm it appears before continuing.

---

## 2. Generate secrets

Run locally (requires OpenSSL):

```bash
openssl rand -hex 32   # paste as ENCRYPTION_KEY
openssl rand -hex 32   # paste as BETTER_AUTH_SECRET
```

Each produces 64 hex characters (32 bytes of entropy).

---

## 3. Set environment variables in the Railway app service

Set every variable below under **Variables** → **Raw Editor** (or one by one).
All are required at startup; the app will throw at boot if any are missing.

```
# Injected automatically by the Postgres plugin — verify it is present:
DATABASE_URL=<injected by Railway Postgres plugin>

# AES-256-GCM encryption key — 64 hex chars (openssl rand -hex 32)
ENCRYPTION_KEY=<64 hex chars>

# ElevenLabs Scribe v2
ELEVENLABS_API_KEY=<your ElevenLabs key>

# LLM (OpenAI)
OPENAI_API_KEY=<your OpenAI key>
LLM_MODEL=gpt-5.4-mini-2026-03-17

# Cloudflare R2 (see Section 4)
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<R2 key id>
R2_SECRET_ACCESS_KEY=<R2 secret>
R2_BUCKET=engram

# Better Auth — set both to your Railway public URL
# (e.g. https://engram.up.railway.app — no trailing slash)
BETTER_AUTH_SECRET=<64 hex chars>
BETTER_AUTH_URL=https://<your-service>.up.railway.app
NEXT_PUBLIC_APP_URL=https://<your-service>.up.railway.app
```

> **Note:** `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must be the same Railway public
> URL (no trailing slash). Railway generates the domain under **Settings → Networking →
> Public domain** — generate it before setting these vars if you haven't already.

---

## 4. Cloudflare R2 — create bucket + API token

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com).
2. Navigate to **R2 Object Storage** → **Create bucket**. Name it `engram` (or anything;
   set the same name in `R2_BUCKET`).
3. In R2, go to **Manage R2 API tokens** → **Create API token**.
   - Permissions: **Object Read & Write** scoped to the `engram` bucket.
   - Copy the **Access Key ID** → `R2_ACCESS_KEY_ID`.
   - Copy the **Secret Access Key** → `R2_SECRET_ACCESS_KEY`.
4. The endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` — find your account ID
   in the R2 overview page URL or under **Account Home** in the sidebar.

---

## 5. Build + migration

`railway.json` configures a `preDeployCommand` that runs `pnpm db:migrate` via
Drizzle Kit **before** the new container starts serving traffic on every deploy.
This means schema migrations are always applied before code that depends on them.

The build command Railway detects automatically from `package.json`:
- **build**: `next build` (Turbopack, Next.js 16)
- **start**: `next start`
- **preDeployCommand**: `pnpm db:migrate`

You do not need to run migrations manually — Railway runs them automatically.

> **Manual fallback** (only if `preDeployCommand` does not execute): open a Railway
> one-off shell for the app service and run:
> ```bash
> pnpm db:migrate
> ```

---

## 6. Trigger first deploy + confirm

1. Push to the connected branch (or click **Deploy** in the Railway dashboard).
2. In the **Deploy logs**, you should see `drizzle-kit migrate` output (all tables
   applied) followed by the Next.js server starting.
3. Visit your public URL — you should see the login page.

---

## 7. Seed the single admin user (run ONCE, then delete the script)

The app has no self-registration (sign-up is disabled). Seed the one admin account
from your local machine with `DATABASE_URL`, `BETTER_AUTH_SECRET`, and
`BETTER_AUTH_URL` pointing at **production**. The script bypasses the public
sign-up endpoint by writing directly via Better Auth's internal adapter:

```bash
# Set these to match your Railway env vars:
export DATABASE_URL="<Railway Postgres connection string>"
export BETTER_AUTH_SECRET="<your secret>"
export BETTER_AUTH_URL="https://<your-service>.up.railway.app"
export SEED_EMAIL="you@example.com"
export SEED_PASSWORD="<strong password, min 8 chars>"
export SEED_NAME="Admin"          # optional, defaults to "Admin"

pnpm dlx tsx scripts/seed-user.ts
```

After the script prints `User created: you@example.com`:

```bash
git rm scripts/seed-user.ts
git commit -m "chore: remove seed-user script after first deploy"
git push
```

This triggers a re-deploy (migrations are a no-op now that tables exist).

---

## 8. Post-deploy smoke tests (run from a phone)

Once logged in, run through each of the following manually:

- [ ] **R2 round-trip**: upload any audio file → confirm the recording appears in the
  list and the audio plays back (the file was stored in and retrieved from R2).
- [ ] **ElevenLabs Scribe**: upload the sample Dutch audio file → confirm transcript
  segments appear with speaker labels (diarization working).
- [ ] **OpenAI enhancement**: confirm the recording detail shows a generated title,
  summary, action items, and key points.
- [ ] **Full phone end-to-end**: on your phone, open the Railway URL → log in → upload a
  new Dutch audio clip → wait for transcription + enhancement → verify all four fields
  appear + audio plays back behind login.

---

## Phase 1 — Plaud MCP sync

Engram can now automatically pull recordings from your Plaud account (using the
**official Plaud MCP** with interactive OAuth) and run them through the Phase 0 pipeline
(Scribe transcription + LLM enhancement). This section covers setup.

### 1. Set `CRON_SECRET` in Railway

In the Railway app service, add this variable under **Variables**:

- **`CRON_SECRET`** — Required. This is a shared secret that authorizes the cron job to
  call `/api/sync`. Generate locally:
  ```bash
  openssl rand -hex 32
  ```
  Copy the output and paste it as the value. Store this securely; you'll need it for the
  cron schedule below. Do **not** commit it to git.

### 2. Connect to Plaud via OAuth

1. Log in to your Engram instance (deployed on Railway).
2. Click **Settings** in the header.
3. Under **Plaud**, click **"Verbind met Plaud"** (Connect with Plaud).
4. You will be redirected to the Plaud authorization window. Authorize Engram to access
   your recordings.
5. You will be redirected back to Engram with the connection established. The UI will
   show connection status.
6. If you see "Verbonden" (Connected), you're ready to sync. If you see an error,
   check that your Plaud account has OAuth enabled (dynamic client registration is
   supported; manual client registration via Plaud's dashboard is the fallback).

> **Note:** Engram securely encrypts and stores your OAuth credentials. The redirect
> URI is automatically set to `<NEXT_PUBLIC_APP_URL>/api/plaud/callback`.

### 3. Manual sync (optional, for testing)

- On the **Settings** page under **Plaud**, click the **"Nu synchroniseren"** (Sync now)
  button to trigger an immediate sync. This uses your logged-in session for authorization.
- The sync will list all new recordings from your Plaud account (since the last sync
  checkpoint), download each audio, insert them into Engram, and run transcription +
  enhancement via the existing Phase 0 pipeline.

### 4. Automated sync via cron (Railway)

To sync **automatically on a schedule**, configure a Railway **cron job** that calls
`POST /api/sync` every 15 minutes (or your preferred interval).

Railway crons are managed via the **Railway dashboard** (not yet in `railway.json` schema).

1. In the Railway dashboard, go to **Deployments** → your app service.
2. In the left sidebar, select **Cron Jobs** (or navigate to the service **Settings**).
3. Create a new cron job with these settings:
   - **Schedule:** `*/15 * * * *` (every 15 minutes. Adjust as needed.)
   - **Command:**
     ```bash
     curl -fsS -X POST https://<your-service>.up.railway.app/api/sync \
       -H "Authorization: Bearer <CRON_SECRET>"
     ```
     Replace `<your-service>` with your Railway public domain (e.g., `engram.up.railway.app`)
     and `<CRON_SECRET>` with the secret you generated in Step 1 above.

> **Tip:** Use the exact `CRON_SECRET` value from Railway's **Variables** section for
> this header. The cron job runs outside your app container, so it can't read env vars
> directly — pass it explicitly in the command.

### 5. Verify the sync works

After setting `CRON_SECRET` and creating the cron job:
- **Manual verify:** Log in to Engram → **Settings** → click **"Nu synchroniseren"**
  and watch the last-sync timestamp and counts update.
- **Auto verify:** Wait 15 minutes (or your cron interval) and check Settings to see if
  the "Last synced at" timestamp advances. If it stays the same, check the Railway cron
  job logs for errors.

### 6. Live-verification checklist (deferred until first real recording)

The Plaud MCP integration is complete, but end-to-end validation occurs once you sync
a real recording:

- [ ] **OAuth authorize + list working live** — Complete the OAuth flow in Settings;
      if the UI shows "Verbonden", authorization is working. Click "Sync now" if you
      have no recordings yet; Engram will show "0 new" without error if ready.
- [ ] **Download + transcribe + enhance** — Sync after making your first test recording
      on Plaud. Engram will download the audio, run it through Scribe (transcription),
      and enhance it with LLM. This validates the end-to-end MCP→download→process pipeline.

---

## Scheduled sync (Railway cron service)

New recordings (and their transcription + AI enhancement) are picked up
automatically by an hourly cron service that calls `POST /api/sync`.

One-time setup:
1. Generate a strong random secret and set `CRON_SECRET` on the **web** service.
2. In the same Railway project, **New → Service → from the same GitHub repo**.
3. On that service: **Settings → Cron Schedule = `0 * * * *`**;
   **Start Command = `node scripts/sync-cron.mjs`**.
4. Set its env vars: `CRON_SECRET` (same value as the web service) and
   `APP_URL` = the web app's public URL (e.g. `https://engram-production.up.railway.app`).
5. Save. Railway runs it hourly; it POSTs `/api/sync` then exits. Run history
   and logs appear on that service; the sync outcome also shows in Settings.

A run that overlaps an in-progress sync is skipped (the `runningSince` guard);
a crashed run self-heals after 30 minutes.

---

## Phase 2 — Glossary

The Glossary feature allows you to define domain-specific terminology and aliases
that Engram uses to improve transcription accuracy and consistency. This section covers setup and usage.

### 1. Manage glossary terms in Settings

1. Log in to Engram.
2. Click **Settings** in the header.
3. Under **Glossary**, add, edit, or delete terms:
   - **Term** — the canonical form (e.g., "TypeScript").
   - **Aliases** (optional) — comma-separated alternate spellings or pronunciations
     (e.g., "Type Script, typescript"). Aliases are automatically corrected to the canonical form in transcripts.

### 2. Transcription cost note

When your glossary is non-empty, Engram sends the glossary terms to ElevenLabs Scribe
as `keyterms`. This biases transcription toward your domain terminology and improves
accuracy. **Important:** using `keyterms` adds approximately **20% to Scribe transcription cost**.
If cost is a concern, keep your glossary empty (no-op, zero overhead) or use it selectively.

### 3. Behavior

- **New recordings only** — glossary applies to recordings uploaded after terms are added.
  Existing transcripts are not reprocessed.
- **Alias correction** — all aliases are deterministically corrected to their canonical form
  in the final transcript.
- **Summary injection** — glossary terms are included in the prompt that generates the recording summary.

---

## Phase 1+ — Export & Backup

Engram provides per-recording export (Markdown, JSON, copy to clipboard) and a full backup feature that archives all recordings and metadata as a zip file to R2.

### Backup storage and generation

- **Storage location:** Backups are stored in R2 under the `backups/` prefix (same bucket as recordings).
- **Async generation:** Backup creation is fire-and-forget. When a user initiates a backup, the request queues the job on the persistent container and returns immediately with a backup ID. The job runs asynchronously, compressing recordings + metadata into a zip, uploading to R2, and storing the result metadata in the `backups` table.
- **No new env vars:** Backup uses the existing R2 credentials (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). No additional configuration is needed.
- **Migration:** The `backups` table is created by migration `0005` and is applied automatically by the existing `preDeployCommand: pnpm db:migrate` on every deploy.

---

## Known footguns

- **Local `next build` / `pnpm dev` without env vars set will throw at import time.**
  `lib/config.ts` and `auth.ts` read env eagerly; this is intentional — fail fast.
  Always copy `.env.example` to `.env.local` and fill in real values before running
  locally.

- **`BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must be identical** (both = the Railway
  public URL). Mismatched values cause auth redirects to fail.

- **Single-instance only for Phase 0.** The preDeploy migration is safe for one replica.
  If you ever scale to multiple replicas, run migrations as a separate one-off task
  before updating the service.

- **`CRON_SECRET` is a production secret.** Do not commit it to git or `.env.local`.
  Store it only in Railway's **Variables** dashboard. If compromised, regenerate it
  with `openssl rand -hex 32`, update Railway, and restart the cron job.
