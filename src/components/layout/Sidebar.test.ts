import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import Sidebar from "./Sidebar.svelte";
import type { AppView } from "../../types/app";

describe("Sidebar", () => {
  it("selects views and exposes active filters", async () => {
    const onSelect = vi.fn();
    const onClearFilters = vi.fn();
    const onStageFilter = vi.fn();
    const onToggleAbnormalOnly = vi.fn();
    const onToggleUnreviewedOnly = vi.fn();
    const onToggleStatusFilter = vi.fn();

    render(Sidebar, {
      props: {
        currentView: "changes" as AppView,
        items: [
          { id: "changes", label: "工作区", description: "本地改动" },
          { id: "settings", label: "设置", description: "偏好" },
        ],
        filterStats: {
          total: 3,
          staged: 1,
          unstaged: 2,
          abnormal: 1,
          unreviewed: 2,
          statuses: [{ status: "modified", label: "修改", count: 2 }],
        },
        stageFilter: "staged",
        abnormalOnly: true,
        unreviewedOnly: false,
        statusFilters: ["modified"],
        onSelect,
        onClearFilters,
        onStageFilter,
        onToggleAbnormalOnly,
        onToggleUnreviewedOnly,
        onToggleStatusFilter,
      },
    });

    await fireEvent.click(screen.getByRole("button", { name: /设置/ }));
    await fireEvent.click(screen.getByRole("button", { name: /清空/ }));
    await fireEvent.click(screen.getByRole("button", { name: /未暂存/ }));
    await fireEvent.click(screen.getByRole("button", { name: /异常状态/ }));
    await fireEvent.click(screen.getByRole("button", { name: /未审文件/ }));
    await fireEvent.click(screen.getByRole("button", { name: /修改/ }));

    expect(onSelect).toHaveBeenCalledWith("settings");
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(onStageFilter).toHaveBeenCalledWith("unstaged");
    expect(onToggleAbnormalOnly).toHaveBeenCalledTimes(1);
    expect(onToggleUnreviewedOnly).toHaveBeenCalledTimes(1);
    expect(onToggleStatusFilter).toHaveBeenCalledWith("modified");
  });
});
