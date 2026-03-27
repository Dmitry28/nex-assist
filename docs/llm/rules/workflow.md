# Workflow Loop

One loop for all tasks. Plan depth scales with task complexity — a simple fix needs 2-3 lines; a multi-milestone feature needs full breakdown.

## 1. Plan

- Gather context: read existing code, docs, related files — verify theory before making claims
- Describe the solution; for complex tasks — add non-goals, milestones, acceptance criteria
- **Self-validate**: are all edge cases covered? are all claims grounded in actual code/docs?
- For complex tasks — document key architectural decisions: what was chosen vs. rejected and why (prevents re-deliberation)
- Get approval: wait for user confirmation before implementing

## 2. Implement

- For complex tasks: complete one milestone at a time, define scope boundaries (what's in and explicitly out per milestone)
- Keep changes focused and atomic
- Implement → verify → report results. **Commit only after explicit approval.**
- After opening a PR — always open it in the browser: `open <pr_url>`
- Reflect on what was learned during implementation — if new findings affect the solution, address them before moving on

## Git workflow

- Branch off `dev`, PR to `dev` — never directly to `main`
- Merge with `gh pr merge --merge` (squash is disabled)
- `main` is for releases and GitHub Actions only

## 3. Verify

- Confirm the plan step is fully realized (nothing skipped)
- Run `/verify-task-result` on changed files
- Quick self-check: architecture, types, naming conventions

## 4. Fix

- Address failures immediately — don't defer issues to later milestones
- Minor non-critical improvements can be left as `// TODO:` comments to address later

_(Repeat steps 2–4 for each milestone)_

---

**After all work is complete — run every step in order, do not skip:**

1. Run `/verify-task-result` with full checks
2. Run `/review-code` — all changes that will go into the PR
3. Fix any issues found in steps 1-2
4. Cover critical logic with tests if not yet covered — only after implementation is approved, only what matters
5. Update docs if architecture/patterns/logic changed

---

## Scaling Guide

| Task size          | Plan                       | Milestones                 | Progress tracking         |
| ------------------ | -------------------------- | -------------------------- | ------------------------- |
| Simple (1 step)    | 2–3 lines                  | —                          | —                         |
| Medium (2–3 steps) | Solution + non-goals       | 2–3 explicit               | —                         |
| Complex (3+ steps) | Full breakdown + decisions | Each with scope boundaries | Externalized progress log |

### Externalized Progress (complex tasks)

For long tasks, maintain a progress section in the plan (or a scratch file) that survives context compression:

- Completed milestones (one-liner each)
- Current milestone and remaining work
- Key decisions made (one-liner each)
- Known issues to address later

Update after each milestone. This acts as durable memory the agent can re-read to stay oriented.
