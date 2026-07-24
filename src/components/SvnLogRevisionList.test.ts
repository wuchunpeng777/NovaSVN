import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import SvnLogRevisionList from "./SvnLogRevisionList.svelte";

describe("SvnLogRevisionList", () => {
  it("keeps author and time immediately after the revision markers", () => {
    render(SvnLogRevisionList, {
      props: {
        entries: [
          {
            revision: "42",
            author: "alice",
            date: "2026-07-22T10:30:00Z",
            message: "Shared log row",
            changed_paths: [
              {
                path: "/trunk/src/main.ts",
                action: "M",
                kind: "file",
                copy_from_path: null,
                copy_from_revision: null,
              },
            ],
          },
        ],
        totalEntries: 1,
        formatDate: () => "2026/07/22 18:30",
      },
    });

    const summary = screen.getByRole("button", { name: "展开 r42 日志" });
    const revision = summary.querySelector(".svn-log-revision");
    const author = summary.querySelector(".svn-log-author");
    const time = summary.querySelector("time");

    expect([...summary.children]).toEqual([revision, author, time]);
    expect(revision?.textContent?.replace(/\s/g, "")).toBe("r42M1");
    expect(author).toHaveTextContent("alice");
    expect(time).toHaveTextContent("2026/07/22 18:30");
  });

  it("highlights the local revision and visually distinguishes both revert actions", async () => {
    const onRevert = vi.fn();
    const onRevertWorkspace = vi.fn();
    render(SvnLogRevisionList, {
      props: {
        entries: [
          {
            revision: "42",
            author: "alice",
            date: "2026-07-22T10:30:00Z",
            message: "Local revision",
            changed_paths: [],
          },
        ],
        totalEntries: 1,
        currentRevision: "42",
        revertDisabled: () => false,
        workspaceRevertDisabled: () => false,
        onRevert,
        onRevertWorkspace,
      },
    });

    const entry = screen.getByText("Local revision").closest(".svn-log-entry");
    expect(entry).toHaveClass("current-revision");
    expect(entry).toHaveAttribute("aria-current", "true");
    expect(screen.getByLabelText("当前工作副本版本 r42")).toHaveTextContent("当前版本");
    const revert = screen.getByRole("button", { name: "撤销提交 r42" });
    const workspaceRevert = screen.getByRole("button", { name: "回退工作区到 r42" });
    expect(revert.querySelector(".lucide-undo-2")).toBeInTheDocument();
    expect(workspaceRevert.querySelector(".lucide-folder-clock")).toBeInTheDocument();
    expect(workspaceRevert).toHaveClass("svn-log-revert-workspace");

    await fireEvent.click(revert);
    await fireEvent.click(workspaceRevert);
    expect(onRevert).toHaveBeenCalledOnce();
    expect(onRevertWorkspace).toHaveBeenCalledOnce();
  });
});
