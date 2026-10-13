'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function appId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 0xffffffff) throw Object.assign(new Error('AppID inválido.'), { status: 400 });
  return id;
}
function hour(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) throw Object.assign(new Error('La hora debe estar entre 0 y 23.'), { status: 400 });
  return n;
}
function sleepNow(schedule, timezone, now = new Date()) {
  if (!schedule?.enabled || schedule.start === schedule.end) return false;
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return schedule.start < schedule.end ? h >= schedule.start && h < schedule.end : h >= schedule.start || h < schedule.end;
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash || typeof password !== 'string' || password.length > 256) return false;
  const computed = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}
class Vault {
  constructor(directory) {
    this.file = path.join(directory, 'sessions.enc.json');
    const keyFile = path.join(directory, 'vault.key');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(keyFile)) {
      if (fs.existsSync(this.file)) throw new Error('Falta vault.key. Restaurá la clave original; no se pueden recuperar las sesiones sin ella.');
      fs.writeFileSync(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
    }
    this.key = fs.readFileSync(keyFile);
    if (this.key.length !== 32) throw new Error('Clave de sesiones inválida.');
    fs.chmodSync(keyFile, 0o600);
    this.records = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
  }
  get(id) {
    const item = this.records[id];
    if (!item) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(item.iv, 'hex'));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(Buffer.from(item.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(item.data, 'hex')), decipher.final()]).toString('utf8');
  }
  set(id, token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    this.records[id] = { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
    atomicWrite(this.file, this.records);
  }
  remove(id) { delete this.records[id]; atomicWrite(this.file, this.records); }
}
function validClientToken(token) {
  try {
    const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    return body.iss === 'steam' && body.aud.includes('client') && body.exp * 1000 > Date.now();
  } catch { return false; }
}
module.exports = { atomicWrite, appId, hour, sleepNow, hashPassword, verifyPassword, Vault, validClientToken };
