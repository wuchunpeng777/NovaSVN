---
name: xflow-learn
description: Extracts durable project knowledge into xflow AI context. Use when the user invokes /xflow-learn, xflow learn, /xflow:learn, or asks to remember stable project facts from current work.
---

# xflow Learn

## Purpose

Persist stable, reusable project knowledge in `.xflow/ai-context.md`.

Do not pre-generate `.xflow/`. Create directories and files only when this command needs them and they do not already exist.

## Command

Accept these forms as equivalent:

- `/xflow-learn <topic>`
- `/xflow:learn <topic>`
- `xflow learn <topic>`

## Workflow

1. If `.xflow/ai-context.md` exists, read it.
2. Extract only stable, reusable project facts from the current work.
3. If it is unclear whether something is durable project knowledge, ask focused clarification questions before writing it.
4. Ensure `.xflow/` exists.
5. Create or update `.xflow/ai-context.md`.
6. Do not add temporary task details, speculation, or one-off decisions.

## AI Context Template

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

## Principles

- AI Context = durable project knowledge.
- Temporary task details do not belong in AI Context.
