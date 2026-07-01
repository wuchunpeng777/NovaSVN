---
name: xflow-learn
description: 将长期项目知识提取到 xflow AI Context。当用户调用 /xflow-learn、xflow learn、/xflow:learn，或要求记住当前工作里的稳定项目事实时使用。
---

# xflow Learn

## 目标

将稳定、可复用的项目知识持久化到 `.xflow/ai-context.md`。

不要预先生成 `.xflow/`。只有当本命令需要某个目录或文件，并且它还不存在时，才创建它。

## 命令

以下写法等价：

- `/xflow-learn <topic>`
- `/xflow:learn <topic>`
- `xflow learn <topic>`

## 流程

1. 如果 `.xflow/ai-context.md` 存在，先读取它。
2. 只提取当前工作中稳定、可复用的项目事实。
3. 如果无法判断某项内容是否属于长期项目知识，先提出聚焦问题，确认后再写入。
4. 确保 `.xflow/` 存在。
5. 创建或更新 `.xflow/ai-context.md`。
6. 不要写入临时任务细节、猜测或一次性决策。

## AI Context 模板

```markdown
# AI Context

This file stores durable project knowledge for xflow. Update it with `/xflow:learn` or `/xflow:record` when project-level facts change.

## Project Overview

- Type: TBD
- Goals: TBD

## Tech Stack

- Languages: TBD
- Frameworks: TBD
- Runtime: TBD

## Architecture Notes

- Structure: TBD
- Key modules: TBD

## Quality Constraints

- Performance: TBD
- Security: TBD
- Compatibility: TBD

## Code Standards

- Keep code scoped to the active task spec.
- Prefer existing project patterns over new abstractions.
- Use readable names and small, focused methods.
- Treat code and Git state as the source of truth.

## xflow Notes

- Active specs live in `.xflow/tasks/`.
- Completed work is summarized in `.xflow/releases/`.
- Abandoned work is summarized in `.xflow/history/`.
- Temporary task details do not belong in this file.
```

## 原则

- AI Context = 长期项目知识。
- 临时任务细节不属于 AI Context。
