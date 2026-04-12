# Mac Air M1 Hosting Guide

This repo can run on an Apple Silicon Mac, but the easiest transition is to treat the Mac as a fresh install instead of copying Windows build output.

## Copy These Files

Bring the repo plus the runtime files that are intentionally not tracked in git:

- `api/.env`
- `portal/.env.local`
- `api/.google-oauth.json` if you use Google Sheets / Calendar OAuth
- `bot/.env` if you want the Messenger bot on the Mac too
- `guest-booking-standalone/.env` if you plan to host the hostel booking site there
- any Cloudflare tunnel config or credentials you actually use

## Do Not Reuse These From Windows

Delete these on the Mac before you build:

- `node_modules/`
- `portal/.next/`
- `api/dist/`
- `bot/dist/`

Those folders contain platform-specific binaries or compiled output and are the most common source of "it worked on Windows, why is the Mac weird?" problems.

## Recommended Toolchain

- Node 20 LTS
- `corepack` using the repo-pinned pnpm version
- MySQL reachable from the Mac using the host/port inside `api/.env`

This repo now includes `.nvmrc`, so `nvm use` on the Mac should land on the right major version if you use `nvm`.

## Quick Start

From the repo root on the Mac:

```bash
corepack pnpm host:doctor
corepack pnpm host:build
corepack pnpm host:start
corepack pnpm host:status
```

To stop the managed processes:

```bash
corepack pnpm host:stop
```

## What The Host Commands Do

### `host:doctor`

Checks the Mac-ready basics:

- required env files exist
- copied build output is still present
- `node_modules` appears to contain binaries from the wrong platform
- portal API target looks consistent with the API port
- bot API target looks consistent with the API port
- `cloudflared` is available if you intend to expose public domains

### `host:build`

Prepares the Mac from a copied checkout:

- removes copied build artifacts
- installs dependencies with the pinned pnpm version
- regenerates Prisma client for the current machine
- builds the API, portal, and bot

### `host:start`

Starts the services in the background and writes logs to:

- `.codex-logs/host-stack/logs/api.log`
- `.codex-logs/host-stack/logs/portal.log`
- `.codex-logs/host-stack/logs/bot.log`

The bot is only started if `bot/.env` exists.
The guest-booking service is also started when `guest-booking-standalone/.env` exists.

## One-File Transfer

From the current Windows machine you can now build a Mac-ready package with:

```powershell
corepack pnpm export:mac
```

That export includes:

- the repo contents
- `.env` / `.env.local` runtime files
- `api/.google-oauth.json`
- Cloudflare tunnel config plus tunnel credentials
- a MySQL dump based on `api/.env`
- `launch-on-mac.command` and `stop-on-mac.command`

On the Mac, unzip it and run:

```bash
bash ./launch-on-mac.command
```

That launcher will:

- install Homebrew if needed
- install Node 20, `cloudflared`, and MySQL if needed
- restore the packaged MySQL dump when the app is using a local database
- rebuild the app for the Mac
- start the app stack
- start the Cloudflare tunnel

## Public Hosting Notes

### Cloudflare tunnel

If this Mac will replace the current public host, install `cloudflared` on the Mac and make sure only the intended machine is running the tunnel at a time. Running the same tunnel from two computers can split traffic and create random `502` failures if one machine is missing part of the stack.

### Next.js / API ports

The host scripts read:

- API port from `api/.env`
- Portal port from `portal/.env.local`
- Bot port from `bot/.env`

Before you move, make sure:

- `portal/.env.local` points `API_SERVER_ORIGIN` at the API port you actually want
- `bot/.env` points `BOT_API_BASE_URL` at that same API host/port if the bot stays enabled

### Prisma / MySQL

Prisma is regenerated during `host:build`, which is important on Apple Silicon. If database access fails on the Mac, the first thing to check is the `DATABASE_URL` inside `api/.env`.

## Suggested Migration Flow

1. Copy the repo and the non-git env/credential files to the Mac.
2. Remove `node_modules`, `.next`, and existing `dist` folders if they came over from Windows.
3. Run `corepack pnpm host:doctor`.
4. Fix anything the doctor reports.
5. Run `corepack pnpm host:build`.
6. Run `corepack pnpm host:start`.
7. Confirm the portal, API, and optional bot logs look healthy.
8. Only then point the public tunnel or DNS at the Mac.
