import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`, { method: "POST" });
}

describe("proxy bearer-auth route bypasses", () => {
  it.each(["/api/sync", "/api/recordings"])(
    "allows %s to perform its own authorization",
    (pathname) => {
      const response = proxy(request(pathname));

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
  );

  it("still redirects protected routes without a session cookie", () => {
    const response = proxy(request("/recordings"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?callbackUrl=%2Frecordings"
    );
  });
});
