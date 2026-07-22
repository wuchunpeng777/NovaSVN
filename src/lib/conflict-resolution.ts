export type ConflictResolutionChoice = "mine" | "theirs" | "both";

export interface ConflictTextSegment {
  kind: "text";
  text: string;
}

export interface ConflictBlock {
  kind: "conflict";
  id: string;
  mine: string;
  base: string | null;
  theirs: string;
  mineLabel: string;
  baseLabel: string | null;
  theirsLabel: string;
  original: string;
}

export type ConflictSegment = ConflictTextSegment | ConflictBlock;

export interface ParsedConflictText {
  segments: ConflictSegment[];
  conflicts: ConflictBlock[];
}

const mineMarker = /^<<<<<<<(?:\s+(.*))?$/;
const baseMarker = /^\|\|\|\|\|\|\|(?:\s+(.*))?$/;
const separatorMarker = /^=======$/;
const theirsMarker = /^>>>>>>>(?:\s+(.*))?$/;

export function parseConflictText(text: string): ParsedConflictText {
  const lines = splitLinesPreservingEndings(text);
  const segments: ConflictSegment[] = [];
  const conflicts: ConflictBlock[] = [];
  let context = "";
  let index = 0;

  const flushContext = () => {
    if (!context) {
      return;
    }
    segments.push({ kind: "text", text: context });
    context = "";
  };

  while (index < lines.length) {
    const mineMatch = markerBody(lines[index]).match(mineMarker);
    if (!mineMatch) {
      context += lines[index];
      index += 1;
      continue;
    }

    const parsed = parseConflictBlock(lines, index, conflicts.length);
    if (!parsed) {
      context += lines[index];
      index += 1;
      continue;
    }

    flushContext();
    segments.push(parsed.block);
    conflicts.push(parsed.block);
    index = parsed.nextIndex;
  }

  flushContext();
  return { segments, conflicts };
}

export function buildResolvedConflictText(
  parsed: ParsedConflictText,
  choices: Readonly<Record<string, ConflictResolutionChoice | undefined>>,
) {
  return parsed.segments
    .map((segment) => {
      if (segment.kind === "text") {
        return segment.text;
      }

      const choice = choices[segment.id];
      if (choice === "mine") {
        return segment.mine;
      }
      if (choice === "theirs") {
        return segment.theirs;
      }
      if (choice === "both") {
        return segment.mine === segment.theirs
          ? segment.mine
          : `${segment.mine}${segment.theirs}`;
      }
      return segment.original;
    })
    .join("");
}

function parseConflictBlock(
  lines: string[],
  startIndex: number,
  conflictIndex: number,
): { block: ConflictBlock; nextIndex: number } | null {
  const mineMatch = markerBody(lines[startIndex]).match(mineMarker);
  if (!mineMatch) {
    return null;
  }

  let index = startIndex + 1;
  let mine = "";
  let base = "";
  let theirs = "";
  let baseLabel: string | null = null;
  let phase: "mine" | "base" | "theirs" = "mine";

  while (index < lines.length) {
    const body = markerBody(lines[index]);
    if (phase === "mine") {
      const baseMatch = body.match(baseMarker);
      if (baseMatch) {
        baseLabel = labelOrFallback(baseMatch[1], "BASE");
        phase = "base";
        index += 1;
        continue;
      }
      if (separatorMarker.test(body)) {
        phase = "theirs";
        index += 1;
        continue;
      }
      mine += lines[index];
      index += 1;
      continue;
    }

    if (phase === "base") {
      if (separatorMarker.test(body)) {
        phase = "theirs";
        index += 1;
        continue;
      }
      base += lines[index];
      index += 1;
      continue;
    }

    const theirsMatch = body.match(theirsMarker);
    if (theirsMatch) {
      const nextIndex = index + 1;
      const block: ConflictBlock = {
        kind: "conflict",
        id: `conflict-${conflictIndex + 1}`,
        mine,
        base: baseLabel === null ? null : base,
        theirs,
        mineLabel: labelOrFallback(mineMatch[1], "MINE"),
        baseLabel,
        theirsLabel: labelOrFallback(theirsMatch[1], "THEIRS"),
        original: lines.slice(startIndex, nextIndex).join(""),
      };
      return { block, nextIndex };
    }
    theirs += lines[index];
    index += 1;
  }

  return null;
}

function splitLinesPreservingEndings(text: string) {
  if (!text) {
    return [];
  }
  return text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
}

function markerBody(line: string) {
  return line.replace(/(?:\r\n|\n|\r)$/, "");
}

function labelOrFallback(label: string | undefined, fallback: string) {
  return label?.trim() || fallback;
}
