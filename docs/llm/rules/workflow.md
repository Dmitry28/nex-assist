# Workflow Loop

One loop for all tasks. Plan depth scales with task complexity.

## 1. Plan

- Gather context: read existing code, docs, related files — verify theory before making claims
- Describe the solution; for complex tasks — add non-goals, milestones, acceptance criteria
- **Self-validate**: are all edge cases covered? are all claims grounded in actual code/docs?
- For complex tasks — document key architectural decisions: what was chosen vs. rejected and why
- Get approval: wait for user confirmation before implementing

## 2. Implement

- For complex tasks: complete one milestone at a time
- Keep changes focused and atomic
- Implement → verify → report results. **Commit only after explicit approval.**
- After opening a PR — always open it in the browser: `open <pr_url>`

## 3. Verify

- Confirm the plan step is fully realized (nothing skipped)
- Run `/verify-task-result` on changed files
- Quick self-check: architecture, types, naming conventions

## 4. Fix

- Address failures immediately
- Don't defer issues to later milestones

_(Repeat steps 2–4 for each milestone)_

---

**After all work is complete — run in order:**

1. Run `/verify-task-result`
2. Run `/review-code`
3. Fix any issues found
4. Cover critical logic with tests if not yet covered
5. Update docs if architecture/patterns changed

---

## Scaling Guide

| Task size          | Plan                       | Milestones  |
| ------------------ | -------------------------- | ----------- |
| Simple (1 step)    | 2–3 lines                  | —           |
| Medium (2–3 steps) | Solution + non-goals       | 2–3         |
| Complex (3+ steps) | Full breakdown + decisions | Each scoped |

### Externalized Progress (complex tasks)

For long tasks, maintain a progress section in the plan:

- Completed milestones (one-liner each)
- Current milestone and remaining work
- Key decisions made
- Known issues to address later
