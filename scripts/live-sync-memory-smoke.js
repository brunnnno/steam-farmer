"use strict";
const assert = require("node:assert/strict");
const { revisionFor } = require("../lib/achievement-sync");

for (let i = 0; i < 50; i++) {
  const rev = revisionFor({
    readingMethod: "steam_client",
    achievements: [{ apiname: `ACH_${i}`, unlocked: true }]
  });
  assert.equal(typeof rev, "string");
}
assert.ok(process.memoryUsage().heapUsed < 180 * 1024 * 1024);
console.log("live-sync-memory-smoke ok");
