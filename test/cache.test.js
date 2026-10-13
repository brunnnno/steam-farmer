'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ResultCache } = require('../lib/cache');
test('cache expires and releases retained payloads', () => {
  let now = 0; const c = new ResultCache({ now: () => now, ttl: 10 });
  c.set('a', { rows: [1] }); assert.deepEqual(c.get('a'), { rows: [1] });
  now = 10; assert.equal(c.get('a'), undefined); assert.equal(c.bytes, 0);
  c.set('b', {}); now = 20; c.prune(); assert.equal(c.entries.size, 0);
});
test('cache evicts least recently read responses within both budgets', () => {
  const c = new ResultCache({ maxEntries: 2, maxBytes: 12 });
  c.set('a', 'a'); c.set('b', 'b'); c.get('a'); c.set('c', 'c');
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 'a');
  c.set('d', '1234567'); assert.ok(c.bytes <= 12); assert.equal(c.get('c'), undefined);
  c.set('d', 'x'.repeat(20)); assert.equal(c.get('d'), undefined);
  c.clear(); assert.equal(c.bytes, 0);
});
