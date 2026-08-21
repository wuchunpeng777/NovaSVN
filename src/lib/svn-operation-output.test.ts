import { describe, expect, it } from "vitest";
import { extractSvnFileChanges, svnOutputReportsConflicts } from "./svn-operation-output";

describe("extractSvnFileChanges", () => {
  it("extracts file actions and normalizes absolute Windows output paths", () => {
    expect(
      extractSvnFileChanges(
        [
          { message: "执行 svn checkout", created_at: 1 },
          { message: "A    C:\\work\\project\\src\\main.ts", created_at: 2 },
          { message: "UG   C:\\work\\project\\src\\properties.ts", created_at: 3 },
          { message: "A  +    C:\\work\\project\\src\\copied.ts", created_at: 4 },
          { message: "C    C:\\work\\project\\src\\tree", created_at: 5 },
          { message: "Summary of conflicts:", created_at: 6 },
          { message: "  Tree conflicts: 1", created_at: 7 },
          { message: "Updated to revision 42.", created_at: 8 },
        ],
        "C:\\work\\project",
      ),
    ).toEqual([
      { action: "A", path: "src/main.ts" },
      { action: "UG", path: "src/properties.ts" },
      { action: "A", path: "src/copied.ts" },
      { action: "C", path: "src/tree" },
    ]);
  });

  it("detects SVN conflict summaries that still complete the command", () => {
    expect(
      svnOutputReportsConflicts(
        "A    src/added.ts\nC    src/tree\nUpdated to revision 8.\nSummary of conflicts:\n  Tree conflicts: 1\n",
      ),
    ).toBe(true);
    expect(svnOutputReportsConflicts("A    src/added.ts\nUpdated to revision 8.")).toBe(false);
  });
});
