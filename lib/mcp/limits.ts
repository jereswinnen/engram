export const MCP_MAX_REQUEST_BYTES = 256 * 1024
export const MCP_MAX_TOOL_BYTES = 48_000
export const MCP_MAX_FETCH_SEGMENTS = 160

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

export function isWithinToolLimit(value: unknown): boolean {
  return utf8ByteLength(JSON.stringify(value)) <= MCP_MAX_TOOL_BYTES
}
