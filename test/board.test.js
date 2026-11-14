import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMove, scopeOf } from '../src/board.js';

const L = (id, name) => ({ id, name });
const labels = [L(1, 'status/todo'), L(2, 'status/doing'), L(3, 'bug'), L(4, 'prio/high')];
const statusIds = [1, 2];

test('scopeOf', () => {
  assert.equal(scopeOf('status/todo'), 'status');
  assert.equal(scopeOf('a/b/c'), 'a/b');
  assert.equal(scopeOf('bug'), null);
  assert.equal(scopeOf('/weird'), null);
});

test('move to label column replaces scope labels, keeps others', () => {
  const plan = planMove([labels[0], labels[2], labels[3]], 'status', { column: 'label', labelId: 2 }, statusIds);
  assert.deepEqual(plan, { labelIds: [3, 4, 2], state: 'open' });
});

test('move to open removes scope labels', () => {
  const plan = planMove([labels[0], labels[1], labels[2]], 'status', { column: 'open' }, statusIds);
  assert.deepEqual(plan, { labelIds: [3], state: 'open' });
});

test('move to closed closes and removes scope labels', () => {
  const plan = planMove([labels[0], labels[3]], 'status', { column: 'closed' }, statusIds);
  assert.deepEqual(plan, { labelIds: [4], state: 'closed' });
});

test('rejects label outside scope', () => {
  assert.throws(() => planMove([], 'status', { column: 'label', labelId: 4 }, statusIds));
});
