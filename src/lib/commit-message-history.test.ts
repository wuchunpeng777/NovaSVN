import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMIT_MESSAGE_HISTORY_LIMIT,
  COMMIT_MESSAGE_SETTINGS_KEY,
  prependCommitMessageHistory,
  readCommitMessageSettings,
  writeCommitMessageSettings,
} from "./commit-message-history";

beforeEach(() => {
  localStorage.clear();
});

describe("commit message history", () => {
  it("按工作副本隔离历史且不回退到旧全局历史", () => {
    localStorage.setItem(
      COMMIT_MESSAGE_SETTINGS_KEY,
      JSON.stringify({
        template: "全局模板",
        history: ["旧全局记录"],
        project_histories: {
          "c:/workspace/a": ["项目 A 记录"],
          "c:/workspace/b": ["项目 B 记录"],
        },
      }),
    );

    expect(readCommitMessageSettings("C:\\Workspace\\A")).toEqual({
      template: "全局模板",
      history: ["项目 A 记录"],
    });
    expect(readCommitMessageSettings("C:\\Workspace\\missing")).toEqual({
      template: "全局模板",
      history: [],
    });
  });

  it("写入当前工作副本时保留其他项目历史并共享模板", () => {
    writeCommitMessageSettings({ template: "初始模板", history: ["项目 B 记录"] }, "C:\\Repo\\B");
    writeCommitMessageSettings({ template: "新模板", history: ["项目 A 记录"] }, "c:/repo/a/");

    expect(readCommitMessageSettings("C:\\REPO\\A")).toEqual({
      template: "新模板",
      history: ["项目 A 记录"],
    });
    expect(readCommitMessageSettings("c:/repo/b")).toEqual({
      template: "新模板",
      history: ["项目 B 记录"],
    });
  });

  it("前置新日志并截断到统一上限", () => {
    const existing = Array.from({ length: COMMIT_MESSAGE_HISTORY_LIMIT }, (_, index) => `旧日志 ${index}`);
    const next = prependCommitMessageHistory("最新日志", existing);

    expect(next[0]).toBe("最新日志");
    expect(next).toHaveLength(COMMIT_MESSAGE_HISTORY_LIMIT);
    expect(next).not.toContain(`旧日志 ${COMMIT_MESSAGE_HISTORY_LIMIT - 1}`);
    expect(next).toContain("旧日志 0");
  });

  it("空日志不写入，重复日志去重后置顶", () => {
    expect(prependCommitMessageHistory("  ", ["已有日志"])).toEqual(["已有日志"]);
    expect(prependCommitMessageHistory("已有日志", ["其他", "已有日志", "更早"])).toEqual([
      "已有日志",
      "其他",
      "更早",
    ]);
  });

  it("写入时按统一上限截断历史", () => {
    const oversized = Array.from({ length: COMMIT_MESSAGE_HISTORY_LIMIT + 5 }, (_, index) => `日志 ${index}`);
    writeCommitMessageSettings({ template: "模板", history: oversized }, "C:\\repo");

    expect(readCommitMessageSettings("C:\\repo").history).toHaveLength(COMMIT_MESSAGE_HISTORY_LIMIT);
    expect(readCommitMessageSettings("C:\\repo").history[0]).toBe("日志 0");
  });
});
