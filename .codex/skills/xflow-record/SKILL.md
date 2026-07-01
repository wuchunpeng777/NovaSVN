---
name: xflow-record
description: Records user-provided content directly into xflow AI context. Use when the user invokes /xflow-record, xflow record, /xflow:record, or asks to save explicit project knowledge.
---

# xflow Record

## Purpose

Directly record user-provided content into `.xflow/ai-context.md`.

Do not pre-generate `.xflow/`. Create directories and files only when this command needs them and they do not already exist.

## Command

Accept these forms as equivalent:

- `/xflow-record <content>`
- `/xflow:record <content>`
- `xflow record <content>`

## Workflow

1. Treat the user-provided content as the source material to persist.
2. Ensure `.xflow/` exists.
3. If `.xflow/ai-context.md` exists, read it before editing. If it does not exist, create it from the AI Context Template.
4. Add or merge the content into the most relevant section of `.xflow/ai-context.md`.
5. If the content is ambiguous or its target section is unclear, ask focused clarification questions before recording it.
6. Preserve the user's meaning, but keep the wording concise and reusable.
7. Do not create or modify task specs or release notes.

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
- Preserve the user's meaning.
- Do not modify task specs or release notes.
