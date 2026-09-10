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
  /* Experience                                                         */
  /* ------------------------------------------------------------------ */

  function initExperience() {
    var button = root.querySelector("[data-bap-load]");
    if (button) button.addEventListener("click", loadExperience);
    loadExperience();
  }

  function loadExperience() {
    status(cfg.i18n.loading, false);
    var range = value("#bap-studio-range") || "last_7_days";
    var url = value("#bap-experience-url");
    var device = value("#bap-experience-device");
    var query = "?range=" + encodeURIComponent(range);
    if (url) query += "&url=" + encodeURIComponent(url);
    if (device) query += "&device=" + encodeURIComponent(device);

    request("/experience" + query).then(function (body) {
      var data = body.experience || body.data || body;
      renderExperienceSummary(data.summary || {});
      renderHeatmap(data.heatmap || {});
      renderIssues(data.top_issues || data.issues || []);
      status(cfg.i18n.ready, false);
    }).catch(function (error) {
      renderExperienceSummary({});
      renderHeatmap({});
      renderIssues([]);
      status(backendMessage(error), true);
    });
  }

  function renderExperienceSummary(summary) {
    root.querySelectorAll("[data-experience-metric]").forEach(function (node) {
      node.textContent = formatNumber(summary[node.getAttribute("data-experience-metric")]);
    });
  }

  function renderHeatmap(heatmap) {
    var box = document.getElementById("bap-heatmap");
    if (!box) return;
    box.textContent = "";
    var points = heatmap.points || [];
    if (!points.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noHeatmap));
      return;
    }

    var stage = el("div", "bap-heatmap-stage");
    points.slice(0, 400).forEach(function (point) {
      var x = Number(point.x_ratio !== undefined ? point.x_ratio : point.x);
      var y = Number(point.y_ratio !== undefined ? point.y_ratio : point.y);
      var count = Number(point.count || point.value || 1);
      if (!isFinite(x) || !isFinite(y)) return;
      if (x > 1) x = x / 100;
      if (y > 1) y = y / 100;
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      var dot = el("span", "bap-heat-dot");
      dot.style.left = (x * 100).toFixed(2) + "%";
      dot.style.top = (y * 100).toFixed(2) + "%";
      var size = Math.max(14, Math.min(58, 14 + Math.sqrt(Math.max(1, count)) * 5));
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      dot.title = count.toLocaleString() + " کلیک";
      stage.appendChild(dot);
    });
    box.appendChild(stage);
  }

  function renderIssues(issues) {
    var box = document.getElementById("bap-issues");
    if (!box) return;
    box.textContent = "";
    if (!issues.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noIssues));
      return;
    }
    issues.slice(0, 12).forEach(function (issue) {
      var item = el("article", "bap-issue");
      var meta = el("div", "bap-issue-meta");
      meta.appendChild(el("span", "bap-severity is-" + safeClass(issue.severity || "medium"), faStatus(issue.severity || "medium")));
      meta.appendChild(el("strong", "", formatNumber(issue.count || 0)));
      item.appendChild(meta);
      item.appendChild(el("h3", "", issue.label || issue.type || "مشکل تجربه کاربری"));
      if (issue.url) item.appendChild(el("p", "bap-muted bap-truncate", issue.url));
      box.appendChild(item);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Funnels                                                            */
  /* ------------------------------------------------------------------ */

  var selectedFunnel = null;
  var funnelCache = [];

  function initFunnels() {
    var add = document.getElementById("bap-add-step");
    var save = document.getElementById("bap-save-funnel");
    var range = document.getElementById("bap-funnel-range");
    if (add) add.addEventListener("click", function () { addFunnelStep(); });
    if (save) save.addEventListener("click", saveFunnel);
    if (range) range.addEventListener("change", function () { if (selectedFunnel) loadFunnelReport(selectedFunnel); });
    addFunnelStep("بازدید صفحه", "page_view");
    addFunnelStep("خرید", "purchase");
    loadFunnels();
  }

  function addFunnelStep(labelValue, typeValue) {
    var box = document.getElementById("bap-funnel-steps");
    if (!box) return;
    var row = el("div", "bap-funnel-step");
    var index = box.children.length + 1;
    row.appendChild(el("span", "bap-step-number", index));
    var label = document.createElement("input");
    label.type = "text";
    label.className = "bap-step-label";
    label.placeholder = "عنوان مرحله";
    label.value = labelValue || "";
    row.appendChild(label);
    var select = document.createElement("select");
    select.className = "bap-step-event";
    (cfg.eventTypes || []).forEach(function (type) {
      var option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      if (type === typeValue) option.selected = true;
      select.appendChild(option);
    });
    row.appendChild(select);
    var path = document.createElement("input");
    path.type = "text";
    path.className = "bap-step-path";
    path.placeholder = "فیلتر مسیر (اختیاری)";
    row.appendChild(path);
    var remove = el("button", "button bap-icon-button", "×");
    remove.type = "button";
    remove.addEventListener("click", function () {
      row.remove();
      renumberSteps();
    });
    row.appendChild(remove);
    box.appendChild(row);
  }

  function renumberSteps() {
    document.querySelectorAll("#bap-funnel-steps .bap-step-number").forEach(function (node, i) { node.textContent = i + 1; });
  }

  function saveFunnel() {
    var name = value("#bap-funnel-name");
    var steps = [];
    document.querySelectorAll("#bap-funnel-steps .bap-funnel-step").forEach(function (row) {
      steps.push({
        label: row.querySelector(".bap-step-label").value,
        event_type: row.querySelector(".bap-step-event").value,
        path: row.querySelector(".bap-step-path").value,
      });
    });
    status(cfg.i18n.saving, false);
    request("/funnels", { method: "POST", body: JSON.stringify({ name: name, steps: steps }) })
      .then(function () {
        status(cfg.i18n.saved, false);
        document.getElementById("bap-funnel-name").value = "";
        loadFunnels();
      })
      .catch(function (error) { status(backendMessage(error), true); });
  }

  function loadFunnels() {
    request("/funnels").then(function (body) {
      funnelCache = body.funnels || [];
      renderFunnelList(funnelCache);
    }).catch(function (error) { status(backendMessage(error), true); });
  }

  function renderFunnelList(funnels) {
    var box = document.getElementById("bap-funnel-list");
    if (!box) return;
    box.textContent = "";
    if (!funnels.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noFunnels));
      return;
    }
    funnels.forEach(function (funnel) {
      var item = el("article", "bap-funnel-item");
      var copy = el("button", "bap-funnel-select", "");
      copy.type = "button";
      copy.appendChild(el("strong", "", funnel.name));
      copy.appendChild(el("span", "", (funnel.steps || []).length + " مرحله"));
      copy.addEventListener("click", function () { selectedFunnel = funnel.id; loadFunnelReport(funnel.id); });
      item.appendChild(copy);
      var remove = el("button", "button-link-delete bap-delete", cfg.i18n.delete);
      remove.type = "button";
      remove.addEventListener("click", function () {
        request("/funnels/" + encodeURIComponent(funnel.id), { method: "DELETE" }).then(loadFunnels);
      });
      item.appendChild(remove);
      box.appendChild(item);
    });
  }

  function loadFunnelReport(id) {
    var funnel = funnelCache.find(function (item) { return item.id === id; });
    var title = document.getElementById("bap-funnel-report-title");
    if (title && funnel) title.textContent = funnel.name;
    var report = document.getElementById("bap-funnel-report");
    if (report) report.innerHTML = '<div class="bap-empty-state">' + escapeHtml(cfg.i18n.loading) + "</div>";
    var range = value("#bap-funnel-range") || "last_7_days";
    request("/funnels/" + encodeURIComponent(id) + "/report?range=" + encodeURIComponent(range))
      .then(function (body) { renderFunnelReport(body.report || body.funnel_report || body); })
      .catch(function (error) {
        if (report) { report.textContent = ""; report.appendChild(el("div", "bap-empty-state is-error", backendMessage(error))); }
      });
  }

  function renderFunnelReport(data) {
    var box = document.getElementById("bap-funnel-report");
    if (!box) return;
    box.textContent = "";
    var steps = data.steps || [];
    if (!steps.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noReport));
      return;
    }
    var max = Number(steps[0].users || steps[0].count || 1) || 1;
    steps.forEach(function (step, index) {
      var item = el("div", "bap-funnel-bar");
      var head = el("div", "bap-funnel-bar-head");
      head.appendChild(el("strong", "", (index + 1) + ". " + (step.label || step.event_type || "مرحله")));
      head.appendChild(el("span", "", formatNumber(step.users || step.count || 0)));
      item.appendChild(head);
      var rail = el("div", "bap-funnel-rail");
      var fill = el("span", "");
      fill.style.width = Math.max(2, Math.min(100, ((Number(step.users || step.count || 0) / max) * 100))) + "%";
      rail.appendChild(fill);
      item.appendChild(rail);
      var meta = el("small", "bap-muted", step.conversion_rate !== undefined ? Number(step.conversion_rate).toFixed(1) + "% تبدیل" : "");
      item.appendChild(meta);
      box.appendChild(item);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Journeys                                                           */
  /* ------------------------------------------------------------------ */

  function initJourneys() {
    var button = root.querySelector("[data-bap-load]");
    if (button) button.addEventListener("click", loadJourneys);
    loadJourneys();
  }

  function loadJourneys() {
    status(cfg.i18n.loading, false);
    var query = "?range=" + encodeURIComponent(value("#bap-studio-range") || "last_7_days");
    var entry = value("#bap-journey-entry");
    var conversion = value("#bap-journey-conversion");
    if (entry) query += "&entry=" + encodeURIComponent(entry);
    if (conversion) query += "&conversion=" + encodeURIComponent(conversion);
    request("/journeys" + query).then(function (body) {
      renderJourneys(body.paths || body.journeys || []);
      status(cfg.i18n.ready, false);
    }).catch(function (error) {
      renderJourneys([]);
      status(backendMessage(error), true);
    });
  }

  function renderJourneys(paths) {
    var box = document.getElementById("bap-journeys");
    if (!box) return;
    box.textContent = "";
    if (!paths.length) {
      box.appendChild(el("div", "bap-empty-state", cfg.i18n.noJourneys));
      return;
    }
    paths.slice(0, 30).forEach(function (path, index) {
      var row = el("article", "bap-journey");
      var meta = el("div", "bap-journey-meta");
      meta.appendChild(el("strong", "", "#" + (index + 1)));
      meta.appendChild(el("span", "", formatNumber(path.users || path.count || 0) + " کاربر"));
      if (path.conversion_rate !== undefined) meta.appendChild(el("span", "bap-pill", Number(path.conversion_rate).toFixed(1) + "%"));
      row.appendChild(meta);
      var nodes = el("div", "bap-path-nodes");
      (path.nodes || path.path || []).forEach(function (node, i) {
        nodes.appendChild(el("span", "bap-path-node", typeof node === "string" ? node : (node.label || node.path || node.event_type || "مرحله")));
        if (i < (path.nodes || path.path || []).length - 1) nodes.appendChild(el("i", "", "→"));
      });
      row.appendChild(nodes);
      box.appendChild(row);
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

  if (screen === "experience") initExperience();
  else if (screen === "funnels") initFunnels();
  else if (screen === "journeys") initJourneys();
  else if (screen === "ai") initAI();
})();
