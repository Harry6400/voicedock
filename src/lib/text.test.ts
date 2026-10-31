import { describe, it, expect } from "vitest";
import { cleanText, insertTag } from "./text";
describe("script editing", () => {
  it("cleans captions without mutating original", () => {
    const raw = "[shy] 你好。[whisper]再见。";
    expect(cleanText(raw)).toBe("你好。再见。");
    expect(raw).toContain("[shy]");
  });
  it("inserts at selection and returns caret", () => {
    expect(insertTag("你好世界", "[laughing]", 2, 4)).toEqual({
      text: "你好[laughing]",
      cursor: 12,
    });
  });
});
