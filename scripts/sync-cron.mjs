// Triggers the app's hourly Plaud sync. Run by the Railway cron service:
//   node scripts/sync-cron.mjs
// Requires env: APP_URL (public https URL of the web app) and CRON_SECRET.
const appUrl = process.env.APP_URL;
const secret = process.env.CRON_SECRET;

if (!appUrl || !secret) {
  console.error("sync-cron: APP_URL and CRON_SECRET must both be set");
  process.exit(1);
}

const url = `${appUrl.replace(/\/+$/, "")}/api/sync`;

try {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`sync-cron: POST ${url} -> ${res.status} ${JSON.stringify(body)}`);
  // Fail the run (non-zero exit → Railway marks it red) on transport/HTTP/sync errors.
  // A skipped run (body.note, no error) and a normal run exit 0.
  if (!res.ok || body.error) process.exit(1);
  process.exit(0);
} catch (e) {
  console.error("sync-cron: request failed", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
