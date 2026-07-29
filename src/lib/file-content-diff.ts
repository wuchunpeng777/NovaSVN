import type { FileContentDiff } from "../types/api";

/** True when decoded Unicode text differs between the two sides. */
export function hasTextContentChange(
  diff: Pick<FileContentDiff, "original_text" | "modified_text"> | null | undefined,
): boolean {
  if (!diff) {
    return false;
  }
  return diff.original_text !== diff.modified_text;
}

/** True when both sides report an encoding and they differ. */
export function hasEncodingChange(
  diff:
    | Pick<FileContentDiff, "original_encoding" | "modified_encoding">
    | null
    | undefined,
): boolean {
  if (!diff) {
    return false;
  }
  const original = diff.original_encoding?.trim() ?? "";
  const modified = diff.modified_encoding?.trim() ?? "";
  return original.length > 0 && modified.length > 0 && original !== modified;
}

/**
 * Whether the Monaco text Diff viewer should be shown.
 * Includes encoding-only changes where decoded text is identical.
 */
export function shouldShowTextDiffViewer(
  diff: FileContentDiff | null | undefined,
): boolean {
  if (!diff || diff.binary || diff.too_large || diff.is_image) {
    return false;
  }
  return hasTextContentChange(diff) || hasEncodingChange(diff);
}
