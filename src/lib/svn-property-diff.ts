import type { FileContentDiff, FileDiff } from "../types/api";

type PropertyChangeKind = "Added" | "Modified" | "Deleted";

interface PropertyChange {
  name: string;
  kind: PropertyChangeKind;
  originalLines: string[];
  modifiedLines: string[];
}

export function buildPropertyContentDiff(diff: FileDiff | null): FileContentDiff | null {
  if (!diff?.text) {
    return null;
  }

  const changes = parsePropertyChanges(diff.text);
  if (changes.length === 0) {
    return null;
  }

  return {
    path: diff.path,
    node_kind: diff.node_kind,
    original_text: renderPropertySide(changes, "original"),
    modified_text: renderPropertySide(changes, "modified"),
    language: "plaintext",
    binary: false,
    too_large: false,
    max_bytes: new TextEncoder().encode(diff.text).byteLength,
    is_image: false,
    image_mime: null,
    original_bytes_base64: null,
    modified_bytes_base64: null,
    original_byte_size: 0,
    modified_byte_size: 0,
  };
}

function parsePropertyChanges(text: string): PropertyChange[] {
  const changes: PropertyChange[] = [];
  let insidePropertyBlock = false;
  let current: PropertyChange | null = null;
  let insideHunk = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("Property changes on: ")) {
      insidePropertyBlock = true;
      current = null;
      insideHunk = false;
      continue;
    }
    if (line.startsWith("Index: ")) {
      insidePropertyBlock = false;
      current = null;
      insideHunk = false;
      continue;
    }
    if (!insidePropertyBlock) {
      continue;
    }

    const header = /^(Added|Modified|Deleted):\s+(.+)$/.exec(line);
    if (header) {
      current = {
        kind: header[1] as PropertyChangeKind,
        name: header[2].trim(),
        originalLines: [],
        modifiedLines: [],
      };
      changes.push(current);
      insideHunk = false;
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("@@ ")) {
      insideHunk = true;
      continue;
    }
    if (!insideHunk || line === "\\ No newline at end of property") {
      continue;
    }
    if (line.startsWith("-")) {
      current.originalLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      current.modifiedLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      const value = line.slice(1);
      current.originalLines.push(value);
      current.modifiedLines.push(value);
    }
  }

  return changes;
}

function renderPropertySide(
  changes: PropertyChange[],
  side: "original" | "modified",
) {
  return changes
    .map((change) => {
      const missing =
        (side === "original" && change.kind === "Added") ||
        (side === "modified" && change.kind === "Deleted");
      const lines = side === "original" ? change.originalLines : change.modifiedLines;
      const value = missing ? ["<未设置>"] : lines.length > 0 ? lines : ["<空值>"];
      return [`属性: ${change.name}`, ...value].join("\n");
    })
    .join("\n\n");
}
