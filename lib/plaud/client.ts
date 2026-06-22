import { config } from "@/lib/config";
import { mapRecording, mapRecordingDetail, type PlaudRecording, type PlaudRecordingDetail } from "./types";

export class PlaudAuthError extends Error {}

// Endpoint paths — CONFIRM against web.plaud.ai network calls in the live-verify
// step. They are isolated here so finalizing them is a one-file change. Tests mock
// fetch and do not depend on these exact strings.
const PATHS = {
  currentUser: "/user/profile",
  listFiles: "/file/list",
  fileDetail: (id: string) => `/file/detail?id=${encodeURIComponent(id)}`,
};

function authHeaders(token: string): Record<string, string> {
  const t = token.trim();
  const value = t.toLowerCase().startsWith("bearer ") ? t : `Bearer ${t}`;
  return { Authorization: value, "Content-Type": "application/json" };
}

async function plaudFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${config.plaudApiBase()}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 401 || res.status === 403) {
    throw new PlaudAuthError(`Plaud token rejected (${res.status}) — reconnect needed`);
  }
  if (!res.ok) throw new Error(`Plaud API ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

// Plaud list responses wrap items under data/list/files depending on endpoint;
// read the first array we find (finalized in live-verify).
function extractArray(json: any): any[] {
  if (Array.isArray(json)) return json;
  return json.data ?? json.list ?? json.files ?? json.items ?? [];
}

export async function listRecordings(token: string): Promise<PlaudRecording[]> {
  const res = await plaudFetch(token, PATHS.listFiles);
  return extractArray(await res.json()).map(mapRecording);
}

export async function getRecordingDetail(token: string, fileId: string): Promise<PlaudRecordingDetail> {
  const res = await plaudFetch(token, PATHS.fileDetail(fileId));
  const json = await res.json();
  return mapRecordingDetail(json.data ?? json);
}

export async function downloadAudio(signedUrl: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(signedUrl); // presigned — no auth header
  if (!res.ok) throw new Error(`audio download failed: ${res.status}`);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
  };
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    await plaudFetch(token, PATHS.currentUser);
    return true;
  } catch {
    return false;
  }
}
