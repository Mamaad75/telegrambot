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

    /*
     * A message the reader can act on, shown where they pressed the button.
     *
     * Every branch of subscribe() used to `return false`. The button was
     * therefore indistinguishable from a dead one — press it and the page does
     * not change, whether the browser refused, the site has no keys, or it
     * worked. On a phone that is the normal case rather than the edge case,
     * because iOS will not deliver web push at all until the site has been
     * added to the Home Screen.
     */
    const toast = (message, kind) => {
        document.querySelectorAll('.jarchi-ticket-toast').forEach((el) => el.remove());

        const el = document.createElement('div');
        el.className = 'jarchi-ticket-toast' + (kind ? ' jarchi-ticket-toast--' + kind : '');
        el.setAttribute('role', 'status');
        el.textContent = message;
        document.body.appendChild(el);

        window.setTimeout(() => el.remove(), 7000);
    };

    /* Is web push reachable in this browser, in this context, at all? */
    const pushSupport = () => {
        if (!cfg.vapidPublicKey) {
            return { ok: false, reason: 'unconfigured' };
        }

        if (!window.isSecureContext) {
            // Service workers are unavailable outside a secure context, so on
            // plain HTTP the feature cannot work however it is configured.
            return { ok: false, reason: 'insecure' };
        }

        const iOS = /iP(hone|ad|od)/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const standalone = window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;

        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            // On iOS this is not a missing feature, it is a missing install
            // step, and the two need different advice.
            return { ok: false, reason: iOS && !standalone ? 'ios-home-screen' : 'unsupported' };
        }

        return { ok: true, iOS: iOS, standalone: standalone };
    };

    const subscribe = async (trigger) => {
        const support = pushSupport();

        if (!support.ok) {
            toast(cfg.i18n[support.reason] || cfg.i18n.unsupported, 'error');
            return false;
        }

        if (Notification.permission === 'denied') {
            toast(cfg.i18n.blocked, 'error');
            return false;
        }

        if (trigger) {
            trigger.classList.add('is-busy');
        }

        try {
            const permission = Notification.permission === 'granted'
                ? 'granted'
                : await Notification.requestPermission();

            if (permission !== 'granted') {
                toast(cfg.i18n.dismissed, 'error');
                return false;
            }

            const registration = await navigator.serviceWorker.register(cfg.swUrl, {
                scope: new URL(cfg.swUrl).pathname.replace(/\/[^/]+$/, '/')
            });

            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
                });
            }

            // The server's answer decides whether this worked. Treating the
            // browser's subscription as success reported "enabled" for a
            // subscription the site never stored.
            const stored = await request('subscribe', {
                method: 'POST',
                body: JSON.stringify(subscription.toJSON())
            });

            if (!stored.ok) {
                toast(cfg.i18n.saveFailed, 'error');
                return false;
            }

            document.documentElement.classList.add('jarchi-push-enabled');
            toast(cfg.i18n.enabled, 'ok');

            document.querySelectorAll('[data-jarchi-enable-notifications]').forEach((el) => {
                el.classList.add('is-done');
                el.hidden = true;
            });

            return true;
        } catch (error) {
            toast(cfg.i18n.failed, 'error');
            return false;
        } finally {
            if (trigger) {
                trigger.classList.remove('is-busy');
            }
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
        subscribe(trigger);
    });

    const ready = () => {
        poll(false);

        /*
         * The button appears only when pressing it can lead somewhere. It used
         * to be revealed on the strength of one setting and the permission
         * state alone, so a site with no keys, or a browser that cannot do
         * push at all, still showed an invitation that could not be accepted —
         * which is a worse answer than not offering it.
         *
         * The iOS case is the exception worth showing: the button stays, and
         * pressing it explains the Home Screen step, because that is something
         * the reader can actually do.
         */
        const support = pushSupport();
        const offer = cfg.prompt
            && Notification.permission !== 'granted'
            && (support.ok || 'ios-home-screen' === support.reason);

        if (offer) {
            document.querySelectorAll('[data-jarchi-enable-notifications]').forEach((el) => {
                el.hidden = false;
            });
        }

        setInterval(() => poll(false), 60000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(false); });
    };

    if ('loading' === document.readyState) {
        document.addEventListener('DOMContentLoaded', ready);
    } else {
        // The script is deferred, so DOMContentLoaded may already have fired
        // by the time it runs — in which case waiting for it waits for ever.
        ready();
    }
})();
