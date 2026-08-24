import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SvnLogSelectionDetails from "./SvnLogSelectionDetails.svelte";
import type { SvnChangedPath, SvnLogEntry } from "../types/api";

describe("SvnLogSelectionDetails", () => {
  it("greys files that are not under the current log folder", () => {
    render(SvnLogSelectionDetails, {
      props: {
        entries: [
          makeEntry("20", [
            makePath("/trunk/src/main.ts", "M"),
            makePath("/trunk/docs/readme.md", "M"),
            makePath("/trunk/src/lib", "A", "dir"),
          ]),
        ],
        selectedRevisions: ["20"],
        repositoryRoot: "https://svn.example.test/repo",
        repositoryUrl: "https://svn.example.test/repo/trunk/src",
      },
    });

    const details = screen.getByLabelText("已选 Revision 文件变化");
    const inScopeFile = within(details).getByRole("button", {
      name: "查看 r20 的 /trunk/src/main.ts diff",
    });
    const outsideFile = within(details).getByRole("button", {
      name: "查看 r20 的 /trunk/docs/readme.md diff（不在当前文件夹内）",
    });
    const inScopeDir = within(details).getByText("/trunk/src/lib").closest(".path-row");

    expect(inScopeFile).not.toHaveClass("outside-log-target");
    expect(outsideFile).toHaveClass("outside-log-target");
    expect(outsideFile.querySelector("code")).toHaveAttribute(
      "title",
      "/trunk/docs/readme.md（不在当前文件夹内）",
    );
    expect(inScopeDir).not.toHaveClass("outside-log-target");
  });
});

function makeEntry(revision: string, changedPaths: SvnChangedPath[]): SvnLogEntry {
  return {
    revision,
    author: "alice",
    date: "2026-07-10T10:00:00Z",
    message: "Mixed change",
    changed_paths: changedPaths,
  };
}

function makePath(path: string, action: string, kind = "file"): SvnChangedPath {
  return {
    path,
    action,
    kind,
    copy_from_path: null,
    copy_from_revision: null,
  };
}
