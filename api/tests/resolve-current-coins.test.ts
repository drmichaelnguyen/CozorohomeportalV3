import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCurrentCoinsBalance } from '../../portal/lib/resolve-current-coins.ts';

test('a stored zero is authoritative even when history is positive', () => {
  assert.equal(resolveCurrentCoinsBalance({ profileBalance: '0', historyNet: 25000 }), 0);
});
test('stored positive and negative balances remain authoritative', () => {
  assert.equal(resolveCurrentCoinsBalance({ profileBalance: '85,000', historyNet: 110000 }), 85000);
  assert.equal(resolveCurrentCoinsBalance({ profileBalance: '-5000', historyNet: 25000 }), -5000);
});
test('only unavailable or invalid profile balances use history', () => {
  for (const profileBalance of [null, undefined, '', 'unknown', '--']) {
    assert.equal(resolveCurrentCoinsBalance({ profileBalance, historyNet: 25000 }), 25000);
  }
});
