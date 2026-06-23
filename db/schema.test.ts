import { describe, it, expect } from "vitest";
import { recordings, transcriptions, aiEnhancements } from "./schema";

describe("schema", () => {
  it("recordings has expected columns", () => {
    expect(Object.keys(recordings)).toEqual(
      expect.arrayContaining(["id", "title", "storageKey", "status", "plaudFileId"]),
    );
  });
  it("transcriptions references recordings", () => {
    expect(transcriptions.recordingId).toBeDefined();
  });
  it("aiEnhancements has expected fields", () => {
    expect(Object.keys(aiEnhancements)).toEqual(
      expect.arrayContaining(["overview", "actionItems", "keyPoints", "decisions", "chapters", "openQuestions", "model"]),
    );
  });
});
