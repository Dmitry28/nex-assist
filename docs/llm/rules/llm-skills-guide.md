# LLM Skills Guidelines

## Core Principles

1. **Skills are thin wrappers** — `.claude/skills/` contains only frontmatter + link to content
2. **Content co-located** — rules live in `docs/llm/`
3. **One link only** — skill references one main doc; that doc can link to others internally
4. **Reusable across IDEs** — works in Claude Code, Cursor, etc.

## Content Quality

Rules and skills must be:

- **Simple, clear, concise** — easy to understand at a glance
- **Essential only** — no redundant explanations or excessive examples
- **Non-obvious only** — skip what LLM can easily infer from code
- **Actionable** — focus on what to do, not what not to do

## File Format (`.claude/skills/name/SKILL.md`)

```yaml
---
name: skill-name
description: Brief description. Use when [specific triggers].
user-invocable: false
allowed-tools: Read
---

Read and apply [topic] rules from [docs/llm/rules/topic.md](../../../docs/llm/rules/topic.md).
```

## Skill Types

| Type           | Config                           | When triggered                      |
| -------------- | -------------------------------- | ----------------------------------- |
| **Background** | `user-invocable: false`          | Auto-loaded by Claude when relevant |
| **Command**    | `disable-model-invocation: true` | Only via `/skill-name`              |

Command skills with large output should use `context: fork`.

## Adding New Skill

1. Create content file in `docs/llm/rules/` or `docs/llm/commands/`
2. Create skill wrapper in `.claude/skills/name/SKILL.md`
3. Add to `docs/llm/README.md` skills table
