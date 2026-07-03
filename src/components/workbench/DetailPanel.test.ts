import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import DetailPanel from "./DetailPanel.svelte";
import type { FileContentDiff } from "../../types/api";

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

  it("opens conflicted files from conflict actions", async () => {
    const onOpenWorkspaceFile = vi.fn();

    render(DetailPanel, {
      props: {
        selectedFile: {
          path: "src/main.ts",
          status: "conflicted",
          revision: null,
          property_status: null,
          property_changed: false,
          abnormal: true,
          lock_state: "none",
          lock_owner: null,
          lock_comment: null,
          conflict_kind: "text",
          file_size: 12,
          content_digest: "digest",
        },
        onOpenWorkspaceFile,
      },
    });

    await fireEvent.click(screen.getByText("打开冲突文件"));

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith("src/main.ts");
  });
});
