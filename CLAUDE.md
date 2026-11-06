## graphify
Use `graphify` for codebase questions when `graphify-out/graph.json` exists: `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"`. Prefer `graphify-out/wiki/index.md` for navigation; read `GRAPH_REPORT.md` only when needed. After code changes, run `graphify update .`.

## Git Branching Conventions
Always name git branches strictly according to this format when starting new work:
- Format: `<type>/<STORY-ID>-<short-description>` (or `<type>/<short-description>` if no story/ticket ID exists)
- Allowed prefixes: `feat/` (never `feature/`), `fix/`, `chore/`, `docs/`, `refactor/`
- Story IDs must be uppercase (e.g., `US-01`, `US-02`)
- Descriptions must be lowercase kebab-case (no spaces, underscores, or uppercase)
- Do not append iteration/version suffixes (e.g., no `-v2`, `-v3`)

Examples:
- `feat/US-02-office-login`
- `feat/US-01-provision-office`
- `fix/photo-backed-search-thresholds`
- `chore/setup-headroom`

## Pull Requests
Keep pull requests atomic and small so they are easy to review:
- Prefer one focused change per PR; split larger features into smaller PRs.
- Keep diffs under ~400 lines changed (bigger PRs trigger a warning).
- All 4 checks must pass: `/verify`, build, lint, tests.
- Needs 1 teammate approval (no self-approval).
- Never commit `.env` files; the PR checks fail if any are tracked.

## GitHub
For GitHub tasks, use the `gh` CLI instead of a GitHub MCP server.
