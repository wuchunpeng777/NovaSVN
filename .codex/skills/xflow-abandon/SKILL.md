---
name: xflow-abandon
description: Abandons an xflow feature and records restart context. Use when the user invokes /xflow-abandon, xflow abandon, /xflow:abandon, or asks to stop a feature spec without losing context.
---

# xflow Abandon

## Purpose

Abandon a feature and keep a historical note under `.xflow/history/`.

Do not pre-generate `.xflow/`. Create directories and files only when this command needs them and they do not already exist.

## Command

Accept these forms as equivalent:

- `/xflow-abandon <feature-name>`
- `/xflow:abandon <feature-name>`
- `xflow abandon <feature-name>`

## Workflow

1. Read the active task spec from `.xflow/tasks/<feature-name>.md`, using the exact `<feature-name>` from the user's abandon command.
2. Ensure `.xflow/history/` exists.
3. If the user's reason for abandoning, rollback preference, or future restart guidance is unclear, ask focused clarification questions before writing the abandoned note.
4. Create `.xflow/history/YYYY-MM-DD-abandoned-<feature-name>.md` from the Abandoned Note Template.
5. Include current state, known partial changes, rollback needs, and future restart notes.
6. Delete the task spec unless the user asks to keep it.
7. Do not revert code unless the user explicitly requests it.

## Naming

- Task spec: `.xflow/tasks/<feature-name>.md`
- Abandoned note: `.xflow/history/YYYY-MM-DD-abandoned-<feature-name>.md`
- Preserve the user's command name exactly, including language, spelling, casing, and separators.
- Do not translate, summarize, lowercase, kebab-case, or otherwise rewrite the name.

## Abandoned Note Template

```markdown
## YYYY-MM-DD abandoned <name>

### 放弃原因

### 当前状态

### 已有改动

### 回滚需要

### 后续重启建议
```

## Principles

- Code + Git = truth.
- Spec = temporary context.
- Abandoned notes preserve restart context only.
