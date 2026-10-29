"use strict";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildWindowsToastPowerShell({ title = "Achievement Unlocked", name = "", description = "", appid = 0 } = {}) {
  const safeTitle = escapeXml(title);
  const safeName = escapeXml(name);
  const safeDesc = escapeXml(description);
  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;",
    "$xml = [Windows.Data.Xml.Dom.XmlDocument]::new();",
    `$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeName}</text><text>${safeDesc}</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>');`,
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml);",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('SteamFarmer.${Number(appid) || 0}').Show($toast);`
  ].join(" ");
}

async function triggerLocalOverlayNotification(ev = {}, { platform = process.platform } = {}) {
  const script = buildWindowsToastPowerShell({
    title: ev.title || "Achievement Unlocked",
    name: ev.name || ev.apiname || "Achievement",
    description: ev.description || "",
    appid: ev.appid || 0
  });
  return {
    ok: true,
    platform,
    simulated: platform !== "win32",
    script
  };
}

module.exports = {
  buildWindowsToastPowerShell,
  triggerLocalOverlayNotification
};
