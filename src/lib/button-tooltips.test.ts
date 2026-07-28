import { afterEach, describe, expect, it } from "vitest";
import { installButtonTooltips } from "./button-tooltips";

afterEach(() => {
  document.body.replaceChildren();
});

describe("installButtonTooltips", () => {
  it("uses accessibility labels and visible text for missing tooltips", () => {
    document.body.innerHTML = `
      <button aria-label="刷新状态"><svg></svg></button>
      <button>  打开\n工作副本  </button>
      <button aria-label="关闭" title="关闭窗口">X</button>
      <span role="button" tabindex="0">取消任务</span>
    `;

    const uninstall = installButtonTooltips(document);
    const buttons = document.querySelectorAll("button");

    expect(buttons[0]).toHaveAttribute("title", "刷新状态");
    expect(buttons[1]).toHaveAttribute("title", "打开 工作副本");
    expect(buttons[2]).toHaveAttribute("title", "关闭窗口");
    expect(screenButton()).toHaveAttribute("title", "取消任务");

    uninstall();
    expect(buttons[0]).not.toHaveAttribute("title");
    expect(buttons[1]).not.toHaveAttribute("title");
    expect(buttons[2]).toHaveAttribute("title", "关闭窗口");
    expect(screenButton()).not.toHaveAttribute("title");
  });

  it("updates generated tooltips for dynamic buttons and labels", async () => {
    const uninstall = installButtonTooltips(document);
    const button = document.createElement("button");
    button.textContent = "开始更新";
    document.body.append(button);
    await mutationCycle();

    expect(button).toHaveAttribute("title", "开始更新");

    button.setAttribute("aria-label", "正在更新工作副本");
    await mutationCycle();
    expect(button).toHaveAttribute("title", "正在更新工作副本");

    button.setAttribute("title", "更新暂不可用");
    await mutationCycle();
    expect(button).toHaveAttribute("title", "更新暂不可用");

    uninstall();
    expect(button).toHaveAttribute("title", "更新暂不可用");
  });

  it("leaves custom fast tooltips without a duplicate native title", async () => {
    document.body.innerHTML = `
      <button aria-label="回退工作区到 r42" data-tooltip="回退目标到 r42"></button>
    `;

    const button = document.querySelector("button")!;
    const uninstall = installButtonTooltips(document);

    expect(button).toHaveAttribute("data-tooltip", "回退目标到 r42");
    expect(button).not.toHaveAttribute("title");

    button.setAttribute("aria-label", "回退当前日志目标到 r42");
    await mutationCycle();
    expect(button).not.toHaveAttribute("title");

    uninstall();
  });
});

async function mutationCycle() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function screenButton() {
  return document.querySelector<HTMLElement>('[role="button"]');
}
