import type { WorkbenchView } from "../types/app";

export const workbenchViews: Record<string, WorkbenchView> = {
  changes: {
    id: "changes",
    title: "本地改动",
    subtitle: "扫描工作副本并过滤本地改动。",
    metrics: [
      { label: "改动", value: "0" },
      { label: "远端更新", value: "0" },
      { label: "异常", value: "0" },
    ],
    primaryItems: [
      { title: "本地改动", meta: "等待工作副本扫描", status: "空" },
      { title: "远端更新", meta: "检查仓库后显示可更新文件", status: "空" },
      { title: "未版本控制", meta: "状态扫描后显示 unversioned 文件", status: "空" },
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
