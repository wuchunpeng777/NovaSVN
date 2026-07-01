---
name: xflow-abandon
description: 放弃一个 xflow 功能并记录后续重启上下文。当用户调用 /xflow-abandon、xflow abandon、/xflow:abandon，或要求停止一个功能 Spec 但保留上下文时使用。
---

# xflow Abandon

## 目标

放弃一个功能，并在 `.xflow/history/` 下保留历史记录。

不要预先生成 `.xflow/`。只有当本命令需要某个目录或文件，并且它还不存在时，才创建它。

## 命令

以下写法等价：

- `/xflow-abandon <feature-name>`
- `/xflow:abandon <feature-name>`
- `xflow abandon <feature-name>`

## 流程

1. 使用用户 abandon 命令中给定的原始 `<feature-name>`，从 `.xflow/tasks/<feature-name>.md` 读取当前功能的任务 Spec。
2. 确保 `.xflow/history/` 存在。
3. 如果用户放弃原因、回滚偏好或后续重启建议不明确，先提出聚焦问题，获得回答后再写放弃记录。
4. 使用 Abandoned Note 模板创建 `.xflow/history/YYYY-MM-DD-abandoned-<feature-name>.md`。
5. 包含当前状态、已有部分改动、回滚需要和未来重启建议。
6. 除非用户要求保留，否则删除任务 Spec。
7. 不要回滚代码，除非用户明确要求。

## 命名

- 任务 Spec：`.xflow/tasks/<feature-name>.md`
- 放弃功能记录：`.xflow/history/YYYY-MM-DD-abandoned-<feature-name>.md`
- 必须原样保留用户命令里的名称，包括语言、拼写、大小写和分隔符。
- 不要翻译、总结、转小写、改成 kebab-case，或用其他方式重写名称。

## Abandoned Note 模板

```markdown
## YYYY-MM-DD abandoned <name>

### 放弃原因

### 当前状态

### 已有改动

### 回滚需要

### 后续重启建议
```

## 原则

- 代码 + Git = 真相。
- Spec = 临时上下文。
- 放弃记录只保存后续重启上下文。
