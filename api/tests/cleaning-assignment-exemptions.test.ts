import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Production functions with isolated adapters: never connect to the live database.
function compile(file: string, names?: string[]) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  return ts.transpileModule(source.statements
    .filter(n => !ts.isImportDeclaration(n) && (!names || ('name' in n && names.includes((n.name as ts.Identifier)?.text))))
    .map(n => n.getText(source).replace(/^export /, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const exemptionCode = compile('../src/cleaning-assignment-exemptions.ts');
const schedulerCode = compile('../src/cleaning.ts', ['getAssignableCandidates', 'assignTaskToUser', 'findReleasedUserReassignment']);
function fixture(role = 'owner') {
  const rows = new Map<string, any>(); const actions: any[] = []; const writes: any[] = [];
  const context = vm.createContext({
    Date, Set, Map,
    requirePortalRole: async (_email: string, allowed: string[]) => {
      if (!allowed.includes(role)) throw new Error('Forbidden');
      return { email: 'owner@example.com', role };
    },
    prisma: { cleaningAssignmentExemption: {
      findMany: async () => [...rows.values()].filter(row => row.exempt),
      findUnique: async ({ where }: any) => rows.get(where.userEmail),
      upsert: async ({ where, create, update }: any) => { const row = rows.has(where.userEmail) ? { ...rows.get(where.userEmail), ...update } : create; rows.set(where.userEmail, row); writes.push(row); return row; }
    } },
    logAction: async (action: any) => { actions.push(action); },
    normalizeCalendarDate: (date: Date) => date, isUserEligibleForCleaningSlot: () => true,
    CleaningAvailabilityType: { UNAVAILABLE: 'UNAVAILABLE' },
    CleaningAssignmentSource: { SYSTEM: 'SYSTEM', SELF: 'SELF', MANAGER: 'MANAGER' },
    CleaningTaskStatus: { ASSIGNED: 'ASSIGNED' }, CleaningTaskType: { TRASH_D7: 'TRASH_D7' },
    sameDay: (a: Date, b: Date) => a.toISOString() === b.toISOString(),
    compareCleaningCandidateRank: () => 0, getSlotFloor: () => 1,
    findManyCleaningTasks: async () => [],
    calendarRangeStart: (date: Date) => date, calendarRangeEnd: (date: Date) => date,
    findFirstCleaningTask: async () => ({ userEmail: 'exempt@example.com', status: 'ASSIGNED' })
  });
  vm.runInContext(exemptionCode + '\n' + schedulerCode, context);
  const set = (exempt: boolean, targetEmail = 'exempt@example.com') => context.setOwnerCleaningAssignmentExemption({ actorEmail: 'owner@example.com', targetEmail, exempt });
  return { context, set, rows, actions, writes };
}
test('owner exemption persists by normalized email with an audit record', async () => {
  const f = fixture(); await f.set(true, ' Exempt@Example.COM ');
  assert.equal(await f.context.isCleaningAssignmentExempt('EXEMPT@example.com'), true);
  assert.equal(f.rows.get('exempt@example.com').updatedBy, 'owner@example.com');
  assert.equal(f.actions[0].action, 'cleaning.assignment_exemption.set');
});
test('unticking revokes exemption and preserves change history', async () => {
  const f = fixture(); await f.set(true); await f.set(false);
  assert.equal(await f.context.isCleaningAssignmentExempt('exempt@example.com'), false);
  assert.equal((await f.context.getCleaningAssignmentExemptions()).size, 0); assert.equal(f.actions.length, 2);
});
for (const role of ['manager', 'user', 'mechanic']) {
  test(`${role} cannot view or change owner exceptions`, async () => {
    const f = fixture(role); await assert.rejects(f.set(true), /Forbidden/);
    await assert.rejects(f.context.getOwnerCleaningAssignmentExemption('actor@example.com', 'exempt@example.com'), /Forbidden/);
    assert.equal(f.writes.length, 0);
  });
}
test('app admin can manage owner exceptions', async () => {
  const f = fixture('app_admin'); await f.set(true); assert.equal(f.writes.length, 1);
});
test('shared scheduler excludes exempt residents and restores them when unticked', async () => {
  const f = fixture(); const users = [{ email: 'exempt@example.com' }, { email: 'eligible@example.com' }];
  const candidates = () => f.context.getAssignableCandidates(users, new Map(), new Date('2026-10-12'), 'TRASH_D7', [], 1);
  await f.set(true); assert.equal((await candidates()).length, 1); assert.equal((await candidates())[0].email, 'eligible@example.com');
  await f.set(false); assert.equal((await candidates()).length, 2);
});
test('final automatic assignment guard rejects stale candidate lists', async () => {
  const f = fixture(); await f.set(true);
  await assert.rejects(f.context.assignTaskToUser({ user: { email: 'exempt@example.com' }, date: new Date('2026-10-12'), type: 'TRASH_D7', assignmentSource: 'SYSTEM' }), /exempt from automatic/);
});
test('exempt resident receives no automatic replacement proposal', async () => {
  const f = fixture(); await f.set(true);
  assert.equal(await f.context.findReleasedUserReassignment({ email: 'exempt@example.com' }), null);
});
test('existing assignments and voluntary/manual paths remain available', async () => {
  const f = fixture(); await f.set(true);
  for (const assignmentSource of ['SELF', 'MANAGER']) {
    const task = await f.context.assignTaskToUser({ user: { email: 'exempt@example.com' }, date: new Date('2026-10-12'), type: 'TRASH_D7', assignmentSource });
    assert.equal(task.userEmail, 'exempt@example.com');
  }
  assert.equal(f.writes.length, 1);
});
