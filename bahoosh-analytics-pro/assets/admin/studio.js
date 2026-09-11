/** Bahoosh Analytics Pro v4 — advanced wp-admin workspace. */
(function () {
  "use strict";

  var cfg = window.BAP_STUDIO || {};
  var root = document.querySelector("[data-bap-screen]");
  if (!root || !cfg.restBase) return;
  var screen = root.getAttribute("data-bap-screen");

  function request(path, options) {
    options = options || {};
    var headers = Object.assign({ "X-WP-Nonce": cfg.nonce }, options.headers || {});
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    return fetch(cfg.restBase + path, Object.assign({ credentials: "same-origin", headers: headers }, options))
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok || body.success === false) {
            var error = new Error(body.message || body.error || "Request failed");
            error.status = response.status;
            error.body = body;
            throw error;
          }
          return body;
        });
      });
  }

  function status(message, error) {
    var el = root.querySelector("[data-bap-status]");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-error", !!error);
  }

  function backendMessage(error) {
    if (error && error.status === 502) return cfg.i18n.backendUpgrade;
    return (error && error.message) || cfg.i18n.error;
  }

  function el(name, className, text) {
    var node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function formatNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n.toLocaleString("fa-IR") : "—";
  }

  /* ------------------------------------------------------------------ */
  /* Purchase funnel — where buyers stop, and what was broken there     */
  /* ------------------------------------------------------------------ */

  function initFunnels() {
    var button = root.querySelector("[data-bap-load]");
    if (button) button.addEventListener("click", loadFunnel);
    var range = document.getElementById("bap-studio-range");
    if (range) range.addEventListener("change", loadFunnel);
    loadFunnel();
  }

  function loadFunnel() {
    status(cfg.i18n.loading, false);
    var range = "?range=" + encodeURIComponent(value("#bap-studio-range") || "last_7_days");

    // Two independent requests: the funnel itself, and the friction signals
    // that explain it. Either can be empty without blanking the other.
    request("/funnels/standard/report" + range)
      .then(function (body) {
        renderFunnel(body.steps || []);
        renderProductFunnel(body.products || []);
        status(cfg.i18n.ready, false);
      })
      .catch(function (error) {
        renderFunnel([]);
        renderProductFunnel([]);
        status(backendMessage(error), true);
      });

    request("/explore" + range)
      .then(function (body) {
        renderExitPages(body.pages || []);
        renderIssues(body.pages || [], body.types || []);
      })
      .catch(function () {
        renderExitPages([]);
        renderIssues([], []);
      });
  }

  function renderFunnel(steps) {
    var box = document.getElementById("bap-funnel-report");
    if (!box) return;
    box.textContent = "";

    var reached = steps.filter(function (step) {
      return step.count > 0;
    });

    if (!reached.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noData || "داده‌ای نیست."));
      return;
    }

    var widest = reached[0].count || 1;

    steps.forEach(function (step) {
      var row = el("div", "bap-funnel-step");

      var head = el("div", "bap-funnel-step__head");
      head.appendChild(el("strong", "", step.label));
      head.appendChild(el("b", "bap-funnel-count", formatNumber(step.count) + " نفر"));
      row.appendChild(head);

      // The bar is proportional to the first step, so the shape of the funnel
      // is visible at a glance rather than having to be read off the numbers.
      var track = el("div", "bap-funnel-bar");
      var fill = el("i", "");
      fill.style.width = Math.max(1, Math.round(((step.count || 0) / widest) * 100)) + "%";
      track.appendChild(fill);
      row.appendChild(track);

      var foot = el("div", "bap-funnel-step__foot");
      foot.appendChild(el("span", "bap-muted", Number(step.of_first_pc || 0).toFixed(1) + "٪ از مرحله اول"));


      if (step.drop_pc !== null && step.drop_pc !== undefined) {
        var drop = el("span", "bap-drop" + (step.drop_pc >= 50 ? " is-bad" : ""), Number(step.drop_pc).toFixed(1) + "٪ اینجا رها کردند");
        foot.appendChild(drop);
      }

      row.appendChild(foot);
      box.appendChild(row);
    });
  }

  // The funnel, per product. The overall funnel says people abandon at
  // checkout; this says which product they were abandoning, which is the
  // difference between a statistic and a job.
  function renderProductFunnel(products) {
    var box = document.getElementById("bap-product-funnel");
    if (!box) return;
    box.textContent = "";

    if (!products.length) {
      box.appendChild(
        el(
          "div",
          "bap-empty-state",
          "هنوز داده‌ای در سطح محصول نیست. وقتی بازدیدکننده‌ها صفحه محصول را ببینند یا چیزی در سبد بگذارند، اینجا پر می‌شود."
        )
      );
      return;
    }

    products.forEach(function (product) {
      var row = el("article", "bap-product-row");

      var head = el("div", "bap-product-row__head");
      head.appendChild(el("strong", "", product.name));
      if (product.lost_at_label) {
        head.appendChild(el("span", "bap-drop is-bad", product.lost_people + " نفر " + product.lost_at_label));
      }
      row.appendChild(head);

      var steps = el("div", "bap-product-steps");
      [
        ["دیدن محصول", product.view_item],
        ["سبد خرید", product.add_to_cart],
        ["صفحه پرداخت", product.begin_checkout],
        ["خرید", product.purchase],
      ].forEach(function (pair, index, all) {
        var step = el("span", "bap-product-step");
        step.appendChild(el("b", "", formatNumber(pair[1])));
        step.appendChild(el("i", "", pair[0]));
        steps.appendChild(step);
        if (index < all.length - 1) steps.appendChild(el("u", "bap-product-arrow", "←"));
      });
      row.appendChild(steps);

      var rates = [];
      if (product.cart_rate !== null && product.cart_rate !== undefined) {
        rates.push(product.cart_rate + "٪ از بیننده‌ها سبد کردند");
      }
      if (product.buy_rate !== null && product.buy_rate !== undefined) {
        rates.push(product.buy_rate + "٪ از سبدها خریده شد");
      }
      if (rates.length) row.appendChild(el("div", "bap-muted", rates.join(" · ")));

      if (product.advice) row.appendChild(el("p", "bap-product-advice", product.advice));

      box.appendChild(row);
    });
  }

  // Checkout-intent pages ranked by how many people were last seen on them.
  var CHECKOUT_HINTS = ["cart", "checkout", "سبد", "پرداخت", "تسویه"];

  function renderExitPages(pages) {
    var box = document.getElementById("bap-exit-pages");
    if (!box) return;
    box.textContent = "";

    var candidates = pages.filter(function (page) {
      var path = String(page.page_path || "").toLowerCase();
      return CHECKOUT_HINTS.some(function (hint) {
        return path.indexOf(hint) !== -1;
      });
    });

    // Nothing matched the usual checkout paths, so show the busiest pages
    // instead of an empty panel — a custom checkout URL is common.
    if (!candidates.length) candidates = pages.slice(0, 8);

    if (!candidates.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noData || "داده‌ای نیست."));
      return;
    }

    candidates.slice(0, 8).forEach(function (page) {
      var row = el("div", "bap-explorer-row");
      var main = el("div", "bap-explorer-row__main");
      main.appendChild(el("strong", "", page.page_path));

      var bought = (page.by_type || {}).purchase || 0;
      var started = (page.by_type || {}).begin_checkout || (page.by_type || {}).add_to_cart || 0;
      if (started) {
        main.appendChild(el("span", "bap-muted", "شروع " + formatNumber(started) + " · خرید " + formatNumber(bought)));
      }
      row.appendChild(main);

      var stats = el("div", "bap-explorer-row__stats");
      [[formatNumber(page.visitors), "کاربر"], [formatNumber(page.views), "بازدید"]].forEach(function (pair) {
        var stat = el("span", "bap-explorer-stat");
        stat.appendChild(el("b", "", pair[0]));
        stat.appendChild(el("i", "", pair[1]));
        stats.appendChild(stat);
      });
      row.appendChild(stats);

      box.appendChild(row);
    });
  }

  var FRICTION = { rage_click: "کلیک عصبی", dead_click: "کلیک بی‌اثر", js_error: "خطای جاوااسکریپت" };

  function renderIssues(pages, types) {
    var box = document.getElementById("bap-issues");
    if (!box) return;
    box.textContent = "";

    var rows = [];

    pages.forEach(function (page) {
      Object.keys(FRICTION).forEach(function (signal) {
        var count = (page.by_type || {})[signal] || 0;
        if (count > 0) rows.push({ page: page.page_path, signal: signal, count: count });
      });
    });

    rows.sort(function (a, b) {
      return b.count - a.count;
    });

    if (!rows.length) {
      // An empty panel here is ambiguous: no problems, or no measurement? The
      // tracking switches are off by default, so say which one it is.
      var tracked = types.some(function (row) {
        return FRICTION[row.event_type];
      });
      box.appendChild(
        el(
          "div",
          "bap-empty-state",
          tracked
            ? "اصطکاکی روی صفحات ثبت نشده است."
            : "رهگیری کلیک عصبی، کلیک بی‌اثر و خطای جاوااسکریپت در تنظیمات خاموش است، بنابراین دلیل فنی رها کردن خرید اندازه‌گیری نمی‌شود."
        )
      );
      return;
    }

    rows.slice(0, 10).forEach(function (row) {
      var line = el("div", "bap-explorer-row");
      var main = el("div", "bap-explorer-row__main");
      main.appendChild(el("strong", "", FRICTION[row.signal]));
      main.appendChild(el("span", "bap-muted", row.page));
      line.appendChild(main);

      var stats = el("div", "bap-explorer-row__stats");
      var stat = el("span", "bap-explorer-stat");
      stat.appendChild(el("b", "", formatNumber(row.count)));
      stat.appendChild(el("i", "", "بار"));
      stats.appendChild(stat);
      line.appendChild(stats);

      box.appendChild(line);
    });
  }

  /* ------------------------------------------------------------------ */
  /* AI Center                                                          */
  /* ------------------------------------------------------------------ */

  var aiActionCatalog = {};
  var aiAutonomy = "approval";

  function initAI() {
    var refresh = document.getElementById("bap-refresh-ai");
    var run = document.getElementById("bap-run-ai");
    if (refresh) refresh.addEventListener("click", loadAIRecommendations);
    if (run) run.addEventListener("click", runAI);
    loadAIRecommendations();
  }

  function loadAIRecommendations() {
    status(cfg.i18n.loading, false);
    request("/ai/recommendations").then(function (body) {
      aiActionCatalog = body.action_catalog || {};
      aiAutonomy = body.autonomy || "approval";
      var items = body.recommendations || [];
      renderRecommendations(items);
      renderAIStats(items);
      renderAIArtifacts(body.workspace || {});
      renderAIAudit(body.audit || []);
      renderAgentLog((body.agent || {}).log || []);
      status(body.enabled ? cfg.i18n.ready : cfg.i18n.aiDisabled, !body.enabled);
    }).catch(function (error) { status(backendMessage(error), true); });
  }

  function runAI() {
    status(cfg.i18n.aiRunning, false);
    request("/ai/analyze", {
      method: "POST",
      body: JSON.stringify({ focus: value("#bap-ai-focus") || "revenue", range: value("#bap-ai-range") || "last_7_days" }),
    }).then(function (body) {
      // The analysis is synchronous now — it runs in this request rather than
      // being queued somewhere else — so the results are already here.
      renderFacts((body.packet || {}).facts || [], (body.packet || {}).data_quality || {});

      var note = cfg.i18n.ready;
      if (body && body.fallback) {
        note = "مدل پاسخ نداد؛ نتیجه با موتور قانون‌محور داخلی ساخته شد." + (body.error ? " (" + body.error + ")" : "");
      } else if (body && !body.success && body.error) {
        note = body.error;
      }

      status(note, Boolean(body && (body.fallback || !body.success)));
      loadAIRecommendations();
    }).catch(function (error) { status(backendMessage(error), true); });
  }

  // The facts panel exists so an administrator can check the advice against the
  // shop's own numbers. Every recommendation cites ids from this list; anything
  // citing an id that is not here was discarded before it reached the screen.
  function renderFacts(facts, quality) {
    var box = document.getElementById("bap-ai-facts");
    if (!box) return;
    box.textContent = "";

    if (quality && typeof quality.score !== "undefined") {
      var head = el("div", "bap-policy-row");
      head.appendChild(el("span", "", "کیفیت داده این تحلیل"));
      head.appendChild(el("strong", "", formatNumber(quality.score) + "٪"));
      box.appendChild(head);
    }

    (quality && quality.warnings ? quality.warnings : []).forEach(function (warning) {
      box.appendChild(el("p", "bap-muted", "⚠ " + warning));
    });

    if (!facts.length) {
      box.appendChild(el("div", "bap-empty-state", "هیچ Factی برای این بازه ساخته نشد."));
      return;
    }

    facts.forEach(function (fact) {
      var row = el("article", "bap-ai-artifact");
      row.appendChild(el("strong", "", fact.label || fact.kind));
      row.appendChild(el("code", "bap-evidence-chip", fact.id));
      row.appendChild(el("span", "bap-muted", "نمونه: " + formatNumber(fact.sample_size || 0)));
      var value = el("pre", "bap-fact-value");
      value.textContent = JSON.stringify(fact.value, null, 1);
      row.appendChild(value);
      box.appendChild(row);
    });
  }

  function renderAgentLog(entries) {
    var box = document.getElementById("bap-agent-log");
    if (!box) return;
    box.textContent = "";

    if (!entries.length) {
      box.appendChild(el("div", "bap-empty-state", "هنوز تغییری روی فروشگاه اعمال نشده است."));
      return;
    }

    entries.forEach(function (entry) {
      var row = el("article", "bap-ai-artifact");
      row.appendChild(el("strong", "", entry.label || entry.type));

      var at = String(entry.at || "");
      if (window.BAPJalali && at) at = window.BAPJalali.formatISO(at.slice(0, 10), true);
      row.appendChild(el("span", "bap-muted", at));

      if (entry.data && entry.data.ends_at) {
        var ends = String(entry.data.ends_at).slice(0, 10);
        if (window.BAPJalali) ends = window.BAPJalali.formatISO(ends, true);
        row.appendChild(el("span", "bap-muted", "پایان: " + ends));
      }

      if (entry.reverted_at) {
        row.appendChild(el("span", "bap-badge", "بازگردانده شد"));
      } else {
        var undo = el("button", "button", "بازگرداندن");
        undo.type = "button";
        undo.addEventListener("click", function () {
          undo.disabled = true;
          request("/ai/agent/revert/" + encodeURIComponent(entry.id), { method: "POST" })
            .then(function (body) { renderAgentLog(body.entries || []); })
            .catch(function (error) { undo.disabled = false; status(backendMessage(error), true); });
        });
        row.appendChild(undo);
      }

      box.appendChild(row);
    });
  }

  function renderAIStats(items) {
    var counts = { pending: 0, applied: 0 };
    items.forEach(function (item) {
      if (item.status === "pending") counts.pending += 1;
      if (item.status === "applied") counts.applied += 1;
    });
    var total = document.getElementById("bap-ai-total-count");
    var pending = document.getElementById("bap-ai-pending-count");
    var applied = document.getElementById("bap-ai-applied-count");
    if (total) total.textContent = formatNumber(items.length);
    if (pending) pending.textContent = formatNumber(counts.pending);
    if (applied) applied.textContent = formatNumber(counts.applied);
  }

  function renderRecommendations(items) {
    var box = document.getElementById("bap-ai-recommendations");
    if (!box) return;
    box.textContent = "";
    if (!items.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noRecommendations));
      return;
    }
    items.forEach(function (item) {
      var card = el("article", "bap-ai-card is-" + safeClass(item.priority || "medium"));
      var top = el("div", "bap-ai-card-top");
      top.appendChild(el("span", "bap-severity is-" + safeClass(item.priority || "medium"), faStatus(item.priority || "medium")));
      top.appendChild(el("span", "bap-confidence", formatNumber(item.confidence || 0) + "٪ اطمینان"));
      top.appendChild(el("span", "bap-pill", faStatus(item.status || "pending")));
      card.appendChild(top);
      card.appendChild(el("h3", "", item.title || "پیشنهاد"));
      if (item.summary) card.appendChild(el("p", "bap-ai-summary", item.summary));

      if (item.impact) {
        var impact = el("div", "bap-ai-impact");
        impact.appendChild(el("span", "", "اثر احتمالی"));
        impact.appendChild(el("strong", "", item.impact));
        card.appendChild(impact);
      }

      if (item.rationale) {
        var why = document.createElement("details");
        why.className = "bap-ai-rationale";
        var whySummary = document.createElement("summary");
        whySummary.textContent = "چرا این پیشنهاد داده شده؟";
        why.appendChild(whySummary);
        why.appendChild(el("p", "", item.rationale));
        card.appendChild(why);
      }

      if (item.evidence && item.evidence.length) {
        var evidenceWrap = el("div", "bap-evidence-wrap");
        evidenceWrap.appendChild(el("span", "bap-evidence-label", "شواهد"));
        var evidence = el("div", "bap-evidence");
        item.evidence.slice(0, 8).forEach(function (row) { evidence.appendChild(el("code", "bap-evidence-chip", row)); });
        evidenceWrap.appendChild(evidence);
        card.appendChild(evidenceWrap);
      }

      if (item.action && item.action.type) {
        var definition = aiActionCatalog[item.action.type] || {};
        var action = el("div", "bap-ai-action-preview");
        var actionHead = el("div", "bap-ai-action-preview__head");
        actionHead.appendChild(el("span", "bap-kicker", "اقدام پیشنهادی"));
        actionHead.appendChild(el("span", "bap-pill", definition.safe_auto ? "کم‌ریسک" : "نیازمند تأیید"));
        action.appendChild(actionHead);
        action.appendChild(el("strong", "", definition.label || item.action.type));
        if (definition.description) action.appendChild(el("p", "", definition.description));
        action.appendChild(el("code", "bap-action-type", item.action.type));
        card.appendChild(action);
      }

      if (item.status === "pending") {
        var actions = el("div", "bap-actions");
        var approveText = aiAutonomy === "insights" ? "تأیید بینش" : (item.action && item.action.type ? "تأیید و اجرا" : "تأیید پیشنهاد");
        var approve = el("button", "button button-primary bap-primary", approveText);
        approve.type = "button";
        approve.addEventListener("click", function () { decideAI(item.id, "approve"); });
        var reject = el("button", "button", cfg.i18n.reject);
        reject.type = "button";
        reject.addEventListener("click", function () { decideAI(item.id, "reject"); });
        actions.appendChild(approve);
        actions.appendChild(reject);
        card.appendChild(actions);
      }
      box.appendChild(card);
    });
  }

  function renderAIArtifacts(workspace) {
    renderAIAlerts(workspace.alerts || []);
    renderAIAnnotations(workspace.annotations || []);
  }

  function renderAIAlerts(items) {
    var box = document.getElementById("bap-ai-alerts");
    if (!box) return;
    box.textContent = "";
    if (!items.length) {
      box.appendChild(el("div", "bap-empty-state", "هنوز هشداری ساخته نشده است."));
      return;
    }
    items.slice().reverse().slice(0, 12).forEach(function (item) {
      var row = el("article", "bap-ai-artifact");
      row.appendChild(el("strong", "", item.name || "هشدار تحلیلی"));
      row.appendChild(el("span", "bap-muted", (item.metric || "metric") + " · " + (item.operator || "") + " · " + formatNumber(item.threshold)));
      row.appendChild(el("span", "bap-badge is-active", item.enabled === false ? "غیرفعال" : "فعال"));
      box.appendChild(row);
    });
  }

  function renderAIAnnotations(items) {
    var box = document.getElementById("bap-ai-annotations");
    if (!box) return;
    box.textContent = "";
    if (!items.length) {
      box.appendChild(el("div", "bap-empty-state", "هنوز یادداشتی ثبت نشده است."));
      return;
    }
    items.slice().reverse().slice(0, 12).forEach(function (item) {
      var row = el("article", "bap-ai-artifact");
      row.appendChild(el("strong", "", item.label || "یادداشت تحلیلی"));
      if (item.note) row.appendChild(el("p", "", item.note));
      var date = item.date || "";
      if (window.BAPJalali && date) date = window.BAPJalali.formatISO(date, true);
      row.appendChild(el("span", "bap-muted", date));
      box.appendChild(row);
    });
  }


  function renderAIAudit(rows) {
    var box = document.getElementById("bap-ai-audit");
    if (!box) return;
    box.textContent = "";
    if (!rows.length) {
      box.appendChild(el("div", "bap-empty-state", "هنوز فعالیتی برای نمایش وجود ندارد."));
      return;
    }
    rows.slice(0, 20).forEach(function (row) {
      var item = el("div", "bap-audit-row");
      var main = el("div", "bap-audit-row__main");
      main.appendChild(el("strong", "", auditLabel(row.type)));
      var at = String(row.at || "");
      var dateLabel = at;
      if (window.BAPJalali && at) {
        dateLabel = window.BAPJalali.formatISO(at.slice(0, 10), true);
      }
      main.appendChild(el("span", "bap-muted", dateLabel));
      item.appendChild(main);
      if (row.data && row.data.type) item.appendChild(el("code", "", row.data.type));
      box.appendChild(item);
    });
  }

  function auditLabel(type) {
    var map = {
      callback_ingested: "دریافت پیشنهاد از بک‌اند",
      recommendation_rejected: "رد پیشنهاد توسط مدیر",
      recommendation_approved: "تأیید پیشنهاد توسط مدیر",
      action_applied: "اجرای موفق اقدام",
      action_failed: "خطا در اجرای اقدام"
    };
    return map[type] || type || "فعالیت هوش مصنوعی";
  }

  function decideAI(id, decision) {
    status(cfg.i18n.applying, false);
    request("/ai/recommendations/" + encodeURIComponent(id) + "/decision", {
      method: "POST",
      body: JSON.stringify({ decision: decision, execute: decision === "approve" && aiAutonomy !== "insights" }),
    }).then(function () { status(cfg.i18n.saved, false); loadAIRecommendations(); })
      .catch(function (error) { status(backendMessage(error), true); });
  }


  function faStatus(value) {
    var map = {pending:"در انتظار",approved:"تأییدشده",rejected:"ردشده",applied:"اجراشده",failed:"ناموفق",low:"کم",medium:"متوسط",high:"زیاد",critical:"بحرانی"};
    return map[String(value || "").toLowerCase()] || value || "";
  }

  function value(selector) {
    var node = document.querySelector(selector);
    return node ? String(node.value || "").trim() : "";
  }
  function safeClass(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, ""); }
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  if (screen === "funnels") initFunnels();
  else if (screen === "ai") initAI();
})();
