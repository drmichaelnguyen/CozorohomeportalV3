import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { makeCleaningAssignmentExplanation, cleaningSelectionFactor } from '../src/cleaning-assignment-explanation.js';

const source = ts.createSourceFile('reviews.ts', readFileSync(new URL('../src/cleaning-assignment-reviews.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source).replace(/^export /, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const chatSource = ts.createSourceFile('chat.ts', readFileSync(new URL('../src/cleaning-review-chat.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const chatCode = ts.transpileModule(chatSource.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(chatSource).replace(/^export /, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const task = { id: 'task', userEmail: 'resident@example.com', userName: 'Resident', branchId: 'D7', type: 'TRASH_D7', scheduledDate: new Date('2026-10-12'), assignmentSource: 'SYSTEM', assignmentExplanation: { version: 1, countedTasks: 2 } };
  const reviews = new Map<string, any>();
  const state = { task: task as typeof task | null, permission: { branches: [] as string[], data: {} as any }, audit: [] as any[], next: 0, chat: [] as any[], failChat: false, conversations: new Map<string, any>() };
  const match = (where: any) => where.id ? reviews.get(where.id) : [...reviews.values()].find(r => r.taskId === where.taskId_userEmail.taskId && r.userEmail === where.taskId_userEmail.userEmail);
  const db = {
    supportConversation: {
      upsert: async ({ where, create, update }: any) => {
        const current = state.conversations.get(where.residentEmail);
        const row = current ? { ...current, ...update } : { id: `chat-${where.residentEmail}`, ...create };
        state.conversations.set(where.residentEmail, row); return row;
      },
      update: async ({ where, data }: any) => {
        const row = [...state.conversations.values()].find(row => row.id === where.id); Object.assign(row, data); return row;
      }
    },
    supportMessage: { create: async ({ data }: any) => {
      if (state.failChat) throw new Error('Chat write failed');
      const message = { id: `chat-message-${state.chat.length}`, ...data, createdAt: new Date() }; state.chat.push(message); return message;
    } },
    cleaningTask: { findUnique: async () => state.task },
    cleaningAssignmentReview: {
      findUnique: async ({ where }: any) => match(where) ?? null,
      findMany: async ({ where }: any) => [...reviews.values()].filter(r => (!where.status || r.status === where.status) && (!where.userEmail || r.userEmail === where.userEmail) && (!where.branchId || where.branchId.in.includes(r.branchId))),
      upsert: async ({ where, create }: any) => {
        const existing = match(where); if (existing) return existing;
        const row = { id: `review-${++state.next}`, ...create, status: 'OPEN', messages: [] }; reviews.set(row.id, row); return row;
      },
      update: async ({ where, data }: any) => {
        const row = reviews.get(where.id); row.status = data.status;
        row.messages.push({ id: `message-${row.messages.length}`, ...data.messages.create, createdAt: new Date() }); return row;
      }
    }
  };
  const context = vm.createContext({
    Date, Intl, Prisma: { DbNull: null }, clearNotificationCaches: () => {},
    prisma: { ...db, $transaction: async (fn: Function) => {
      const before = structuredClone({ reviews: [...reviews], conversations: [...state.conversations], chat: state.chat });
      try { return await fn(db); } catch (error) {
        reviews.clear(); for (const [key, value] of before.reviews) reviews.set(key, value);
        state.conversations = new Map(before.conversations); state.chat = before.chat; throw error;
      }
    } },
    resolvePortalLogin: async (email: string) => ({ allowed: email !== 'blocked@example.com', role: email === 'host@example.com' ? 'manager' : email === 'owner@example.com' ? 'owner' : 'user' }),
    getManagerPermissions: async () => state.permission,
    logAction: async (data: any) => { state.audit.push(data); }
  });
  vm.runInContext(chatCode + "\n" + code, context);
  const post = (actorEmail: string, body = 'I am away that day.', action = 'comment', reviewId?: string) => context.postAssignmentReview({ actorEmail, taskId: 'task', reviewId, body, action });
  return { state, context, reviews, post };
}

test('resident opens a dispute with the saved explanation; host replies and records a resolution', async () => {
  const f = fixture(); const opened = await f.post('resident@example.com'); const id = opened.review.id;
  assert.equal(opened.review.status, 'OPEN'); assert.equal(opened.explanation.countedTasks, 2);
  await f.post('host@example.com', 'Which date works?', 'comment', id);
  const resolved = await f.post('host@example.com', 'Agreed to keep this date after discussion.', 'resolve', id);
  assert.equal(resolved.review.status, 'RESOLVED'); assert.equal(resolved.review.messages.length, 3);
  assert.equal(resolved.review.messages[0].authorRole, 'resident'); assert.equal(resolved.review.messages[1].authorRole, 'host');
  assert.equal(f.state.task?.userEmail, 'resident@example.com'); // discussion never mutates schedule
});
test('host can initiate a dispute and resident can reopen it', async () => {
  const f = fixture(); const opened = await f.post('host@example.com', 'This resident was assigned too often.');
  await f.post('host@example.com', 'Reviewed the counts.', 'resolve', opened.review.id);
  const reopened = await f.post('resident@example.com', 'The availability is still incorrect.', 'reopen', opened.review.id);
  assert.equal(reopened.review.status, 'OPEN'); assert.equal(reopened.review.messages.length, 3);
});
test('another resident cannot read, reply to, or open a dispute for this assignment', async () => {
  const f = fixture(); const opened = await f.post('resident@example.com'); const id = opened.review.id;
  await assert.rejects(f.context.getAssignmentReviewForTask('other@example.com', 'task'), /another resident/);
  await assert.rejects(f.context.getAssignmentReview('other@example.com', id), /another resident/);
  await assert.rejects(f.post('other@example.com', 'reply', 'comment', id), /another resident/);
  await assert.rejects(f.post('other@example.com'), /another resident/);
  assert.equal((await f.context.listAssignmentReviews('other@example.com')).length, 0);
  assert.equal(opened.review.messages.length, 1);
});
test('resident cannot resolve a dispute and blocked accounts cannot access it', async () => {
  const f = fixture(); const opened = await f.post('resident@example.com');
  await assert.rejects(f.post('resident@example.com', 'close', 'resolve', opened.review.id), /Only the host/);
  await assert.rejects(f.context.getAssignmentReview('blocked@example.com', opened.review.id), /Sign in/);
});
test('manager branch scope and read-only cleaning permissions are enforced', async () => {
  const f = fixture(); const opened = await f.post('resident@example.com');
  f.state.permission.branches = ['D2'];
  await assert.rejects(f.context.getAssignmentReview('host@example.com', opened.review.id), /outside your permissions/);
  assert.equal((await f.context.listAssignmentReviews('host@example.com')).length, 0);
  f.state.permission.branches = ['D7']; f.state.permission.data = { cleaning: { read: true, write: false } };
  await f.context.getAssignmentReview('host@example.com', opened.review.id);
  await assert.rejects(f.post('host@example.com', 'reply', 'comment', opened.review.id), /permission/);
});
test('empty or oversized disputes and resolutions are rejected', async () => {
  const f = fixture(); await assert.rejects(f.post('resident@example.com', '  '), /reason or reply/);
  await assert.rejects(f.post('resident@example.com', 'x'.repeat(2001)), /reason or reply/);
  assert.equal(f.reviews.size, 0);
});
test('dispute history survives task deletion and stays private after reassignment', async () => {
  const f = fixture(); const opened = await f.post('resident@example.com'); const id = opened.review.id;
  f.state.task!.userEmail = 'other@example.com';
  await assert.rejects(f.context.getAssignmentReview('other@example.com', id), /another resident/);
  assert.equal((await f.context.getAssignmentReviewForTask('other@example.com', 'task')).review, null);
  f.state.task = null;
  assert.equal((await f.context.getAssignmentReview('resident@example.com', id)).review.messages.length, 1);
  await f.post('host@example.com', 'Removed the incorrect task.', 'resolve', id);
});
test('resolved disputes leave the open inbox but remain in history', async () => {
  const f = fixture(); const opened = await f.post('resident@example.com');
  await f.post('host@example.com', 'Resolved.', 'resolve', opened.review.id);
  assert.equal((await f.context.listAssignmentReviews('resident@example.com')).length, 0);
  assert.equal((await f.context.listAssignmentReviews('resident@example.com', true)).length, 1);
});
test('older automatic assignments allow disputes without inventing decision details', async () => {
  const f = fixture(); (f.state.task as any).assignmentExplanation = null;
  const result = await f.post('resident@example.com'); assert.equal(result.explanation, null);
});
test('saved explanation values do not change when later inputs change', () => {
  const input = { reason: 'rotation' as const, availability: 'PREFERRED', countedTasks: 3, fairnessFrom: '2026-07-11', correctionPenalty: 2, candidateCount: 8 };
  const saved = makeCleaningAssignmentExplanation(input); input.countedTasks = 100;
  assert.equal(saved.countedTasks, 3); assert.equal(saved.candidateCount, 8); assert.equal(saved.version, 1);
});

test('explanation identifies the first ranking difference instead of claiming workload always wins', () => {
  const selected = { availability: 'PREFERRED', countedTasks: 8, correctionPenalty: 2 };
  assert.equal(cleaningSelectionFactor(selected, { availability: 'AVAILABLE', countedTasks: 0, correctionPenalty: 0 }), 'availability');
  assert.equal(cleaningSelectionFactor(selected, { ...selected, countedTasks: 9 }), 'workload');
  assert.equal(cleaningSelectionFactor(selected, { ...selected, correctionPenalty: 3 }), 'correction');
  assert.equal(cleaningSelectionFactor(selected, selected), 'name');
  assert.equal(cleaningSelectionFactor(selected, null), 'only_candidate');
});

test('new disputes and all thread updates appear in the resident private chat with a working review link', async () => {
  const f = fixture(); const opened = await f.post('resident@example.com');
  await f.post('host@example.com', 'Reviewing your request.', 'comment', opened.review.id);
  await f.post('owner@example.com', 'Agreed and resolved.', 'resolve', opened.review.id);
  await f.post('resident@example.com', 'Please review again.', 'reopen', opened.review.id);
  assert.equal(f.state.chat.length, 4); assert.equal(f.state.conversations.size, 1);
  assert.equal(f.state.chat[0].conversationId, 'chat-resident@example.com');
  assert.equal(f.state.chat[0].senderRole, 'RESIDENT'); assert.equal(f.state.chat[1].senderRole, 'MANAGER'); assert.equal(f.state.chat[2].senderRole, 'OWNER');
  assert.equal(f.state.chat[0].pagePath, `/cleaning-review?id=${opened.review.id}`);
  assert.match(f.state.chat[0].body, /12\/10\/2026/); assert.match(f.state.chat[0].body, /I am away that day/);
  assert.match(f.state.chat[2].body, /Resolved/); assert.match(f.state.chat[3].body, /Reopened/);
  assert.equal(f.state.conversations.get('resident@example.com').status, 'OPEN');
  assert.equal(f.state.conversations.get('resident@example.com').lastMessageAt, f.state.chat[3].createdAt);
});
test('failed chat write rolls back the dispute update and retry creates only one message', async () => {
  const f = fixture(); f.state.failChat = true;
  await assert.rejects(f.post('resident@example.com'), /Chat write failed/);
  assert.equal(f.reviews.size, 0); assert.equal(f.state.chat.length, 0); assert.equal(f.state.conversations.size, 0);
  f.state.failChat = false; const opened = await f.post('resident@example.com');
  assert.equal(opened.review.messages.length, 1); assert.equal(f.state.chat.length, 1);
  f.state.failChat = true; await assert.rejects(f.post('host@example.com', 'Resolved.', 'resolve', opened.review.id), /Chat write failed/);
  assert.equal(f.reviews.get(opened.review.id).status, 'OPEN'); assert.equal(f.reviews.get(opened.review.id).messages.length, 1);
});
