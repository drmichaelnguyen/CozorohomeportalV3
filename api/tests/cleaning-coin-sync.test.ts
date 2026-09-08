import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncCleaningCoins, type CleaningCoinSnapshot, type CleaningCoinChange } from '../src/cleaning-coin-sync.js';

const input = { userEmail: 'resident@example.com', userName: 'Resident', branchId: 'D7', rewardCoins: 5000, taskId: 'task1', reviewedBy: 'manager' };
function fixture() {
  let state: CleaningCoinSnapshot = { current: 92000, lifetime: 1075000, earnedThisMonth: 0, transactions: [] };
  let queue = Promise.resolve();
  let failure: 'before' | 'after' | null = null;
  let writes = 0;
  const store = {
    async withLock<T>(action: () => Promise<T>): Promise<T> {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await action(); } finally { release(); }
    },
    async read() { return structuredClone(state); },
    async commit(change: CleaningCoinChange) {
      await new Promise((resolve) => setImmediate(resolve));
      if (failure === 'before') { failure = null; throw new Error('batch rejected'); }
      writes++;
      state = { ...change, transactions: [...state.transactions, { code: change.code, amount: change.delta, thisMonth: true }] };
      if (failure === 'after') { failure = null; throw new Error('response lost'); }
    }
  };
  return { store, get state() { return state; }, get writes() { return writes; }, fail(mode: typeof failure) { failure = mode; } };
}

test('concurrent July rewards preserve every credit and lifetime earnings', async () => {
  const f = fixture();
  await Promise.all([5000, 5000, 10000].map((rewardCoins, index) => syncCleaningCoins({ ...input, taskId: String(index), rewardCoins }, false, f.store)));
  assert.equal(f.state.current, 112000);
  assert.equal(f.state.lifetime, 1095000);
  assert.equal(f.state.earnedThisMonth, 20000);
  assert.equal(f.state.transactions.length, 3);
});

test('simultaneous duplicate requests award once', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 4 }, () => syncCleaningCoins(input, false, f.store)));
  assert.equal(f.writes, 1);
  assert.equal(f.state.current, 97000);
});

test('failed atomic write can be retried without losing history or balance', async () => {
  const f = fixture(); f.fail('before');
  await assert.rejects(syncCleaningCoins(input, false, f.store));
  assert.equal(f.state.transactions.length, 0);
  assert.equal(f.state.current, 92000);
  await syncCleaningCoins(input, false, f.store);
  assert.equal(f.state.current, 97000);
});

test('lost success response is resolved from live history without paying twice', async () => {
  const f = fixture(); f.fail('after');
  await assert.rejects(syncCleaningCoins(input, false, f.store));
  await syncCleaningCoins(input, false, f.store);
  assert.equal(f.writes, 1);
  assert.equal(f.state.current, 97000);
});

test('reversal uses original award amount, preserves gross earnings and is idempotent', async () => {
  const f = fixture();
  await syncCleaningCoins(input, false, f.store);
  await syncCleaningCoins({ ...input, rewardCoins: 10000 }, true, f.store);
  await syncCleaningCoins(input, true, f.store);
  await syncCleaningCoins(input, false, f.store);
  assert.equal(f.writes, 2);
  assert.equal(f.state.current, 92000);
  assert.equal(f.state.lifetime, 1080000);
  assert.equal(f.state.earnedThisMonth, 5000);
});

test('reversing an older award does not remove current-month earnings', async () => {
  const f = fixture();
  await syncCleaningCoins(input, false, f.store);
  f.state.transactions[0]!.thisMonth = false;
  await syncCleaningCoins(input, true, f.store);
  assert.equal(f.state.earnedThisMonth, 5000);
});

test('no debit for a reward absent from the sheet', async () => {
  const f = fixture();
  await syncCleaningCoins(input, true, f.store);
  assert.equal(f.writes, 0);
});

test('rejects malformed rewards before reading or writing', async () => {
  const f = fixture();
  for (const rewardCoins of [0, -1, NaN, 1.5, Infinity]) {
    await assert.rejects(syncCleaningCoins({ ...input, rewardCoins }, false, f.store));
  }
  assert.equal(f.writes, 0);
});

test('clawback preserves the full debit when the reward has already been spent', async () => {
  const f = fixture();
  await syncCleaningCoins(input, false, f.store);
  f.state.current = 1000;
  await syncCleaningCoins(input, true, f.store);
  assert.equal(f.state.current, -4000);
  assert.equal(f.state.transactions.at(-1)!.amount, -5000);
});
