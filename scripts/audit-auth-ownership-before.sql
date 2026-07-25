\set ON_ERROR_STOP on

-- Read-only Phase 1 preflight. Run before deploying migration 0010 and save the
-- output with the deployment record. This script never changes data.
SELECT id, email, name, created_at
FROM "user"
ORDER BY created_at;

SELECT 'recordings' AS table_name, count(*) AS row_count FROM recordings
UNION ALL SELECT 'api_credentials', count(*) FROM api_credentials
UNION ALL SELECT 'user_settings', count(*) FROM user_settings
UNION ALL SELECT 'sync_state', count(*) FROM sync_state
UNION ALL SELECT 'glossary', count(*) FROM glossary
UNION ALL SELECT 'backups', count(*) FROM backups
UNION ALL SELECT 'speakers', count(*) FROM speakers
UNION ALL SELECT 'transcriptions', count(*) FROM transcriptions
UNION ALL SELECT 'ai_enhancements', count(*) FROM ai_enhancements
UNION ALL SELECT 'recording_speakers', count(*) FROM recording_speakers
ORDER BY table_name;

-- These rows must be resolved deliberately before normalized speaker names are
-- backfilled. The script reports them; it never merges or deletes speakers.
SELECT lower(btrim(name)) AS normalized_name,
       count(*) AS duplicate_count,
       array_agg(id ORDER BY id) AS speaker_ids,
       array_agg(name ORDER BY name) AS names
FROM speakers
GROUP BY lower(btrim(name))
HAVING count(*) > 1
ORDER BY normalized_name;

SELECT source, count(*) AS recording_count
FROM recordings
GROUP BY source
ORDER BY source;

SELECT 'transcriptions' AS relation_name, count(*) AS orphan_count
FROM transcriptions t
LEFT JOIN recordings r ON r.id = t.recording_id
WHERE r.id IS NULL
UNION ALL
SELECT 'ai_enhancements', count(*)
FROM ai_enhancements a
LEFT JOIN recordings r ON r.id = a.recording_id
WHERE r.id IS NULL
UNION ALL
SELECT 'recording_speakers', count(*)
FROM recording_speakers rs
LEFT JOIN recordings r ON r.id = rs.recording_id
LEFT JOIN speakers s ON s.id = rs.speaker_id
WHERE r.id IS NULL OR s.id IS NULL;
