---
name: xflow-start
description: Starts a new xflow feature spec. Use when the user invokes /xflow-start, xflow start, /xflow:start, or asks to open a new feature task with durable AI context.
---

# xflow Start

## Purpose

Open a new feature and create a temporary task spec under `.xflow/tasks/`.

Do not pre-generate `.xflow/`. Create directories and files only when this command needs them and they do not already exist.

## Command

Accept these forms as equivalent:

- `/xflow-start <feature-name>`
- `/xflow:start <feature-name>`
- `xflow start <feature-name>`

## Workflow

1. If `.xflow/ai-context.md` exists, read it. If it does not exist, continue and create it only when durable project knowledge must be stored.
2. Ensure `.xflow/tasks/` exists.
3. Use the exact `<feature-name>` provided in the user's start command as the task spec name and path segment: `.xflow/tasks/<feature-name>.md`.
4. If a task spec with the same name already exists, stop and ask the user to choose one option:
   - Abandon the previous spec and create a new one with the same name.
   - Continue the previous spec.
   - Use a different new feature name.
5. Create the task spec from the template only after the name is confirmed.
6. Fill the initial task spec with what is already known about the goal, background, requirements, and forbidden changes.
7. After creating the task spec, automatically enter a planning-style clarification phase:
   - Summarize what is known from the user's request and the current spec.
   - Ask focused questions for missing requirements, constraints, edge cases, and non-goals.
   - Update the task spec after the user answers.
   - Continue until the spec is specific enough to guide implementation.
8. When the spec is ready to guide implementation, summarize the current goal and task list, then ask whether to run `xflow:do <feature-name>` on the current spec.
9. If the user confirms, proceed as if the user invoked `xflow:do <feature-name>`.
10. If the user declines or does not clearly confirm, stop after creating or updating the spec.
11. Do not start coding after `xflow-start` unless the user explicitly confirms the `xflow:do` handoff or otherwise asks to begin implementation.

## Do Handoff Timing

Ask whether to run `xflow:do <feature-name>` only when all of these are true:

- The spec has no unresolved blocking questions.
- The task list contains at least one actionable unchecked task.
- The goal, requirements, and non-goals are specific enough to implement without guessing.

Do not ask if the user only wanted to create a draft spec, if the task list is empty, or if implementation would require unresolved product or technical decisions.

## Naming

- Task spec: `.xflow/tasks/<feature-name>.md`
- Preserve the user's command name exactly, including language, spelling, casing, and separators.
- Do not translate, summarize, lowercase, kebab-case, or otherwise rewrite the name.
- If the provided name contains characters that are unsafe for file paths, stop and ask the user for a valid replacement name.

## Task Template

```markdown
# Task: <name>

## 目标

一句话说明。

## 背景

为什么做。

## 修改要求

- 必须遵守：
- 不允许做：

## 任务列表

- [ ] 

## 待确认问题

- 
```

## Principles

- Code + Git = truth.
- Spec = temporary context.
- AI Context = durable project knowledge.
