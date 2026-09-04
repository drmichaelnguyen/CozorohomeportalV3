# AI behavior logs (CozoroHome portal + API)

All Gemini-powered features in the **API** append to on-disk JSONL logs under `api/data/` (that folder is gitignored; create it at runtime or ensure the process can write there).

## Where logs go

| Log | Path (relative to `api/`) | Contents |
|-----|---------------------------|----------|
| **Unified behavior** | `data/ai-behavior/unified-YYYY-MM-DD.jsonl` | Every **exchange** (user ↔ model text) and every **tool_call** (tool name + args + result JSON strings), all channels in one file. |
| **Training / export (per channel)** | `data/ai-chat-training/<channel>-YYYY-MM-DD.jsonl` | User + model text per channel (legacy format for review / training export). |

Channels:

- `manager` — Manager Settings inline AI (`/manager/ai-chat`).
- `resident_portal` — Resident **Cozoro Bee** (`/resident/portal-ai-chat`). Tools include `get_my_member_status` (tier / coins / ranking policy). Playful VI teen-code tone + gendered address from roster `Giới tính`.
- `resident_support_thread` — Optional assistant in **Messages → Personal** support thread (same thread as staff; stored as `ASSISTANT` messages). Tools include `get_resident_member_status`. Same teen-code / gendered address tone.

## Disable logging

Set `AI_TRAINING_LOG_DISABLED=1` in the API environment. This disables **both** the per-channel training files and the unified behavior file (and tool-call lines).

## Line shapes (unified file)

Each line is one JSON object.

**Model reply (no tool in that step is logged separately as exchange when the handler calls `appendAiTrainingExchange`):**

- `kind`: `"exchange"`
- `channel`, `identifier` (email), optional `language`, `conversationId`
- `userText`, `modelText` (clipped)
- optional `meta` (e.g. `founderEasterEgg`, `geminiQuotaExceeded`, `navigateTo`)

**Tool invocation:**

- `kind`: `"tool_call"`
- `channel`, `identifier`, `toolName`
- `argsJson`, `resultJson` — stringified JSON, clipped (~24k chars each)
- optional `conversationId`, `meta`

## AI systems **not** written to these files

- **Standalone Facebook / chatbot** under repo `bot/` — separate process and logging (`bot/src/learning.ts`, etc.).
- **Prospect assistant** pricing / availability in `api/src/prospect-assistant.ts` — rule-based sheet lookups, not Gemini; no `appendAiTrainingExchange` hook.

## Model

Gemini **2.5 Flash** via Google Generative Language API; resident Bee may use `GEMINI_RESIDENT_PORTAL_AI_API_KEY` with fallback to `GEMINI_API_KEY` (see `resident-portal-ai-chat.ts`).
