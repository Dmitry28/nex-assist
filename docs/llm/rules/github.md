# GitHub Rules

## Language: English only

All content that lands on GitHub must be written in **English**, regardless of the language used while chatting with the user:

- Pull request titles and descriptions
- Commit messages
- PR / issue / review comments
- Issue titles and bodies
- Branch names
- Release notes and tags

Chat with the user in whatever language they use; keep GitHub itself English-only for a consistent, contributor-friendly history.

## PR flow

See [workflow.md](workflow.md) for the branch/release flow. In short: branch off `dev`, PR into `dev`, then promote to `main` via a separate `dev → main` release PR. Never target `main` directly.
