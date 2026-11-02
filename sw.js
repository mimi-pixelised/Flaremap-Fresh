self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let alert = {};
    try {
      alert = event.data?.json() || {};
    } catch {}

    await self.registration.showNotification(
      alert.title || "FlareMap",
      {
        body: alert.body || "A new alert has arrived.",
        tag: alert.id || "flaremap-alert",
        data: { id: alert.id },
        silent: false
      }
    );

    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const page of windows) {
      if (page.url.startsWith(self.registration.scope)) {
        page.postMessage({ type: "FLAREMAP_ALARM", alert });
      }
    }
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    const page = windows.find(window =>
      window.url.startsWith(self.registration.scope)
    );

    if (page) {
      await page.focus();
    } else {
      await self.clients.openWindow(self.registration.scope);
    }
  })());
});