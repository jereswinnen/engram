\set ON_ERROR_STOP on

\if :{?owner_id}
\else
  \echo 'owner_id is required'
  \quit 3
\endif
\if :{?owner_email}
\else
  \echo 'owner_email is required'
  \quit 3
\endif

-- Phase 1A ownership backfill. Migration 0010 must already be applied. The
-- transaction is all-or-nothing, chooses an existing owner by exact ID/email, and
-- contains no DELETE, DROP, or TRUNCATE statements.
BEGIN;

LOCK TABLE recordings, api_credentials, user_settings, sync_state,
  glossary, backups, speakers, auth_connections
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _engram_backfill_owner (
  id text PRIMARY KEY,
  email text NOT NULL
) ON COMMIT DROP;

INSERT INTO _engram_backfill_owner (id, email)
SELECT id, email
FROM "user"
WHERE id = :'owner_id' AND lower(email) = lower(:'owner_email');

DO $$
DECLARE
  owner_count integer;
BEGIN
  SELECT count(*) INTO owner_count FROM _engram_backfill_owner;
  IF owner_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one existing user for owner_id/owner_email; found %', owner_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM speakers
    GROUP BY lower(btrim(name))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Case-insensitive duplicate speaker names require an explicit, non-destructive resolution before backfill';
  END IF;
END $$;

INSERT INTO auth_connections (
  id,
  owner_id,
  mechanism,
  provider,
  client_id,
  provider_grant_id,
  label,
  status,
  scopes,
  metadata
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  id,
  'legacy-mac',
  'engram',
  'engram-macos-legacy',
  '00000000-0000-4000-8000-000000000001',
  'Legacy Mac recorder',
  'active',
  '["recordings:write", "recordings:delete-own"]'::jsonb,
  '{"contains_inferred_source_backfill": true}'::jsonb
FROM _engram_backfill_owner
ON CONFLICT (id) DO NOTHING;

UPDATE auth_connections
SET metadata = coalesce(metadata, '{}'::jsonb)
  || '{"contains_inferred_source_backfill": true}'::jsonb
WHERE id = '00000000-0000-4000-8000-000000000001'::uuid
  AND owner_id = (SELECT id FROM _engram_backfill_owner);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth_connections c
    JOIN _engram_backfill_owner o ON o.id = c.owner_id
    WHERE c.id = '00000000-0000-4000-8000-000000000001'::uuid
      AND c.mechanism = 'legacy-mac'
      AND c.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Synthetic legacy connection exists with unexpected ownership or state';
  END IF;
END $$;

UPDATE recordings SET owner_id = (SELECT id FROM _engram_backfill_owner)
WHERE owner_id IS NULL;
UPDATE api_credentials SET owner_id = (SELECT id FROM _engram_backfill_owner)
WHERE owner_id IS NULL;
UPDATE user_settings SET owner_id = (SELECT id FROM _engram_backfill_owner)
WHERE owner_id IS NULL;
UPDATE sync_state SET owner_id = (SELECT id FROM _engram_backfill_owner)
WHERE owner_id IS NULL;
UPDATE glossary SET owner_id = (SELECT id FROM _engram_backfill_owner)
WHERE owner_id IS NULL;
UPDATE backups SET owner_id = (SELECT id FROM _engram_backfill_owner)
WHERE owner_id IS NULL;
UPDATE speakers SET owner_id = (SELECT id FROM _engram_backfill_owner)
WHERE owner_id IS NULL;
UPDATE speakers SET normalized_name = lower(btrim(name))
WHERE normalized_name IS NULL
  AND owner_id = (SELECT id FROM _engram_backfill_owner);
UPDATE recordings
SET created_by_connection_id = '00000000-0000-4000-8000-000000000001'::uuid
WHERE source = 'mac'
  AND owner_id = (SELECT id FROM _engram_backfill_owner)
  AND created_by_connection_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM recordings WHERE owner_id IS NULL
    UNION ALL SELECT 1 FROM api_credentials WHERE owner_id IS NULL
    UNION ALL SELECT 1 FROM user_settings WHERE owner_id IS NULL
    UNION ALL SELECT 1 FROM sync_state WHERE owner_id IS NULL
    UNION ALL SELECT 1 FROM glossary WHERE owner_id IS NULL
    UNION ALL SELECT 1 FROM backups WHERE owner_id IS NULL
    UNION ALL SELECT 1 FROM speakers WHERE owner_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Ownership backfill left null owner rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM recordings r
    LEFT JOIN auth_connections c
      ON c.id = r.created_by_connection_id AND c.owner_id = r.owner_id
    WHERE r.created_by_connection_id IS NOT NULL AND c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Connection attribution audit failed';
  END IF;
END $$;

COMMIT;
