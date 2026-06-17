# Contributing to vualet-web

The full rules live in [`CLAUDE.md`](./CLAUDE.md). The short version:

## Branching model

- **`main`** — production. Protected. No direct pushes.
- **`develop`** — integration branch; all good code lives here. Protected. No direct pushes.
- You **branch off `develop`**, do your work, and open a **PR back into `develop`**.

```bash
git checkout develop && git pull
git checkout -b feature/my-thing      # feature | fix | chore | docs | refactor
# ...work...
npm run lint && npm run build         # both must pass
git push -u origin feature/my-thing
# open a PR into develop, get review, squash-merge
```

Releases go `develop → main` via PR.

## First-time setup

Enable the local guard that blocks accidental direct pushes to protected branches:

```bash
git config core.hooksPath .githooks
```

(Server-side branch protection is the real lock; the hook is a courtesy and can be
bypassed with `--no-verify`.)

## Rules

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).
- **Never commit secrets.** Use environment variables; `.env*` is git-ignored.
- Keep `CLAUDE.md` and docs in sync with code changes.
- Lint + build must pass before requesting review.
