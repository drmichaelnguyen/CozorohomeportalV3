# Cozoro Bot Knowledge Workflow

This document describes how the chatbot stores knowledge, learns from chat history, and serves answers efficiently.

## 1. Knowledge Layers

The bot uses three layers:

1. Curated base knowledge
- File: `Cozoro Knowledge.md`
- Source of truth for policy, pricing framework, promotions, address, operations.

2. Learned Q&A knowledge
- File: `bot/data/learned-qa.json`
- Entries learned from admin/tester corrections.
- Uses approval workflow (`pending`, `approved`, `rejected`).

3. Conversation history
- File: `bot/data/chat-history.jsonl`
- Raw interaction log for analytics and future fine-tuning dataset export.

## 2. Learning Workflow

### Auto-learn entry statuses

- `pending`: learned from admin/tester correction and waiting human review.
- `approved`: allowed into retrieval index and answer context.
- `rejected`: stored for audit, excluded from retrieval.

### Important behavior

- Learned entries are included in RAG only when:
  - `active = true`
  - `status = "approved"`

This prevents noisy or incorrect corrections from degrading answers.

## 3. Admin Review Flow

Admin dashboard URL:

- `/cozoro/dashboard`

In the dashboard:

- "Tri thức chờ duyệt" shows pending learned Q&A entries.
- `Approve` changes status to `approved` and refreshes the knowledge index.
- `Reject` changes status to `rejected` and keeps it out of RAG.

## 4. Retrieval Efficiency Strategy

The search index applies metadata-aware ranking:

1. Topic inference
- Detects topic for each chunk (`pricing`, `discount`, `policy`, `laundry`, `location`, `room_capacity`, etc.).

2. Query topic prefilter effect
- Query/topic match increases ranking.
- Mismatched specialized topics are penalized.

3. Priority boost
- Curated base chunks have higher base priority.
- Learned approved chunks are still competitive, but not dominant by default.

4. Freshness boost
- Chunks with recognizable recent dates can receive a freshness boost.

5. Vietnamese chat normalization
- Incoming questions are normalized for common slang/acronyms before routing and retrieval.
- Example mappings: `ko/k/hok -> không`, `dc -> được`, `bn -> bao nhiêu`, `km -> khuyến mãi`.
- This improves intent detection and retrieval quality for real Facebook-style chat.

6. Router few-shot for Vietnamese shorthand
- The first-stage small model router now receives explicit Vietnamese shorthand examples.
- Goal: reduce false `off_topic` classification for short messages like `km co gi`, `gia bn 3 thang`, `q10 con cho k`.

## 5. Files And Endpoints

Core files:

- `bot/src/learning.ts`
- `bot/src/knowledge/search.ts`
- `bot/src/knowledge/service.ts`
- `bot/src/answering.ts`
- `bot/src/index.ts`

Useful endpoints:

- `GET /learning/status`
- `GET /learning/examples?limit=...`
- `POST /learning/import-qa`
- `POST /learning/import-conversations`
- `POST /cozoro/learned/:id/status` (admin dashboard form post)

## 6. Operational Recommendations

1. Keep base policy docs short and explicit.
2. Review pending entries daily before high-traffic periods.
3. Reject corrections containing insults, sarcasm, or private data.
4. Approve only stable policy answers and repeatable sales responses.
5. When policy changes, update curated knowledge first, then refresh index.

## 7. Fine-Tuning Preparation Notes

For future fine-tuning dataset creation:

1. Start from `chat-history.jsonl`.
2. Join with approved Q&A from `learned-qa.json`.
3. Exclude entries with:
- private identifiers
- rejected status
- uncertain or contradictory policy statements

This gives a high-quality supervised dataset with lower hallucination risk.
