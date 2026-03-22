# Generate PR Description

Generate GitHub PR title and description for all changes in current branch.

## What to Analyze

1. **Branch info:**
   - Run `git branch --show-current`

2. **All commits in branch:**
   - Run `git log origin/dev-nestjs..HEAD --no-merges --format="%s%n%b%n---"`

3. **All code changes:**
   - Run `git diff origin/dev-nestjs..HEAD --stat`
   - Run `git diff origin/dev-nestjs..HEAD`

4. **Conversation history** for context

## Output Format

Follow the project PR template from `.github/pull_request_template.md`:

```markdown
## What
<what was done — 1-3 bullet points>

## Why
<why the change was needed>

## How
<key implementation details, non-obvious decisions>

## Checklist
- [ ] Code follows project conventions
- [ ] Tests added/updated
- [ ] `.env.example` updated if new env variables added
- [ ] No secrets or sensitive data committed
```

**PR Title:** `<type>: <brief description>` — lowercase, imperative mood, max 70 chars.

## Output Rules

- NO explanations or process descriptions
- Output ONLY the PR title and description in a markdown code block
- Follow Conventional Commits types: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`
- Keep it concise — focus on outcomes, not implementation details
