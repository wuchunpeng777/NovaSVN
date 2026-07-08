import type { DetailSection, NavigationItem, WorkbenchView } from "../types/app";

export const navigationItems: NavigationItem[] = [
  { id: "changes", label: "工作区", description: "本地改动和暂存" },
  { id: "staging", label: "草稿", description: "提交计划" },
  { id: "history", label: "日志", description: "历史和审查" },
  { id: "branches", label: "分支池", description: "多工作副本" },
  { id: "repository", label: "仓库", description: "远端浏览" },
  { id: "settings", label: "设置", description: "偏好和工具" },
];

export const workbenchViews: Record<string, WorkbenchView> = {
  changes: {
    id: "changes",
    title: "本地改动",
    subtitle: "扫描工作副本、过滤改动并管理文件级暂存。",
    metrics: [
      { label: "未暂存", value: "0" },
      { label: "已暂存", value: "0" },
      { label: "异常", value: "0" },
    ],
    primaryItems: [
      { title: "未暂存", meta: "等待工作副本扫描", status: "空" },
      { title: "已暂存", meta: "等待虚拟暂存区", status: "空" },
      { title: "未版本控制", meta: "状态扫描后显示 unversioned 文件", status: "空" },
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
      { title: "提交信息", meta: "底部提交区编辑并保存草稿", status: "可用" },
      { title: "审查状态", meta: "按文件摘要保存已审状态", status: "可用" },
      { title: "警告确认", meta: "安全检查警告可确认后继续", status: "可用" },
    ],
  },
  history: {
    id: "history",
    title: "日志",
    subtitle: "查看 SVN log、文件历史和 revision diff。",
    metrics: [
      { label: "Revision", value: "-" },
      { label: "作者", value: "-" },
      { label: "路径", value: "-" },
    ],
    primaryItems: [
      { title: "仓库日志", meta: "通过 svn log --xml 读取", status: "可用" },
      { title: "文件历史", meta: "选中文件后可筛选", status: "可用" },
      { title: "变更路径", meta: "显示 revision changed paths", status: "可用" },
    ],
  },
  branches: {
    id: "branches",
    title: "分支池",
    subtitle: "管理多工作副本分支池、任务工作区和 merge。",
    metrics: [
      { label: "分支", value: "0" },
      { label: "任务", value: "0" },
      { label: "本地改动", value: "0" },
    ],
    primaryItems: [
      { title: "trunk", meta: "可作为当前工作副本或分支源", status: "可用" },
      { title: "feature/*", meta: "可从 branches 创建或 checkout", status: "可用" },
      { title: "hotfix/*", meta: "可绑定任务工作区", status: "可用" },
    ],
  },
  repository: {
    id: "repository",
    title: "仓库浏览",
    subtitle: "浏览 trunk、branches、tags 和远端路径。",
    metrics: [
      { label: "目录", value: "-" },
      { label: "文件", value: "-" },
      { label: "Revision", value: "-" },
    ],
    primaryItems: [
      { title: "/trunk", meta: "标准 SVN 布局", status: "可识别" },
      { title: "/branches", meta: "分支目录", status: "可识别" },
      { title: "/tags", meta: "标签目录", status: "可识别" },
    ],
  },
  settings: {
    id: "settings",
    title: "设置",
    subtitle: "持久化 SVN、Diff、提交和工具偏好。",
    metrics: [
      { label: "SVN", value: "-" },
      { label: "Diff", value: "-" },
      { label: "工具", value: "-" },
    ],
    primaryItems: [
      { title: "SVN 路径", meta: "持久化命令行路径", status: "设置" },
      { title: "Diff 偏好", meta: "默认展示和外部工具", status: "设置" },
      { title: "安全检查", meta: "大文件阈值和提交前提示", status: "设置" },
    ],
  },
};

export const detailSections: DetailSection[] = [
  { title: "属性", description: "显示和编辑 SVN properties。" },
  { title: "锁状态", description: "显示 lock / unlock 信息并提供操作。" },
  { title: "检查结果", description: "显示阻塞、警告和提示。" },
];
