self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  const notification = payload?.notification;
  if (!notification || typeof notification.title !== 'string' || typeof notification.body !== 'string') return;
  const requested = payload?.fcmOptions?.link ?? payload?.data?.link;
  let path = '/?view=today';
  if (typeof requested === 'string') {
    try {
      const link = new URL(requested, self.location.origin);
      if (link.origin === self.location.origin) path = `${link.pathname}${link.search}`;
    } catch { /* Use Today when a message has no valid link. */ }
  }
  event.waitUntil(self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: '/favicon-192.png',
    data: { path },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = event.notification.data?.path ?? '/?view=today';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).pathname === new URL(path, self.location.origin).pathname);
    if (existing) {
      await existing.navigate(path);
      await existing.focus();
    } else {
      await self.clients.openWindow(path);
    }
  })());
});
