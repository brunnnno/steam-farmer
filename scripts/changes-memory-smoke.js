"use strict";
const assert = require("node:assert/strict");
const { selection } = require("../lib/achievement-changes");

for (let i = 0; i < 100; i++) {
  const res = selection([{ apiname: `ACH_${i}`, action: "unlock" }]);
  assert.equal(res.length, 1);
}
assert.ok(process.memoryUsage().heapUsed < 180 * 1024 * 1024);
console.log("changes-memory-smoke ok");
