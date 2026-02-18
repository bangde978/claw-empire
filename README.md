# CLImpire

CLImpire is a local-first AI agent office simulator with a React + Vite frontend and an Express + SQLite backend.

## One-Shot Install (Repo URL only)

Run this block as-is after replacing `REPO_URL`:

```bash
REPO_URL="https://github.com/<org>/<repo>.git"
git clone "$REPO_URL" climpire
cd climpire

corepack enable
pnpm install
cp .env.example .env

# Replace the first __CHANGE_ME__ (OAUTH_ENCRYPTION_SECRET) with a random value.
node -e "const fs=require('fs');const crypto=require('crypto');const p='.env';const next=fs.readFileSync(p,'utf8').replace('__CHANGE_ME__',crypto.randomBytes(32).toString('hex'));fs.writeFileSync(p,next);"

pnpm run preflight:public
pnpm dev:local
```

Open:

- Frontend: `http://127.0.0.1:5173`
- API health: `http://127.0.0.1:8787/healthz`

## Requirements

- Node.js `>= 22`
- `pnpm` (via `corepack enable`)

## Environment Variables

Copy `.env.example` to `.env` and set real values only on your local machine.

- Required: `OAUTH_ENCRYPTION_SECRET`
- Optional: `PORT`, `HOST`, `DB_PATH`, `LOGS_DIR`, `OAUTH_BASE_URL`
- OAuth: `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`
- Provider keys: `GEMINI_OAUTH_CLIENT_ID`, `GEMINI_OAUTH_CLIENT_SECRET`, `OPENAI_API_KEY`
- GCP: `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID`

## Run Modes

Development (local-only bind):

```bash
pnpm dev:local
```

Production-style local run:

```bash
pnpm build
pnpm start
```

Health check:

```bash
curl -fsS http://127.0.0.1:8787/healthz
```

## Public Release Preflight

Before pushing to a public GitHub repository:

```bash
pnpm run preflight:public
```

The preflight checks:

- `.gitignore` has required public-release entries.
- `.env`/runtime files/credential files are not tracked.
- tracked files and full git history do not contain high-confidence secret patterns.
- `.env.example` covers runtime variables and uses a consistent dummy-key format.
- production build succeeds.

## Final Human Review Gate

Do not run `git push` until all items are confirmed:

1. `pnpm run preflight:public` passed.
2. `.env` contains only local secrets and is ignored by git.
3. No runtime artifacts (`logs/`, `*.sqlite*`, `dist/`) are tracked.
4. This repository has completed final maintainer review for public release.
