\set ON_ERROR_STOP on

-- Read-only post-backfill and soak audit. Every null/orphan count must be zero.
SELECT 'recordings' AS table_name, count(*) FILTER (WHERE owner_id IS NULL) AS null_owners FROM recordings
UNION ALL SELECT 'api_credentials', count(*) FILTER (WHERE owner_id IS NULL) FROM api_credentials
UNION ALL SELECT 'user_settings', count(*) FILTER (WHERE owner_id IS NULL) FROM user_settings
UNION ALL SELECT 'sync_state', count(*) FILTER (WHERE owner_id IS NULL) FROM sync_state
UNION ALL SELECT 'glossary', count(*) FILTER (WHERE owner_id IS NULL) FROM glossary
UNION ALL SELECT 'backups', count(*) FILTER (WHERE owner_id IS NULL) FROM backups
UNION ALL SELECT 'speakers', count(*) FILTER (WHERE owner_id IS NULL) FROM speakers
ORDER BY table_name;

SELECT 'recordings' AS relation_name, count(*) AS orphan_count
FROM recordings r LEFT JOIN "user" u ON u.id = r.owner_id
WHERE r.owner_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'api_credentials', count(*)
FROM api_credentials x LEFT JOIN "user" u ON u.id = x.owner_id
WHERE x.owner_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'user_settings', count(*)
FROM user_settings x LEFT JOIN "user" u ON u.id = x.owner_id
WHERE x.owner_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'sync_state', count(*)
FROM sync_state x LEFT JOIN "user" u ON u.id = x.owner_id
WHERE x.owner_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'glossary', count(*)
FROM glossary x LEFT JOIN "user" u ON u.id = x.owner_id
WHERE x.owner_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'backups', count(*)
FROM backups x LEFT JOIN "user" u ON u.id = x.owner_id
WHERE x.owner_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'speakers', count(*)
FROM speakers x LEFT JOIN "user" u ON u.id = x.owner_id
WHERE x.owner_id IS NOT NULL AND u.id IS NULL;

SELECT count(*) AS invalid_connection_attributions
FROM recordings r
LEFT JOIN auth_connections c
  ON c.id = r.created_by_connection_id AND c.owner_id = r.owner_id
WHERE r.created_by_connection_id IS NOT NULL AND c.id IS NULL;

SELECT count(*) AS mismatched_speaker_mappings
FROM recording_speakers rs
JOIN recordings r ON r.id = rs.recording_id
JOIN speakers s ON s.id = rs.speaker_id
WHERE r.owner_id IS DISTINCT FROM s.owner_id;

SELECT owner_id, lower(btrim(name)) AS normalized_name, count(*) AS duplicate_count
FROM speakers
GROUP BY owner_id, lower(btrim(name))
HAVING count(*) > 1;
