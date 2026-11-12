'use strict';

function escapeXml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWindowsToastPowerShell({ title = 'Achievement Unlocked', name = '', description = '', appid = 0 } = {}) {
  const safeTitle = escapeXml(title);
  const safeName = escapeXml(name);
  const safeDesc = escapeXml(description);
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeName}</text><text>${safeDesc} (AppID ${Number(appid) || 0})</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>')`,
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("SteamFarmer").Show($toast)'
  ].join('; ');
}

async function triggerLocalOverlayNotification(payload = {}, { platform = process.platform } = {}) {
  const script = buildWindowsToastPowerShell(payload);
  return {
    ok: true,
    platform,
    simulated: platform !== 'win32',
    scriptLength: script.length
  };
}

module.exports = { buildWindowsToastPowerShell, triggerLocalOverlayNotification };
