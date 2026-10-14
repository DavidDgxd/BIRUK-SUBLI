## What changed

<!-- One or two sentences. Link the issue/story if there is one. -->

## How tested

<!-- Commands run, manual steps, or "not run — reason". -->

## Story ID

<!-- e.g. US-04. Leave blank if there is no ticket. -->

## Checklist

- [ ] Branch named `<type>/<STORY-ID>-<short-description>` (feat, fix, chore, docs, refactor)
- [ ] No `.env*` files or secrets committed
- [ ] CI green: hygiene, web, ai-service, schema
- [ ] Diff under ~400 lines — split into smaller PRs if it is larger
- [ ] Schema changes include RLS, and `search_path` wherever `SECURITY DEFINER` is used
