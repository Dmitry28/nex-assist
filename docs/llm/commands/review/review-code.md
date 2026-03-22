# Review Code

Review code changes using team CCR rules.

## What to Analyze

All changes in branch vs `origin/dev`:

```bash
git diff origin/dev..HEAD --name-only
git diff origin/dev..HEAD
```

## Rules

Apply all rules from [docs/llm/rules/code-review.md](../../rules/code-review.md).

## Output

No explanations, only the review output.
