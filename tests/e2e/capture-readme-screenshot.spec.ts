import { expect, test } from "@playwright/test";
import path from "node:path";
import { installWorkbenchBackendMock } from "./tauri-backend-mock";

/**
 * 截取真实工作台 / Diff 界面，供 README 展示。
 * 仅在显式开启时运行，避免污染日常 CI：
 *   CAPTURE_README_SCREENSHOT=1 npx playwright test tests/e2e/capture-readme-screenshot.spec.ts
 */
test.describe("README screenshots", () => {
  test.skip(
    process.env.CAPTURE_README_SCREENSHOT !== "1",
    "设置 CAPTURE_README_SCREENSHOT=1 以重新生成 README 截图",
  );

  test("capture workbench overview", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await installWorkbenchBackendMock(page);

    await page.getByPlaceholder("拖入或输入 SVN 工作副本路径").fill("C:/repo/wc");
    await page.getByRole("button", { name: "打开", exact: true }).click();
    await expect(
      page.getByRole("main", { name: "本地改动" }).locator(".pane-header").getByText("C:/repo/wc", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "选择文件夹 src" }).click();
    const modifiedFile = page.getByRole("button", { name: "选择文件 src/modified.txt" });
    await expect(modifiedFile).toBeVisible();
    await modifiedFile.click();
    await page.getByRole("button", { name: "全部文件" }).click();
    await page.getByRole("tab", { name: "Diff" }).click();
    await page.waitForTimeout(800);

    await page.locator(".versions-workbench").screenshot({
      path: path.resolve("docs/screenshot-workbench.png"),
      type: "png",
      animations: "disabled",
    });
  });

  test("capture Monaco Diff panel", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await installWorkbenchBackendMock(page);

    // 覆盖为更适合展示的 TypeScript Diff 内容
    await page.evaluate(() => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      }).__TAURI_INTERNALS__;
      if (!internals?.invoke) {
        return;
      }
      const originalInvoke = internals.invoke.bind(internals);
      const originalText = [
        'import { request } from "./http";',
        "",
        'const API_BASE = "/api/v1";',
        "",
        "export async function fetchSession() {",
        "  const token = oldToken;",
        '  return request(API_BASE + "/session", { token });',
        "}",
        "",
        "export function isSessionValid(session) {",
        "  return Boolean(session?.userId);",
        "}",
        "",
      ].join("\n");
      const modifiedText = [
        'import { request } from "./http";',
        'import { refreshSessionToken } from "./token";',
        "",
        'const API_BASE = "/api/v1";',
        "",
        "export async function fetchSession() {",
        "  const token = await refreshSessionToken();",
        "  // refresh before API calls",
        '  return request(API_BASE + "/session", { token });',
        "}",
        "",
        "export function isSessionValid(session) {",
        "  return Boolean(session?.userId && session?.expiresAt);",
        "}",
        "",
      ].join("\n");

      internals.invoke = async (command: string, args?: Record<string, unknown>) => {
        if (command === "get_file_content_diff") {
          return {
            ok: true,
            data: {
              path: "src/modified.txt",
              language: "typescript",
              original_text: originalText,
              modified_text: modifiedText,
              binary: false,
              too_large: false,
              max_bytes: 512 * 1024,
              is_image: false,
              original_encoding: "UTF-8",
              modified_encoding: "UTF-8",
            },
          };
        }
        return originalInvoke(command, args);
      };
    });

    await page.getByPlaceholder("拖入或输入 SVN 工作副本路径").fill("C:/repo/wc");
    await page.getByRole("button", { name: "打开", exact: true }).click();
    await expect(
      page.getByRole("main", { name: "本地改动" }).locator(".pane-header").getByText("C:/repo/wc", { exact: true }),
    ).toBeVisible();


    await page.getByRole("button", { name: "选择文件夹 src" }).click();
    const modifiedFile = page.getByRole("button", { name: "选择文件 src/modified.txt" });
    await expect(modifiedFile).toBeVisible();
    await modifiedFile.click();
    await page.getByRole("tab", { name: "Diff" }).click();
    await page.getByRole("button", { name: "双栏" }).click();

    // 检查器默认偏窄时 Monaco 高度可能为 0，截图前强制可展示区域
    await page.evaluate(() => {
      const grid = document.querySelector(".work-copy-grid");
      if (grid instanceof HTMLElement) {
        grid.style.setProperty("--inspector-width", "780px");
      }
      document.querySelectorAll(".monaco-diff-viewer").forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.height = "560px";
          el.style.minHeight = "560px";
        }
      });
      document.querySelectorAll(".monaco-diff-editor").forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.height = "520px";
          el.style.minHeight = "520px";
        }
      });
      window.dispatchEvent(new Event("resize"));
    });

    await expect
      .poll(async () => page.locator(".view-line").count(), { timeout: 15_000 })
      .toBeGreaterThan(6);
    await page.waitForTimeout(400);

    await page.locator(".versions-workbench").screenshot({
      path: path.resolve("docs/screenshot-diff.png"),
      type: "png",
      animations: "disabled",
    });
  });
});
