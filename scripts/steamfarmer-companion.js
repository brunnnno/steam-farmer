'use strict';
const http = require('node:http');
const https = require('node:https');
const { execFile } = require('node:child_process');
let detectLocalSteamClient;
try {
  ({ detectLocalSteamClient } = require('./sam-local-trigger'));
} catch {
  const fs = require('node:fs');
  const path = require('node:path');
  detectLocalSteamClient = function detectLocalSteamClientFallback() {
    const commonPaths = [
      'C:\Program Files (x86)\Steam',
      'C:\Program Files\Steam',
      path.join(process.env.LOCALAPPDATA || '', 'Steam'),
      '/usr/games/steam',
      path.join(process.env.HOME || '', '.steam', 'steam')
    ];
    for (const p of commonPaths) {
      if (p && fs.existsSync(p)) return { detected: true, path: p };
    }
    return { detected: false, path: null };
  };
}

const SERVER_URL = process.env.STEAMFARMER_URL || 'http://localhost:3000';

function escapeXml(text = '') {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWindowsToastPowerShell({ title = 'Achievement Unlocked', name = '', description = '', appid = 0 } = {}) {
  const safeTitle = escapeXml(title);
  const safeBody = escapeXml(description ? `${name} — ${description}` : name);
  const safeApp = escapeXml(appid ? `Steam AppID ${appid}` : 'SteamFarmer Local Bridge');
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument;',
    `$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeBody}</text><text placement="attribution">${safeApp}</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>');`,
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml);',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Steam").Show($toast);'
  ].join(' ');
}

function triggerLocalOverlayNotification(event = {}, { execFn = execFile, platform = process.platform } = {}) {
  const title = event.action === 'remove' ? '🔒 Achievement Locked' : '🏆 Achievement Unlocked';
  const name = String(event.name || event.apiname || 'Steam Achievement');
  const description = String(event.description || '');
  const appid = Number(event.appid) || 0;
  const steamInfo = detectLocalSteamClient();
  const psScript = buildWindowsToastPowerShell({ title, name, description, appid });

  return new Promise(resolve => {
    if (platform === 'win32') {
      execFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: 4000 }, err => {
        resolve({ ok: !err, method: 'windows-toast', steamDetected: steamInfo.detected, script: psScript });
      });
      return;
    }
    if (platform === 'linux') {
      execFn('notify-send', [title, `${name}${description ? ' — ' + description : ''}`], { timeout: 3000 }, err => {
        resolve({ ok: !err, method: 'notify-send', steamDetected: steamInfo.detected, script: psScript });
      });
      return;
    }
    resolve({ ok: true, method: 'simulated', steamDetected: steamInfo.detected, script: psScript });
  });
}

function connect(serverUrl = SERVER_URL) {
  const url = new URL(`${serverUrl}/api/events?bridge=1`);
  const client = url.protocol === 'https:' ? https : http;

  const req = client.get(url.toString(), (res) => {
    console.log('[SteamFarmer Companion] Connected to SteamFarmer SSE stream.');
    res.on('data', chunk => {
      const text = chunk.toString();
      if (text.includes('achievement_unlocked')) {
        console.log('[SteamFarmer Companion] 🏆 Achievement event received! Triggering local desktop notification.');
        try {
          const dataLine = text.split('\n').find(l => l.startsWith('data:'));
          const parsed = dataLine ? JSON.parse(dataLine.slice(5).trim()) : {};
          triggerLocalOverlayNotification(parsed).catch(() => {});
        } catch {}
      }
    });
    res.on('end', () => {
      const t = setTimeout(() => connect(serverUrl), 5000);
      t.unref?.();
    });
  });

  req.on('error', () => {
    const t = setTimeout(() => connect(serverUrl), 5000);
    t.unref?.();
  });
  return req;
}

if (require.main === module) {
  console.log(`[SteamFarmer Companion] Starting local bridge to: ${SERVER_URL}`);
  connect();
}

module.exports = {
  connect,
  escapeXml,
  buildWindowsToastPowerShell,
  triggerLocalOverlayNotification
};
