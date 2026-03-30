# Cozorohome Bot

This package is the isolated customer-support bot service for Facebook Messenger. It is intentionally separate from the main portal and API so chatbot failures do not interrupt the live web app.

## Runtime separation

The chatbot is a separate service from the main app:

- `portal/` is the customer-facing web app
- `api/` is the main backend for portal business data
- `bot/` is the Messenger chatbot service

Important runtime note:

- the chatbot public hostname `https://chatbot.cozorohome.com` is exposed through its own Cloudflare Tunnel
- that tunnel is configured to send traffic to `http://127.0.0.1:4111`
- for the public chatbot to work, the bot must be running on Windows on port `4111`
- running the bot only inside WSL is useful for local dev, but Windows `cloudflared.exe` may not be able to reach that WSL process through `127.0.0.1`

In practice:

- use Windows bot scripts when you need the live tunnel-connected chatbot
- use WSL dev mode when you only need local development and debugging

## What it does now

- exposes a health endpoint
- exposes Facebook webhook verify + receive endpoints
- loads a curated knowledge base from local files and optional remote text URLs
- performs lightweight retrieval before answer generation
- can use a hosted LLM provider, with Gemini free tier as the preferred default
- uses a small model route check before sending deeper approved questions to the larger answer model
- uses local prompt-tuning data for both the router model and the answer model
- denies off-topic questions early to save tokens
- can learn new Q&A pairs from Facebook admin replies and imported chat history
- refuses personalized account-style questions by default until identity verification is added

## Why this shape

- `portal/` stays focused on customer UI
- `api/` remains the source of truth for live business data
- `bot/` handles Facebook, retrieval, and LLM orchestration independently

## Safe knowledge sources

Only load customer-safe documents into the bot. Do not point it at internal runbooks, secrets, or operational notes.

Recommended sources:

- the combined root knowledge file `Cozoro Knowledge.md`
- remote Google Docs and other URLs listed in `bot/sources/remote-sources.json`
- exported Google Docs text URLs such as `https://docs.google.com/document/d/<doc-id>/export?format=txt`
- approved public policy documents from the repo when you are ready

## Run locally

```bash
pnpm install
cp bot/.env.example bot/.env
pnpm dev:bot
```

## Run modes

There are two common ways to run this bot:

1. WSL/local dev mode

```bash
COREPACK_HOME=/tmp/corepack TMPDIR=/tmp corepack pnpm --filter cozorohome-bot dev
```

Use this for local editing and debugging. By default this runs on the bot's local dev port and is separate from the public Cloudflare route.

2. Windows/tunnel-connected mode

Use the Windows helper scripts in this repo when you need `chatbot.cozorohome.com` to work:

- `bot/start-bot-win.ps1`
- `bot/run-bot-win.cmd`
- `start-bot-wsl.bat start`
- `start-bot-wsl.bat restart`
- `start-bot-wsl.bat diagnose`

This mode runs the bot on port `4111`, which matches the chatbot Cloudflare Tunnel config.

Recommended hosted free-tier setup:

- create a free Gemini API key in Google AI Studio: [ai.google.dev](https://ai.google.dev/)
- set `BOT_LLM_PROVIDER=gemini`
- set `GEMINI_API_KEY=...`
- keep `BOT_ROUTER_MODEL=gemini-2.5-flash-lite`
- keep `BOT_ANSWER_MODEL=gemini-2.5-flash`

Notes:

- keep referral name and phone checks on the server-side prospect API only
- do not send current-client identity, account, or phone details to the LLM
- Gemini free tier is suitable for a low-volume Messenger pilot, but it is still a provider free tier and can change

## Chat Learning

The bot now supports a lightweight learning layer separate from the main curated knowledge file:

- customer messages and replies are stored in local learning files under `bot/data/`
- if a customer asks on Facebook and a page admin replies manually afterward, the bot can pair that Q&A and store it as learned knowledge
- bot-generated replies are tracked so the bot does not accidentally learn from its own echoed messages
- historical chats can be imported later and converted into learned Q&A pairs
- router training examples are stored locally in `bot/data/router-training.json`
- approved manual trainer entries are reused as few-shot local answer examples
- router examples can now be added, reviewed, edited, and deleted from `/cozoro/trainer`

Guardrail:

- this learning layer is useful for conversational adaptation, but it should not override newer dated branch snapshots or formal policy rules

Knowledge operations guide:

- see `docs/BOT_KNOWLEDGE_WORKFLOW.md` for approval flow (`pending/approved/rejected`), metadata-aware retrieval strategy, and fine-tuning prep notes
- see `docs/BOT_OPERATIONS_VI.md` for day-to-day Vietnamese runbook (dashboard review, API checks, backup checklist)

## Endpoints

- `GET /health`
- `GET /knowledge/status`
- `POST /knowledge/refresh`
- `GET /learning/status`
- `GET /learning/examples`
- `POST /learning/import-qa`
- `POST /learning/import-conversations`
- `POST /ask`
- `POST /prospect/ask`
- `GET /webhooks/facebook`
- `POST /webhooks/facebook`

Example import payload for historical Q&A:

```json
{
  "entries": [
    {
      "question": "Cozoro có máy sấy không?",
      "answer": "D7 có máy sấy nha quý khách.",
      "source": "facebook-history",
      "channel": "facebook"
    }
  ]
}
```

Example import payload for conversation history:

```json
{
  "conversations": [
    {
      "channel": "facebook",
      "source": "fanpage-export",
      "conversationKey": "thread-001",
      "messages": [
        { "role": "customer", "text": "Cho em hỏi D7 còn chỗ không?" },
        { "role": "admin", "text": "Dạ hiện vẫn còn nha quý khách." }
      ]
    }
  ]
}
```

## Next safe steps

- add approved policy and pricing docs to `bot/knowledge/`
- connect selected Google Docs exports
- add handoff to human support for uncertain answers
- add verified account linking before exposing personal balances, fines, or bookings
