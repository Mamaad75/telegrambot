(function () {
    'use strict';

    const cfg = window.jarchiTicketNotifications;
    if (!cfg || !cfg.enabled) return;

    const request = (path, options = {}) => fetch(cfg.restUrl + path, Object.assign({
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': cfg.restNonce, 'Content-Type': 'application/json' }
    }, options));

    const setBadges = (count) => {
        document.querySelectorAll('[data-jarchi-notification-badge], [data-jarchi-ticket-badge]').forEach((el) => {
            const n = Math.max(0, Number(count || 0));
            el.textContent = n > 99 ? '99+' : String(n);
            el.classList.toggle('is-visible', n > 0);
        });
    };

    const playSound = () => {
        if (!cfg.sound) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.04, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.18);
        } catch (_) {}
    };

    const poll = async (notify = false) => {
        try {
            const response = await request('summary');
            const data = await response.json();
            if (!data || !data.success) return;
            setBadges(data.unread);
            const latest = Array.isArray(data.latest) ? data.latest[0] : null;
            if (notify && latest && latest.id && latest.id !== window.__jarchiLastNotification) {
                window.__jarchiLastNotification = latest.id;
                playSound();
                if (window.Notification && Notification.permission === 'granted') {
                    const n = new Notification(latest.title || cfg.i18n.newReply, {
                        body: latest.message || '',
                        icon: '/favicon.ico',
                        tag: 'jarchi-ticket-' + latest.id
                    });
                    n.onclick = () => { window.location.href = latest.url || cfg.pageUrl; };
                }
            }
        } catch (_) {}
    };

    const subscribe = async () => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !cfg.vapidPublicKey) {
            return false;
        }
        try {
            const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
            if (permission !== 'granted') return false;
            const registration = await navigator.serviceWorker.register(cfg.swUrl, { scope: new URL(cfg.swUrl).pathname.replace(/\/[^/]+$/, '/') });
            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
                });
            }
            await request('subscribe', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
            document.documentElement.classList.add('jarchi-push-enabled');
            return true;
        } catch (error) {
            console.warn('Jarchi push notification subscription failed', error);
            return false;
        }
    };

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
    }

    window.jarchiEnableTicketNotifications = subscribe;

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-jarchi-enable-notifications]');
        if (!trigger) return;
        event.preventDefault();
        subscribe();
    });

    document.addEventListener('DOMContentLoaded', () => {
        poll(false);
        if (cfg.prompt && 'Notification' in window && Notification.permission === 'default') {
            document.querySelectorAll('[data-jarchi-enable-notifications]').forEach((el) => { el.hidden = false; });
        }
        setInterval(() => poll(false), 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(false); });
    });
})();
