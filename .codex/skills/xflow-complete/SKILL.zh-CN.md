---
name: xflow-complete
description: 完成一个 xflow 功能并写入 Release Note。当用户调用 /xflow-complete、xflow complete、/xflow:complete，或要求结束一个功能 Spec 时使用。
---

# xflow Complete

## 目标

完成一个功能，总结本次工作，并维护 `.xflow/releases/` 下的 Release 文件。

不要预先生成 `.xflow/`。只有当本命令需要某个目录或文件，并且它还不存在时，才创建它。

## 命令

以下写法等价：

- `/xflow-complete <feature-name>`
- `/xflow:complete <feature-name>`
- `xflow complete <feature-name>`

## 流程

1. 使用用户 complete 命令中给定的原始 `<feature-name>`，从 `.xflow/tasks/<feature-name>.md` 读取当前功能的任务 Spec。
2. 检查代码和 Git 状态，并把它们作为事实来源。
3. 如果任务 Spec、代码或 Git 状态不足以写清背景、改动、影响和风险，先提出聚焦问题，获得回答后再写 Release 条目。
4. 确保 `.xflow/releases/` 存在。
5. 使用 `.xflow/releases/<feature-name>.md` 作为 Release 文件路径。
6. 如果 Release 文件不存在，使用 Release File 模板创建，并写入本次 Release 条目。
7. 如果 Release 文件已经存在，把本次 Release 条目追加到 Release Log 顶部，旧条目保留在下方。
8. 每次 Release 条目必须包含背景、改动、影响和风险。
9. 除非用户要求保留，否则删除已完成的任务 Spec。
10. complete 完成后，自动询问用户是否需要执行 learn 来沉淀长期项目知识。只有用户确认后，才使用用户给定的主题或本次功能名进入 xflow-learn 流程。

## 命名

- 任务 Spec：`.xflow/tasks/<feature-name>.md`
- Release 文件：`.xflow/releases/<feature-name>.md`
- 必须原样保留用户命令里的名称，包括语言、拼写、大小写和分隔符。
- 不要翻译、总结、转小写、改成 kebab-case，或用其他方式重写名称。

## Release File 模板

```markdown
# Release: <name>

## Release Log
```

## Release Entry 模板

```markdown
### YYYY-MM-DD <summary>

#### 背景

#### 改动

#### 影响

#### 风险
```

## 原则

- 代码 + Git = 真相。
- Release Note = 历史总结。
- Spec = 临时上下文。
