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
        currentRevision: "r42M",
        revertDisabled: () => false,
        workspaceRevertDisabled: () => false,
        onRevert,
        onRevertWorkspace,
      },
    });

    const entry = screen.getByText("Local revision").closest(".svn-log-entry");
    expect(entry).toHaveClass("current-revision");
    expect(entry).toHaveAttribute("aria-current", "true");
    expect(screen.getByLabelText("本地 Revision r42")).toBeInTheDocument();
    expect(screen.getByLabelText("本地工作副本 Revision r42")).toHaveTextContent(
      "本地 Revision",
    );
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

  it("shows the local revision boundary when the exact revision is absent", () => {
    render(SvnLogRevisionList, {
      props: {
        entries: [
          {
            revision: "44",
            author: "alice",
            date: "2026-07-23T10:30:00Z",
            message: "Remote revision",
            changed_paths: [],
          },
          {
            revision: "42",
            author: "bob",
            date: "2026-07-21T10:30:00Z",
            message: "Older revision",
            changed_paths: [],
          },
        ],
        totalEntries: 2,
        currentRevision: "43M",
      },
    });

    expect(screen.getByLabelText("本地 Revision r43")).toBeInTheDocument();
    const boundary = screen.getByLabelText("本地 Revision r43 的历史位置");
    expect(boundary).toHaveTextContent("本地 Revision r43");
    expect(boundary.nextElementSibling).toHaveTextContent("r42");
  });
});
