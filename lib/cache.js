'use strict';
// Bound retained response payloads as well as entry count. Expired entries are removed eagerly.
class ResultCache {
  constructor({ maxBytes = 4 * 1024 * 1024, maxEntries = 64, ttl = 60000, now = Date.now } = {}) {
    Object.assign(this, { maxBytes, maxEntries, ttl, now });
    this.entries = new Map(); this.bytes = 0;
  }
  delete(key) { const item = this.entries.get(key); if (item) { this.bytes -= item.bytes; this.entries.delete(key); } }
  prune() { for (const [key, item] of this.entries) if (item.expires <= this.now()) this.delete(key); }
  get(key) {
    const item = this.entries.get(key); if (!item) return;
    if (item.expires <= this.now()) { this.delete(key); return; }
    this.entries.delete(key); this.entries.set(key, item); return item.result;
  }
  set(key, result) {
    this.prune(); this.delete(key);
    const bytes = Buffer.byteLength(JSON.stringify(result));
    if (bytes > this.maxBytes || this.maxEntries < 1) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
    this.entries.set(key, { result, bytes, expires: this.now() + this.ttl }); this.bytes += bytes;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}
module.exports = { ResultCache };
