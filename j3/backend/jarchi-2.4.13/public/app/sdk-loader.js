/* Non-blocking platform SDK loader. Third-party CDN latency must never freeze Jarchi. */
(() => {
  try {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const platform = query.get("platform") || hash.get("platform") || "";
    const sources = platform === "bale"
      ? [["jarchi-bale-sdk", "https://tapi.bale.ai/miniapp.js?3"]]
      : platform === "telegram"
        ? [["jarchi-telegram-sdk", "https://telegram.org/js/telegram-web-app.js?v=7"]]
        : [
            ["jarchi-telegram-sdk", "https://telegram.org/js/telegram-web-app.js?v=7"],
            ["jarchi-bale-sdk", "https://tapi.bale.ai/miniapp.js?3"],
          ];
    for (const [id, src] of sources) {
      if (document.getElementById(id)) continue;
      const script = document.createElement("script");
      script.id = id;
      script.src = src;
      script.async = true;
      script.referrerPolicy = "no-referrer";
      document.head.appendChild(script);
    }
  } catch { /* app.js can still authenticate with a bot session token */ }
})();
