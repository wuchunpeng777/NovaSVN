import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import DetailPanel from "./DetailPanel.svelte";
import type { ChangedFile, FileContentDiff } from "../../types/api";

vi.mock("./MonacoDiffViewer.svelte", () => ({
  default: vi.fn().mockImplementation((internals) => ({
    get $$prop_def() {
      return internals.props;
    },
    $set(nextProps: Record<string, unknown>) {
      Object.assign(internals.props, nextProps);
    },
    $destroy() {},
  })),
}));

describe("DetailPanel", () => {
  it("syncs default diff preferences when settings change", async () => {
    const contentDiff: FileContentDiff = {
      path: "src/main.ts",
      original_text: "before",
      modified_text: "after",
      language: "typescript",
      binary: false,
      too_large: false,
      max_bytes: 1024,
    };

    const { rerender } = render(DetailPanel, {
      props: {
        selectedFile: {
          path: "src/main.ts",
          status: "modified",
          revision: null,
          property_status: null,
          property_changed: false,
          abnormal: false,
          lock_state: "none",
          lock_owner: null,
          lock_comment: null,
          conflict_kind: null,
          file_size: 12,
          content_digest: "digest",
        },
        selectedFileContentDiff: contentDiff,
        defaultDiffMode: "side_by_side",
        defaultShowWhitespace: false,
      },
    });

    await rerender({
      selectedFileContentDiff: contentDiff,
      defaultDiffMode: "inline",
      defaultShowWhitespace: true,
    });

    expect(screen.getByText("行内")).toHaveClass("active");
    expect(screen.getByText("空白")).toHaveClass("active");
  });

  it("guards lock actions based on the selected file lock state", async () => {
    const { rerender } = render(DetailPanel, {
      props: {
        selectedFile: makeFile({
          lock_state: "none",
          lock_owner: null,
          lock_comment: null,
        }),
      },
    });

    expect(screen.getByText("Lock")).not.toBeDisabled();
    expect(screen.getByText("Unlock")).toBeDisabled();
    expect(screen.getByText("Force Unlock")).toBeDisabled();
    expect(screen.getByText("未锁定")).toBeInTheDocument();

    await rerender({
      selectedFile: makeFile({
        lock_state: "locked",
        lock_owner: "alice",
        lock_comment: "editing",
      }),
    });

    expect(screen.getByText("Lock")).toBeDisabled();
    expect(screen.getByText("Unlock")).not.toBeDisabled();
    expect(screen.getByText("Force Unlock")).not.toBeDisabled();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("opens conflicted files from conflict actions", async () => {
    const onOpenWorkspaceFile = vi.fn();

    render(DetailPanel, {
      props: {
        selectedFile: makeFile({
          status: "conflicted",
          abnormal: true,
          conflict_kind: "text",
        }),
        onOpenWorkspaceFile,
      },
    });

    await fireEvent.click(screen.getByText("打开冲突文件"));

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith("src/main.ts");
  });

  it("shows conflict actions only for conflicted files", async () => {
    const { rerender } = render(DetailPanel, {
      props: {
        selectedFile: makeFile({
          status: "modified",
          conflict_kind: null,
        }),
      },
    });

    expect(screen.queryByText("标记已解决")).not.toBeInTheDocument();
    expect(screen.queryByText("使用 Mine")).not.toBeInTheDocument();
    expect(screen.queryByText("使用 Theirs")).not.toBeInTheDocument();

    await rerender({
      selectedFile: makeFile({
        status: "modified",
        conflict_kind: "property",
      }),
    });

    expect(screen.getByText("标记已解决")).toBeInTheDocument();
    expect(screen.getByText("使用 Mine")).toBeInTheDocument();
    expect(screen.getByText("使用 Theirs")).toBeInTheDocument();
  });
});

function makeFile(file: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path: "src/main.ts",
    status: "modified",
    revision: null,
    property_status: null,
    property_changed: false,
    abnormal: false,
    lock_state: "none",
    lock_owner: null,
    lock_comment: null,
    conflict_kind: null,
    file_size: 12,
    content_digest: "digest",
    ...file,
  };
}
