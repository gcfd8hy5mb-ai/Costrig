self.addEventListener('push', event => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { message = {}; }
  event.waitUntil(self.registration.showNotification(message.title || 'Equipment Cost Book reminder', {
    body: message.body || 'A scheduled service is getting close.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: `costrig-${message.scheduleId || 'service'}`,
    data: { assetId: message.assetId || null }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const assetId = event.notification.data?.assetId;
  const url = new URL('./', self.registration.scope);
  if (assetId) url.searchParams.set('asset', assetId);
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'costrig-open-asset', assetId });
      return;
    }
    return clients.openWindow(url.href);
  }));
});
