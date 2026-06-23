import { describe, it, expect } from "vitest";
import { renderSnippet, SNIPPET_START, SNIPPET_END } from "./snippet";

const mark = (s: string) => `${SNIPPET_START}${s}${SNIPPET_END}`;

describe("renderSnippet", () => {
  it("converts sentinels to <mark>", () => {
    expect(renderSnippet(`a ${mark("cat")} b`)).toBe("a <mark>cat</mark> b");
  });
  it("escapes HTML in the source so transcripts can't inject", () => {
    expect(renderSnippet(`<script>alert(1)</script>`)).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("escapes around a mark too", () => {
    expect(renderSnippet(`<b>${mark("x")}</b>`)).toBe("&lt;b&gt;<mark>x</mark>&lt;/b&gt;");
  });
  it("leaves plain text unchanged", () => {
    expect(renderSnippet("just text")).toBe("just text");
  });
});
