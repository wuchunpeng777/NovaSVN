import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import BottomPanel from "./BottomPanel.svelte";

describe("BottomPanel", () => {
  it("handles commit draft controls and partial commit action", async () => {
    const onCommitTemplateInput = vi.fn();
    const onCommitMessageInput = vi.fn();
    const onUseCommitHistoryMessage = vi.fn();
    const onClearWorkspaceDraft = vi.fn();
    const onConfirmSafetyWarnings = vi.fn();
    const onCommit = vi.fn();
    const onPartialCommit = vi.fn();

    render(BottomPanel, {
      props: {
        stagedFiles: [{ path: "src/main.rs", status: "modified" }],
        commitTemplate: "feat: ",
        commitHistory: ["修复提交流程"],
        commitMessage: "当前提交",
        safetyCheck: {
          blockers: [],
          warnings: [
            {
              id: "warning:unversioned:a",
              severity: "warning",
              title: "未版本控制文件",
              detail: "a.tmp 未加入版本控制",
              filePath: "a.tmp",
            },
          ],
          infos: [],
          confirmedWarningIds: [],
        },
        onCreateTask: vi.fn(),
        onCommitMessageInput,
        onCommitTemplateInput,
        onUseCommitHistoryMessage,
        onConfirmSafetyWarnings,
        onClearWorkspaceDraft,
        onCommit,
        onPartialCommit,
        onSelectTask: vi.fn(),
        onCancelTask: vi.fn(),
      },
    });

    await fireEvent.input(screen.getByPlaceholderText("提交信息模板"), {
      target: { value: "fix: " },
    });
    await fireEvent.input(screen.getByPlaceholderText("输入提交信息"), {
      target: { value: "修复暂存状态" },
    });
    await fireEvent.change(screen.getByLabelText("最近提交信息"), {
      target: { value: "修复提交流程" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "清空草稿" }));
    await fireEvent.click(screen.getByRole("button", { name: "确认警告" }));
    await fireEvent.click(screen.getByRole("button", { name: "提交" }));
    await fireEvent.click(screen.getByRole("button", { name: "提交选中 Hunk" }));

    expect(screen.getByText("1 个已暂存")).toBeInTheDocument();
    expect(screen.getByText("src/main.rs")).toBeInTheDocument();
    expect(onCommitTemplateInput).toHaveBeenCalledWith("fix: ");
    expect(onCommitMessageInput).toHaveBeenCalledWith("修复暂存状态");
    expect(onUseCommitHistoryMessage).toHaveBeenCalledWith("修复提交流程");
    expect(onClearWorkspaceDraft).toHaveBeenCalledTimes(1);
    expect(onConfirmSafetyWarnings).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onPartialCommit).toHaveBeenCalledTimes(1);
  });
});
