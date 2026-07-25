# Engram Compact Web UI and AI Titles

This rollout keeps the existing authentication and recording pipeline intact while modernizing the web experience and adding reversible generated titles shared by web and macOS.

## Safety rules

- Never overwrite user-entered or Plaud-provided titles.
- Preserve every pre-migration title in `recordings.original_title` before changing it.
- Limit automatic replacement to device, filename, or previously generated titles.
- Keep the Mac OAuth scopes unchanged; title refresh uses its existing connection-owned write authorization.
- Run schema migration before application traffic reaches code that reads the new columns.
- Verify web, API, and Swift tests before deployment.

## Phase 1 — Isolated foundation

- [x] Create `codex/compact-web-ai-titles` from clean `main`.
- [x] Select option 2 as the visual source of truth.
- [x] Record the compact-density requirement.
- [x] Document the phased rollout and rollback constraints.

## Phase 2 — Compact web experience

- [x] Replace the basic header with a compact responsive application header.
- [x] Add functional global search, active navigation, icon-led controls, and a compact account action.
- [x] Replace recording cards with a denser library list.
- [x] Restyle search results as grouped, compact recording matches.
- [x] Build the responsive side-by-side recording detail layout.
- [x] Add compact playback controls and transcript filtering.
- [x] Run browser-based design QA against option 2 and fix P0–P2 drift.

## Phase 3 — Reversible generated titles

- [x] Add `original_title` and `title_origin` with a constrained provenance model.
- [x] Preserve all existing titles during migration.
- [x] Classify existing Mac titles as device titles and Plaud titles as provider titles.
- [x] Backfill existing Mac recordings from their latest saved enhancement title.
- [x] Mark new web, Mac, and Plaud titles with their correct origin.
- [x] Apply generated titles only to replaceable origins.
- [x] Generate embeddings after the recording title has been updated.
- [x] Run migration and pipeline tests.

## Phase 4 — macOS title synchronization

- [x] Add a connection-owned processing metadata endpoint using existing OAuth scopes.
- [x] Poll after upload until processing completes.
- [x] Refresh uploaded titles once on app launch.
- [x] Persist generated titles in the existing atomic local archive.
- [x] Run Swift tests and build the Mac package.

## Phase 5 — Release

- [x] Review the final diff for unrelated or destructive changes.
- [x] Commit with conventional commit messages.
- [x] Push the feature branch and open a pull request.
- [x] Merge after checks pass.
- [x] Verify Railway migration and deployment.
- [ ] Smoke-test one new Mac recording end to end before removing any compatibility code.

## Phase 6 — Production refinements

- [x] Audit the recordings that did not visibly adopt generated titles.
- [x] Confirm all prior titles remain preserved before widening conversion.
- [x] Remove generated-title badges and sparkle provenance from the interface.
- [x] Remove manual upload from navigation and redirect the retired page.
- [x] Group multiple active OAuth grants into one connected-app entry.
- [x] Run web, API, migration, and browser verification.
- [x] Merge and verify the Railway deployment.

## Rollback

Rolling back the application does not require rolling back data. The migration only adds columns and updates replaceable Mac titles after copying the prior title into `original_title`. A follow-up rollback can restore generated rows with:

```sql
UPDATE recordings
SET title = original_title,
    title_origin = CASE WHEN source = 'mac' THEN 'device' ELSE 'legacy' END
WHERE title_origin = 'generated'
  AND original_title IS NOT NULL;
```
