import { describe, expect, it } from "vitest";
import { extractSvnFileChanges } from "./svn-operation-output";

describe("extractSvnFileChanges", () => {
  it("extracts file actions and normalizes absolute Windows output paths", () => {
    expect(
      extractSvnFileChanges(
        [
          { message: "执行 svn checkout", created_at: 1 },
          { message: "A    C:\\work\\project\\src\\main.ts", created_at: 2 },
          { message: "UG   C:\\work\\project\\src\\properties.ts", created_at: 3 },
          { message: "Checked out revision 42.", created_at: 4 },
        ],
        "C:\\work\\project",
      ),
    ).toEqual([
      { action: "A", path: "src/main.ts" },
      { action: "UG", path: "src/properties.ts" },
    ]);
  });
});
