# Review Code

Review code changes using team CCR rules.

## What to Analyze

All changes in branch vs `origin/dev-nestjs`:

```bash
git diff origin/dev-nestjs..HEAD --name-only
git diff origin/dev-nestjs..HEAD
```

## Rules

Apply all rules from [docs/llm/rules/code-review.md](../../rules/code-review.md).

## Output

No explanations, only the review output.
