import type { DetailSection, NavigationItem, WorkbenchView } from "../types/app";

export const navigationItems: NavigationItem[] = [
  { id: "changes", label: "工作区", description: "本地改动和暂存" },
  { id: "staging", label: "草稿", description: "提交计划" },
  { id: "history", label: "日志", description: "历史和审查" },
  { id: "branches", label: "分支池", description: "多工作副本" },
  { id: "repository", label: "仓库", description: "远端浏览" },
];

export const workbenchViews: Record<string, WorkbenchView> = {
  changes: {
    id: "changes",
    title: "本地改动",
    subtitle: "后续接入工作副本扫描、过滤和文件级暂存。",
    metrics: [
      { label: "未暂存", value: "0" },
      { label: "已暂存", value: "0" },
      { label: "异常", value: "0" },
    ],
    primaryItems: [
      { title: "未暂存", meta: "等待工作副本扫描", status: "空" },
      { title: "已暂存", meta: "等待虚拟暂存区", status: "空" },
      { title: "未版本控制", meta: "后续显示 unversioned 文件", status: "空" },
    ],
  },
  staging: {
    id: "staging",
    title: "提交草稿",
    subtitle: "保存暂存选择、提交信息、审查状态和警告确认。",
    metrics: [
      { label: "草稿", value: "0" },
      { label: "已审", value: "0" },
      { label: "警告", value: "0" },
    ],
    primaryItems: [
      { title: "提交信息", meta: "底部区域将提供编辑器", status: "待接入" },
      { title: "审查状态", meta: "后续绑定文件摘要", status: "待接入" },
      { title: "警告确认", meta: "后续绑定安全检查", status: "待接入" },
    ],
  },
  history: {
    id: "history",
    title: "日志",
    subtitle: "后续显示 SVN log、文件历史和 revision diff。",
    metrics: [
      { label: "Revision", value: "-" },
      { label: "作者", value: "-" },
      { label: "路径", value: "-" },
    ],
    primaryItems: [
      { title: "仓库日志", meta: "等待 svn log --xml", status: "占位" },
      { title: "文件历史", meta: "等待选中文件", status: "占位" },
      { title: "变更路径", meta: "等待 revision 数据", status: "占位" },
    ],
  },
  branches: {
    id: "branches",
    title: "分支池",
    subtitle: "后续管理多工作副本分支池和任务工作区。",
    metrics: [
      { label: "分支", value: "0" },
      { label: "任务", value: "0" },
      { label: "本地改动", value: "0" },
    ],
    primaryItems: [
      { title: "trunk", meta: "默认主线工作区占位", status: "未打开" },
      { title: "feature/*", meta: "后续从 branches 创建", status: "未打开" },
      { title: "hotfix/*", meta: "后续绑定任务工作区", status: "未打开" },
    ],
  },
  repository: {
    id: "repository",
    title: "仓库浏览",
    subtitle: "后续浏览 trunk、branches、tags 和远端路径。",
    metrics: [
      { label: "目录", value: "-" },
      { label: "文件", value: "-" },
      { label: "Revision", value: "-" },
    ],
    primaryItems: [
      { title: "/trunk", meta: "标准 SVN 布局", status: "占位" },
      { title: "/branches", meta: "分支目录", status: "占位" },
      { title: "/tags", meta: "标签目录", status: "占位" },
    ],
  },
};

export const detailSections: DetailSection[] = [
  { title: "Diff", description: "阶段 2 集成 Monaco Diff。" },
  { title: "属性", description: "后续显示 SVN properties。" },
  { title: "锁状态", description: "后续显示 lock / unlock 信息。" },
  { title: "检查结果", description: "后续显示阻塞、警告和提示。" },
];
