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
  plaudApiBase: () => process.env.PLAUD_API_BASE ?? "https://api.plaud.ai",
  plaudRedirectUrl: () => `${required("NEXT_PUBLIC_APP_URL")}/api/plaud/callback`,
  r2: () => ({
    endpoint: required("R2_ENDPOINT"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucket: required("R2_BUCKET"),
  }),
};
