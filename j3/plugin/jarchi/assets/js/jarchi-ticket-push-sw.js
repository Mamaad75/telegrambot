self.addEventListener('push', function (event) {
    event.waitUntil((async function () {
        let data = {};
        try { data = event.data ? event.data.json() : {}; } catch (_) {}
        const title = data.title || 'اعلان جدید جارچی';
        const body = data.body || 'یک اعلان جدید برای شما ثبت شده است.';
        const url = data.url || '/';
        return self.registration.showNotification(title, {
            body: body,
            icon: data.icon || '/favicon.ico',
            badge: data.badge || '/favicon.ico',
            tag: data.tag || 'jarchi-ticket',
            data: { url: url }
        });
    })());
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(url);
            return undefined;
        })
    );
});
