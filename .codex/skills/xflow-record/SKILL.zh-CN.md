---
name: xflow-record
description: 将用户提供的内容直接记录到 xflow AI Context。当用户调用 /xflow-record、xflow record、/xflow:record，或要求保存明确的项目知识时使用。
---

# xflow Record

## 目标

将用户提供的内容直接记录到 `.xflow/ai-context.md`。

不要预先生成 `.xflow/`。只有当本命令需要某个目录或文件，并且它还不存在时，才创建它。

## 命令

以下写法等价：

- `/xflow-record <content>`
- `/xflow:record <content>`
- `xflow record <content>`

## 流程

1. 将用户提供的内容作为需要持久化的来源。
2. 确保 `.xflow/` 存在。
3. 如果 `.xflow/ai-context.md` 存在，编辑前先读取；如果不存在，则使用 AI Context 模板创建。
4. 将内容添加或合并到 `.xflow/ai-context.md` 最合适的章节。
5. 如果内容含义不明确，或无法判断应写入哪个章节，先提出聚焦问题，确认后再记录。
6. 保留用户原意，但表述要简洁、可复用。
7. 不创建或修改任务 Spec、Release Note。

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
- 保留用户原意。
- 不修改任务 Spec 或 Release Note。
