// Web Push service worker for 스마트 가계부.
// Served from the app's context root, so its scope covers the whole app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: '스마트 가계부', body: event.data.text() };
  }

  const icon = new URL('icon-192.png', self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(data.title || '스마트 가계부', {
      body: data.body || '',
      icon,
      badge: icon,
      tag: data.tag || 'household-ledger',
      renotify: true,
      data: { url: data.url || self.registration.scope },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          if ('navigate' in client) await client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
