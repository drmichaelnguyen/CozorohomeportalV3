# Cozorohome Portal V3

This repo contains the Cozorohome user portal and API.

## Structure

- `portal/`: Next.js frontend for users and admin pages
- `api/`: Express + Prisma backend
- `portal/feedback/`: locally saved user feedback files

## Requirements

- Node.js 20+ recommended
- `pnpm`
- Git

## First-Time Setup

1. Clone the repo:

```bash
git clone https://github.com/drmichaelnguyen/CozorohomeportalV3.git
cd CozorohomeportalV3
```

2. Install dependencies:

```bash
pnpm install
```

3. Add local environment files and credentials.

You may need local-only files that are not stored in GitHub, such as:

- root `.env` if used locally
- `portal/.env.local`
- `api/.env` if used on your machine
- `api/.google-oauth.json`
- any Google Sheets or Calendar credentials

4. Generate Prisma client if needed:

```bash
pnpm --filter cozorohome-api prisma:generate
```

## Run The App

Run both frontend and backend together from the repo root:

```bash
pnpm dev
```

Expected local services:

- frontend: `http://localhost:3000`
- API: `http://127.0.0.1:4000`

The frontend is set up to proxy API calls through Next in local dev, so tunnel use should point at the frontend on port `3000`.

## Useful Commands

Run the frontend only:

```bash
pnpm --filter cozorohome-portal dev
```

Run the API only:

```bash
pnpm --filter cozorohome-api dev
```

Type-check the frontend:

```bash
.\portal\node_modules\.bin\tsc.cmd --noEmit -p .\portal\tsconfig.json
```

Type-check the API:

```bash
.\api\node_modules\.bin\tsc.cmd --noEmit -p .\api\tsconfig.json
```

## Git Workflow

Typical workflow:

```bash
git status
git add .
git commit -m "your message"
git push
```

If using a new machine, sign in to GitHub and configure Git if needed:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Notes For Other Devices

GitHub syncs the code, but not your local secrets or this exact chat session.

When moving to another device, you still need to:

- clone the repo
- copy local env/credential files
- install Node.js and `pnpm`
- start a new Codex/ChatGPT chat in this project folder

Good resume prompt:

```text
This is my CozorohomeportalV3 project. Please inspect the repo and continue helping me from the current state. Start by reading HANDOFF.md.
```
