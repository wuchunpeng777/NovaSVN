import { describe, expect, it } from "vitest";
import type { FileContentDiff } from "../types/api";
import {
  hasEncodingChange,
  hasTextContentChange,
  shouldShowTextDiffViewer,
} from "./file-content-diff";

const base: FileContentDiff = {
  path: "notes.txt",
  original_text: "你好",
  modified_text: "你好",
  language: "plaintext",
  binary: false,
  too_large: false,
  max_bytes: 1024,
  original_encoding: "GB18030",
  modified_encoding: "UTF-8",
};

describe("file-content-diff helpers", () => {
  it("detects text and encoding changes independently", () => {
    expect(hasTextContentChange(base)).toBe(false);
    expect(hasEncodingChange(base)).toBe(true);
    expect(
      hasTextContentChange({
        ...base,
        original_text: "旧",
        modified_text: "新",
      }),
    ).toBe(true);
    expect(
      hasEncodingChange({
        ...base,
        original_encoding: "UTF-8",
        modified_encoding: "UTF-8",
      }),
    ).toBe(false);
  });

  it("shows the text Diff viewer for encoding-only changes", () => {
    expect(shouldShowTextDiffViewer(base)).toBe(true);
    expect(
      shouldShowTextDiffViewer({
        ...base,
        original_encoding: "UTF-8",
        modified_encoding: "UTF-8",
      }),
    ).toBe(false);
    expect(
      shouldShowTextDiffViewer({
        ...base,
        original_text: "a",
        modified_text: "b",
        original_encoding: "UTF-8",
        modified_encoding: "UTF-8",
      }),
    ).toBe(true);
  });

  it("hides the viewer for binary, oversized, and image diffs", () => {
    expect(shouldShowTextDiffViewer({ ...base, binary: true })).toBe(false);
    expect(shouldShowTextDiffViewer({ ...base, too_large: true })).toBe(false);
    expect(shouldShowTextDiffViewer({ ...base, is_image: true })).toBe(false);
    expect(shouldShowTextDiffViewer(null)).toBe(false);
  });
});
