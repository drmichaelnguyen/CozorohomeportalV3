import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('stats.ts', readFileSync(new URL('../src/client-cleaning-statistics.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source).replace(/^export /, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(role = 'manager') {
  const state = { calls: [] as { name: string; args: any }[], branches: ['D7'], read: true, empty: false, missing: false };
  const record = (name: string, args: any) => state.calls.push({ name, args });
  const context = vm.createContext({ Date, Intl,
    requirePortalRole: async (_email: string, roles: string[]) => { if (!roles.includes(role)) throw new Error('Forbidden'); return { role, email: 'host@example.com' }; },
    getManagerClients: async () => state.missing ? [] : [{ maHd: 'contract', email: ' Resident@Example.com ', branch: '7' }],
    getManagerPermissions: async () => ({ branches: state.branches, data: { cleaning: { read: state.read } } }),
    prisma: {
      cleaningAssignmentExemption: { findUnique: async (args: any) => { record('exemption', args); return { exempt: true }; } },
      cleaningTask: {
        groupBy: async (args: any) => {
          record('groupBy', args); if (state.empty) return [];
          return args.by[0] === 'status'
            ? [{ status: 'APPROVED', _count: { _all: 3 } }, { status: 'MISSED', _count: { _all: 1 } }]
            : [{ assignmentSource: 'MANAGER', isSelfAssigned: true, _count: { _all: 1 } }, { assignmentSource: 'SYSTEM', isSelfAssigned: false, _count: { _all: 2 } }, { assignmentSource: null, isSelfAssigned: false, _count: { _all: 1 } }];
        },
        count: async (args: any) => { record('count', args); return 0; },
        findFirst: async (args: any) => { record('next', args); return null; },
        findMany: async (args: any) => { record('details', args); return state.empty ? [] : Array.from({ length: args.skip ? 2 : 26 }, (_, i) => ({ id: `task-${args.skip + i}` })); }
      }
    }
  });
  vm.runInContext(code, context);
  return { state, run: (details = false, offset = 0) => context.getClientCleaningStatistics({ actorEmail: 'host@example.com', maHd: 'contract', details, offset }) };
}
test('summary returns aggregates without fetching task entries', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.summary.total, 4); assert.equal(result.summary.byStatus.MISSED, 1);
  assert.equal(result.summary.bySource.SELF, 1); assert.equal(result.summary.bySource.SYSTEM, 2); assert.equal(result.summary.bySource.LEGACY, 1);
  assert.equal(result.summary.automaticAssignmentExempt, true); assert.equal(result.tasks, undefined);
  assert.ok(!f.state.calls.some(call => call.name === 'details'));
  for (const call of f.state.calls) assert.equal(call.args.where.userEmail, 'resident@example.com');
});
test('details are scoped and paginated without reloading other statistics', async () => {
  const f = fixture(); const first = await f.run(true);
  assert.equal(first.tasks.length, 25); assert.equal(first.nextOffset, 25);
  const second = await f.run(true, 25); assert.equal(second.tasks[0].id, 'task-25'); assert.equal(second.nextOffset, null);
  assert.ok(f.state.calls.every(call => call.name === 'details'));
  assert.deepEqual(f.state.calls[0].args.where.branchId.in, ['D7']);
  assert.equal(f.state.calls[0].args.where.userEmail, 'resident@example.com');
});
test('empty resident history has zero summary and no detail pages', async () => {
  const f = fixture(); f.state.empty = true;
  assert.equal((await f.run()).summary.total, 0);
  const details = await f.run(true); assert.equal(details.tasks.length, 0); assert.equal(details.nextOffset, null);
});
test('missing client and unauthorized users cannot load cleaning data', async () => {
  const resident = fixture('user'); await assert.rejects(resident.run(), /Forbidden/); assert.equal(resident.state.calls.length, 0);
  const f = fixture(); f.state.missing = true; await assert.rejects(f.run(), /Client not found/); assert.equal(f.state.calls.length, 0);
});
test('cleaning read permissions and branch scope apply to both summary and details', async () => {
  const f = fixture(); f.state.read = false; await assert.rejects(f.run(), /read permission/);
  f.state.read = true; f.state.branches = ['D2']; await assert.rejects(f.run(), /branch permissions/); await assert.rejects(f.run(true), /branch permissions/);
  assert.equal(f.state.calls.length, 0);
});

const managerSource = ts.createSourceFile('manager.tsx', readFileSync(new URL('../../portal/components/manager-client.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loadSource = '';
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'loadWorkspace') loadSource = node.getText(managerSource); ts.forEachChild(node, visit); }
visit(managerSource);
test('selecting Cleaning bypasses the laundry/coins/payments/fines workspace request', async () => {
  assert.ok(loadSource); let activeTab = '';
  const context = vm.createContext({ selectedMaHd: 'contract', isStaffSession: true, setActiveTab: (tab: string) => { activeTab = tab; }, setStatus: () => {}, fetch: () => { throw new Error('Unexpected workspace request'); } });
  vm.runInContext(ts.transpileModule(loadSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await context.loadWorkspace('cleaning'); assert.equal(activeTab, 'cleaning');
});
