import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the production release function with isolated DB/calendar/coin adapters.
// Never import the live service or connect to production resources in this test.
const source = ts.createSourceFile('cleaning.ts', readFileSync(new URL('../src/cleaning.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['releaseCleaningTask', 'CleaningReleaseConfirmationRequiredError']);
const code = ts.transpileModule(source.statements.filter(n => 'name' in n && names.has((n.name as ts.Identifier)?.text)).map(n => n.getText(source).replace(/^export /, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const task = { id: 'original', userEmail: 'user@example.com', userName: 'User', status: 'ASSIGNED', type: 'TRASH_D7', floor: 1, branchId: 'D7', scheduledDate: new Date('2026-10-10'), updatedAt: new Date('2026-09-09'), isSelfAssigned: false };
  const state = { proposed: new Date('2026-10-12') as Date | null, fine: 0, cost: 0, available: 1000, writes: [] as string[], failSlot: false, claimed: true, assignments: [] as any[], notice: null as any };
  const write = (name: string) => { state.writes.push(name); };
  const context = vm.createContext({
    Date, console, MONTHLY_RELEASE_LIMIT: 3, CLEANING_FAIRNESS_LOOKBACK_DAYS: 60,
    Prisma: { DbNull: null }, makeCleaningAssignmentExplanation: (input: any) => input,
    addDays: (date: Date, days: number) => new Date(date.getTime() + days * 86400000),
    CleaningTaskStatus: { ASSIGNED: 'ASSIGNED' }, CleaningTaskType: { TRASH_D7: 'TRASH_D7' }, CleaningAvailabilityType: { UNAVAILABLE: 'UNAVAILABLE' }, CleaningAssignmentSource: { SYSTEM: 'SYSTEM' },
    getCleaningAssignmentExemptions: async () => new Set(),
    isCleaningAssignmentExempt: async () => false,
    findUniqueCleaningTask: async () => task,
    countReleasesThisMonth: async () => 0,
    getCleaningReleasePenalty: () => ({ canRelease: true, fineRate: state.fine ? .5 : 0, fineAmount: state.fine, message: 'Penalty' }),
    canReleaseCalendarDate: () => true,
    getAvailableUsersForAdminSlot: async () => [{ email: 'replacement@example.com', hasSameDayTask: false }],
    getUserCleaningContext: async (email: string) => ({ email, name: 'User', floor: 1, branchId: 'D7' }),
    getCleaningRewardSettings: async () => ({}), computeCleaningRewardCoins: () => ({ rewardCoins: 5000 }),
    getFineCoinPaymentQuoteForEmail: async () => ({ coinCost: state.cost, currentCoins: state.available, remainingCoins: state.available - state.cost, canPay: state.available >= state.cost }),
    findReleasedUserReassignment: async () => state.proposed ? { date: state.proposed, explanation: { version: 1 } } : null,
    resolveAssignmentRewardCoins: async () => ({ rewardCoins: 5000 }),
    normalizeCalendarDate: (d: Date) => d, calendarRangeStart: (d: Date) => d, calendarRangeEnd: (d: Date) => d,
    getCleaningCalendarTarget: () => null, getSlotCreationKey: () => 'slot',
    calendarDateKey: (d: Date) => d.toISOString().slice(0, 10),
    getDutyCancellationByTaskId: async () => state.notice,
    upsertDutyCancellationNotice: async (input: any) => {
      write('notice');
      const noticeAt =
        state.notice?.noticeAt ??
        (input.noticeAt instanceof Date ? input.noticeAt.toISOString() : input.noticeAt) ??
        new Date().toISOString();
      state.notice = { noticeAt, status: input.status };
      return state.notice;
    },
    markDutyCancellationReleased: async () => { write('released'); state.notice = { ...(state.notice ?? {}), status: 'RELEASED' }; },
    isReleasedOrExemptCancellationStatus: (status: string) => status === 'RELEASED' || status === 'EXEMPT',
    createLateReleaseFinePaidByCoinsOnce: async () => { write('coins'); return { coinPayment: { coinCost: state.cost, currentCoins: state.available - state.cost } }; },
    prisma: { $transaction: async (fn: Function) => {
      const before = state.assignments.slice();
      try { return await fn({
        cleaningTask: {
          updateMany: async () => { write('claim'); return { count: state.claimed ? 1 : 0 }; },
          findFirst: async () => null,
          create: async ({ data }: any) => { if (state.failSlot) throw new Error('Slot occupied'); write('create'); const created = { id: 'new', ...data }; state.assignments.push(created); return created; },
          update: async ({ data }: any) => { write('update'); return { ...task, ...data }; }
        },
        cleaningAvailability: { upsert: async () => { write('availability'); } }
      }); } catch (error) { state.assignments = before; throw error; }
    } },
    logAction: async () => write('log'), invalidateCleaningOverviewCache: async () => {},
    createAutomaticFineForEmailPaidByCoins: async () => { write('coins'); return { coinPayment: { coinCost: state.cost, currentCoins: state.available - state.cost } }; },
    formatTaskTypeForFine: () => 'trash', formatTaskDateForFine: () => '10/10/2026',
    enqueueDeferredCleaningCalendarCreate: () => {}
  });
  vm.runInContext(code, context);
  const release = (key?: string) => context.releaseCleaningTask(task.id, task.userEmail, { confirmationKey: key });
  const preview = async (key?: string) => { try { await release(key); assert.fail('Expected confirmation'); } catch (error: any) { assert.ok(error.preview); return error.preview; } };
  return { state, release, preview };
}
test('first request only previews; declining requires no release write', async () => {
  const f = fixture(); const p = await f.preview();
  assert.equal(p.reassignmentDate, '2026-10-12T00:00:00.000Z');
  assert.ok(f.state.writes.every((entry) => entry === 'notice'));
  assert.ok(!f.state.writes.includes('claim'));
});
test('confirmed request saves the exact proposed date', async () => {
  const f = fixture(); const p = await f.preview(); await f.release(p.confirmationKey);
  assert.equal(f.state.assignments.length, 1); assert.equal(f.state.assignments[0].scheduledDate.toISOString(), p.reassignmentDate);
});
test('changed date or coin charge requires fresh confirmation with no commit writes', async () => {
  const f = fixture(); const p = await f.preview(); f.state.proposed = new Date('2026-10-13');
  const changed = await f.preview(p.confirmationKey); assert.notEqual(changed.confirmationKey, p.confirmationKey);
  f.state.fine = 5000; f.state.cost = 100;
  const charged = await f.preview(changed.confirmationKey); assert.equal(charged.penalty.coinCost, 100);
  assert.ok(!f.state.writes.includes('claim'));
});
test('no replacement date is explicit and creates no new assignment', async () => {
  const f = fixture(); f.state.proposed = null; const p = await f.preview(); assert.equal(p.reassignmentDate, null);
  await f.release(p.confirmationKey); assert.equal(f.state.assignments.length, 0);
});
test('insufficient coins cannot commit even with confirmation', async () => {
  const f = fixture(); f.state.fine = 5000; f.state.cost = 2000; const p = await f.preview();
  assert.equal(p.penalty.canPay, false); await assert.rejects(f.release(p.confirmationKey), /Not enough coins/);
  assert.ok(!f.state.writes.includes('claim'));
});
test('occupied slot aborts before release availability, calendar, logs or coin payment', async () => {
  const f = fixture(); const p = await f.preview(); f.state.failSlot = true;
  await assert.rejects(f.release(p.confirmationKey), /Slot occupied/);
  assert.ok(f.state.writes.includes('claim'));
  assert.ok(!f.state.writes.includes('availability'));
  assert.equal(f.state.assignments.length, 0);
});
test('concurrent or repeated release cannot claim the original task twice', async () => {
  const f = fixture(); const p = await f.preview(); f.state.claimed = false;
  await assert.rejects(f.release(p.confirmationKey), /This task changed/);
  assert.ok(f.state.writes.includes('claim'));
});

const portalSource = ts.createSourceFile('schedule.tsx', readFileSync(new URL('../../portal/components/cleaning-schedule-client.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let requestSource = '';
function findRequest(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'requestTaskRelease') requestSource = node.getText(portalSource);
  ts.forEachChild(node, findRequest);
}
findRequest(portalSource);
assert.ok(requestSource);
const requestCode = ts.transpileModule(requestSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function portalFixture(confirmations: boolean[], changed = false) {
  const calls: (string | undefined)[] = [];
  const prompts: string[] = [];
  const context = vm.createContext({
    Date, language: 'en', prettyTaskType: () => 'Trash duty', formatCozoroDate: (d: Date) => d.toISOString().slice(0, 10), t: (_key: string, fallback: string) => fallback,
    window: { confirm: (message: string) => { prompts.push(message); return confirmations.shift(); }, alert: () => {} },
    postTaskRelease: async (_id: string, key?: string) => {
      calls.push(key);
      if (!key || (changed && key === 'first')) return { response: { status: 409, ok: false }, data: {
        code: 'RELEASE_CONFIRMATION_REQUIRED', confirmationKey: key ? 'changed' : 'first',
        reassignmentDate: key ? '2026-10-13' : '2026-10-12', penalty: { fineAmount: 0, canPay: true }
      } };
      return { response: { status: 200, ok: true }, data: {} };
    }
  });
  vm.runInContext(requestCode, context);
  return { calls, prompts, run: () => context.requestTaskRelease({ id: 'task', type: 'TRASH_D7', scheduledDate: '2026-10-10' }) };
}
test('portal declining the proposal never sends a commit request', async () => {
  const f = portalFixture([false]); const result = await f.run();
  assert.equal(result.released, false); assert.deepEqual(f.calls, [undefined]); assert.match(f.prompts[0], /2026-10-12/);
});
test('portal sends the confirmed key only after the user accepts', async () => {
  const f = portalFixture([true]); assert.equal((await f.run()).released, true); assert.deepEqual(f.calls, [undefined, 'first']);
});
test('portal asks again if the server changes the replacement date', async () => {
  const f = portalFixture([true, false], true); assert.equal((await f.run()).released, false);
  assert.deepEqual(f.calls, [undefined, 'first']); assert.match(f.prompts[1], /2026-10-13/);
});
