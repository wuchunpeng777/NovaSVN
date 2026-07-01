---
name: xflow-do
description: Executes the task list in an xflow spec. Use when the user invokes /xflow-do, xflow do, /xflow:do, or asks to implement tasks from a named spec or spec file.
---

# xflow Do

## Purpose

Execute the task list from an existing xflow task spec.

Do not pre-generate `.xflow/`. Create directories and files only when the implementation itself needs them.

## Command

Accept these forms as equivalent:

- `/xflow-do <feature-name-or-file>`
- `/xflow:do <feature-name-or-file>`
- `xflow do <feature-name-or-file>`

## Input Resolution

1. If `<feature-name-or-file>` points to an existing file, read that file as the task spec.
2. Otherwise, read `.xflow/tasks/<feature-name-or-file>.md`, preserving the user's input exactly as the task name.
3. If no spec file is found, stop and tell the user which paths were checked.
4. If multiple task-like sections exist, prefer `## 任务列表`, `## Task List`, `## Tasks`, or `## Todo`.

## Workflow

1. If `.xflow/ai-context.md` exists, read it before implementation.
2. Read the resolved task spec.
3. Extract the task list from markdown checkboxes:
   - Incomplete tasks: `- [ ]`, `* [ ]`, or `+ [ ]`.
   - Completed tasks: `- [x]`, `* [x]`, or `+ [x]`.
4. If the spec has no incomplete task list, stop and ask the user whether to add tasks to the spec or proceed from a specific instruction.
5. Execute incomplete tasks in spec order.
6. Keep edits scoped to the spec. Do not implement requirements that are not in the spec unless the user explicitly expands the scope.
7. Mark each task as completed in the spec only after the corresponding implementation and verification are done.
8. If a task is blocked by missing information, failing tests, or conflicting requirements, stop, leave that task unchecked, and ask a focused question.
9. When all tasks are done, summarize the implementation and verification.

## Task Updates

- Preserve the user's task wording.
- Change only the checkbox marker from unchecked to checked when completing a task.
- Do not delete tasks, reorder tasks, or rewrite the spec unless the user asks.

## Verification

- Run the smallest useful verification command available for the implemented changes.
- If no verification can be run, explain why.
- Treat code and Git state as the source of truth if they differ from the spec.

## Principles

- Spec = implementation plan.
- Code + Git = truth.
- Complete only what the task list asks for.
