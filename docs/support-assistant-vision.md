# Support assistant image analysis (v3.9.40+)

Cozoro Assistant in the **personal support thread** (Messages → Personal) can see resident-uploaded chat photos and answer based on them. Manager **AI draft** uses the same image context.

## What residents do

1. Open **Support** / Messages personal tab.
2. Attach up to **3** JPEG/PNG/WebP images (client compresses to ~2 MB each) with or without text.
3. Send — the assistant replies in the same thread (visible to managers).

Image-only messages (no text) also trigger the assistant.

## What staff see

- The same photos appear in the manager support inbox as before.
- **AI draft** (`POST /manager/support/conversations/:id/ai-draft`) includes images from the **latest resident message** when drafting a reply.

## Backend flow

1. `POST /support/messages` saves the message + attachments under `api/data/chat-attachments/`.
2. If the body is non-empty **or** attachments were sent, `tryAppendAssistantAfterResidentMessage` runs.
3. `runResidentSupportAssistantTurn` (`api/src/resident-support-ai.ts`):
   - Builds the usual text thread context.
   - Loads bytes for attachments on the **latest resident message** via `readChatAttachmentBytes`.
   - Appends multimodal parts (text + inline images) to the last user turn.
4. `completeToolChatRound` (`api/src/llm-tool-chat.ts`) sends images to:
   - **9router** as OpenAI-style `image_url` data URLs, or
   - **Gemini 2.5 Flash** as `inline_data` parts (same pattern as cleaning photo verification).
5. Usage with images is recorded via `recordVisionUsage` (feature `resident_support_thread` / `manager_support_reply_draft`).

## Limits / scope

| Included | Not included (v1) |
|----------|-------------------|
| Personal support thread assistant | Group chats (room / floor / branch) |
| Manager AI draft for that thread | Cozoro Bee tab (no image upload UI) |
| Latest resident message images only (max 3) | Historical images on every older turn |

Disable the support assistant entirely with `RESIDENT_SUPPORT_AI_DISABLED=1`.

## Key files

| File | Role |
|------|------|
| `api/src/chat-attachments.ts` | Save / stream / `readChatAttachmentBytes` |
| `api/src/resident-support-ai.ts` | Assistant turn + draft + image attach |
| `api/src/llm-tool-chat.ts` | Multimodal tool-chat adapter |
| `api/src/index.ts` | Triggers assistant when body **or** attachments present |
| `api/src/cleaning-photo-verification.ts` | Prior art for 9router/Gemini vision |
| `portal/components/support-client.tsx` | Resident upload UI (unchanged for this feature) |
