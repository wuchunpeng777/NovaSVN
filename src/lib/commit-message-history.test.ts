import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMIT_MESSAGE_SETTINGS_KEY,
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
});
