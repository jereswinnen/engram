import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { proxy } from "./proxy"

function request(pathname: string, method = "POST") {
  return new NextRequest(`http://localhost${pathname}`, { method })
}

describe("proxy bearer-auth route bypasses", () => {
  it("allows recorder uploads to perform their own authorization", () => {
    const response = proxy(request("/api/recordings"))

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
  })

  it("allows recorder deletions to perform their own authorization", () => {
    const response = proxy(
      request(
        "/api/recordings/386f626f-7d01-4baa-9954-edce960031e6",
        "DELETE"
      )
    )

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
  })

  it("keeps nested browser-only recording actions protected", () => {
    const response = proxy(
      request(
        "/api/recordings/386f626f-7d01-4baa-9954-edce960031e6/transcribe"
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toContain("/login?callbackUrl=")
  })

  it("protects manual Plaud sync with the browser session proxy", () => {
    const response = proxy(request("/api/sync"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?callbackUrl=%2Fapi%2Fsync"
    )
  })

  it("still redirects protected routes without a session cookie", () => {
    const response = proxy(request("/recordings"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?callbackUrl=%2Frecordings"
    )
  })
})
