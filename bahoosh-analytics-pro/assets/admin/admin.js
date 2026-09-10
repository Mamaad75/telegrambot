/**
 * Bahoosh Analytics Pro v4 — admin dashboard.
 *
 * Talks only to the plugin's own REST namespace. The collector's secret key
 * stays on the server; v1 handed it to every administrator's browser (and to
 * anyone who could read the page source).
 *
 * Rendering is driven by the `data-metric` / `data-panel` attributes the PHP
 * screen emits, so adding a card server-side needs no change here.
 */
(function () {
  "use strict";

  var config = window.BAP_ADMIN;
  if (!config) return;

  var els = {
    range: document.getElementById("bap-range"),
    customRange: document.getElementById("bap-custom-range"),
    from: document.getElementById("bap-from"),
    to: document.getElementById("bap-to"),
    refresh: document.getElementById("bap-refresh"),
    status: document.getElementById("bap-status"),
    customizeToggle: document.getElementById("bap-customize-toggle"),
    customizer: document.getElementById("bap-dashboard-customizer"),
    saveLayout: document.getElementById("bap-save-layout"),
  };

  var timerId = null;
  var inFlight = null;

  function setStatus(message, isError) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.className = "bap-status" + (isError ? " is-error" : "");
  }

  function formatValue(value, format) {
    if (value === null || value === undefined) return "--";
    if (format === "percent") {
      return (Math.round(value * 1000) / 10).toLocaleString() + "%";
    }
    if (format === "currency") {
      return Number(value).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
    }
    return Number(value).toLocaleString("fa-IR");
  }

  function renderCards(metrics, comparison) {
    var deltas = (comparison && comparison.deltas) || {};
    var cards = document.querySelectorAll("#bap-cards .bap-card");

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var name = card.getAttribute("data-metric");
      var target = card.querySelector("[data-value]");
      if (!target) continue;

      target.textContent = formatValue(metrics[name], card.getAttribute("data-format"));
      renderDelta(card, deltas[name]);
    }
  }

  /**
   * Shows period-over-period movement.
   *
   * A null delta means the comparison is genuinely unavailable — the collector
   * did not answer, or the previous period was zero, where a percentage would
   * be meaningless. Nothing is drawn in that case rather than a misleading 0%.
   */
  function renderDelta(card, delta) {
    var existing = card.querySelector("[data-delta]");
    if (existing) existing.remove();

    if (delta === null || delta === undefined || !isFinite(delta)) return;

    var el = document.createElement("div");
    el.className = "bap-delta " + (delta > 0 ? "is-up" : delta < 0 ? "is-down" : "is-flat");
    el.setAttribute("data-delta", "");

    var arrow = delta > 0 ? "\u2191" : delta < 0 ? "\u2193" : "\u2192";
    el.textContent = arrow + " " + Math.abs(delta).toFixed(1) + "%";
    el.title = config.i18n.vsPrevious;

    // Screen readers get words, not an arrow glyph.
    var label = document.createElement("span");
    label.className = "screen-reader-text";
    label.textContent =
      " " + (delta > 0 ? config.i18n.up : delta < 0 ? config.i18n.down : config.i18n.flat) +
      " " + Math.abs(delta).toFixed(1) + "% " + config.i18n.vsPrevious;
    el.appendChild(label);

    card.appendChild(el);
  }

  /**
   * Draws a small multi-series line chart.
   *
   * Only when the collector actually returned a daily series. If it did not,
   * the panel explains that rather than inventing a shape — a fabricated trend
   * line is worse than no trend line.
   */
  function renderChart(metrics, hasTimeseries) {
    var panel = document.getElementById("bap-chart");
    if (!panel) return;

    var series = metrics.timeseries || [];
    panel.textContent = "";

    if (!hasTimeseries || series.length < 2) {
      var note = document.createElement("p");
      note.className = "bap-muted";
      note.textContent = config.i18n.noTimeseries;
      panel.appendChild(note);
      return;
    }

    var metricsToPlot = [
      { key: "events", label: config.i18n.events, color: "#664dff" },
      { key: "users", label: config.i18n.users, color: "#22c55e" },
      { key: "sessions", label: config.i18n.sessions, color: "#f59e0b" },
      { key: "page_views", label: config.i18n.pageViews, color: "#38bdf8" },
    ];

    var max = 0;
    series.forEach(function (point) {
      metricsToPlot.forEach(function (m) {
        var value = Number(point[m.key]);
        if (isFinite(value) && value > max) max = value;
      });
    });
    if (max <= 0) max = 1;

    var width = 720;
    var height = 220;
    var pad = { top: 12, right: 12, bottom: 26, left: 44 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      class: "bap-chart",
      role: "img",
      "aria-label": config.i18n.chartLabel,
      preserveAspectRatio: "xMidYMid meet",
    });

    // Horizontal guides and their value labels.
    [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
      var y = pad.top + plotH - fraction * plotH;
      svg.appendChild(
        svgEl("line", {
          x1: pad.left, y1: y, x2: pad.left + plotW, y2: y,
          stroke: "rgba(255,255,255,0.12)", "stroke-width": 1,
        })
      );
      var label = svgEl("text", {
        x: pad.left - 8, y: y + 4, "text-anchor": "end",
        fill: "#9aa3bd", "font-size": 11,
      });
      label.textContent = Math.round(max * fraction).toLocaleString("fa-IR");
      svg.appendChild(label);
    });

    var stepX = series.length > 1 ? plotW / (series.length - 1) : plotW;

    metricsToPlot.forEach(function (m) {
      var points = [];
      var hasData = false;

      series.forEach(function (point, index) {
        var raw = point[m.key];
        if (raw === null || raw === undefined) return;
        hasData = true;
        var value = Number(raw) || 0;
        var x = pad.left + index * stepX;
        var y = pad.top + plotH - (value / max) * plotH;
        points.push(x.toFixed(1) + "," + y.toFixed(1));
      });

      if (!hasData || points.length < 2) return;

      svg.appendChild(
        svgEl("polyline", {
          points: points.join(" "),
          fill: "none",
          stroke: m.color,
          "stroke-width": 2,
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
        })
      );
    });

    // First and last dates only — a dense axis is unreadable at this size.
    [0, series.length - 1].forEach(function (index) {
      var label = svgEl("text", {
        x: pad.left + index * stepX,
        y: height - 8,
        "text-anchor": 0 === index ? "start" : "end",
        fill: "#9aa3bd",
        "font-size": 11,
      });
      label.textContent = window.BAPJalali ? window.BAPJalali.formatISO(series[index].date, false) : series[index].date;
      svg.appendChild(label);
    });

    panel.appendChild(svg);

    var legend = document.createElement("ul");
    legend.className = "bap-legend";
    metricsToPlot.forEach(function (m) {
      var item = document.createElement("li");
      var swatch = document.createElement("span");
      swatch.className = "bap-legend-swatch";
      swatch.style.background = m.color;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(m.label));
      legend.appendChild(item);
    });
    panel.appendChild(legend);

    // The same numbers as a table, for anyone who cannot use the chart.
    panel.appendChild(buildChartTable(series, metricsToPlot));
  }

  function buildChartTable(series, metricsToPlot) {
    var details = document.createElement("details");
    details.className = "bap-chart-data";
    var summary = document.createElement("summary");
    summary.textContent = config.i18n.viewData;
    details.appendChild(summary);

    var table = document.createElement("table");
    table.className = "widefat striped";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    [config.i18n.date].concat(metricsToPlot.map(function (m) { return m.label; })).forEach(function (text) {
      var th = document.createElement("th");
      th.scope = "col";
      th.textContent = text;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    series.forEach(function (point) {
      var tr = document.createElement("tr");
      var dateCell = document.createElement("th");
      dateCell.scope = "row";
      dateCell.textContent = window.BAPJalali ? window.BAPJalali.formatISO(point.date, true) : point.date;
      tr.appendChild(dateCell);

      metricsToPlot.forEach(function (m) {
        var td = document.createElement("td");
        var value = point[m.key];
        td.textContent = value === null || value === undefined ? "—" : Number(value).toLocaleString("fa-IR");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    details.appendChild(table);

    return details;
  }

  function svgEl(name, attributes) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var key in attributes) {
      if (Object.prototype.hasOwnProperty.call(attributes, key)) {
        el.setAttribute(key, String(attributes[key]));
      }
    }
    return el;
  }

  function renderPanels(metrics) {
    var panels = document.querySelectorAll("#bap-panels [data-panel]");
    for (var i = 0; i < panels.length; i++) {
      var panel = panels[i];
      var name = panel.getAttribute("data-panel");
      var container = panel.querySelector("[data-rows]");
      if (!container) continue;

      var rows = metrics[name];
      container.textContent = "";

      if (!rows || !rows.length) {
        var empty = document.createElement("p");
        empty.className = "bap-muted";
        empty.textContent = config.i18n.noData;
        container.appendChild(empty);
        continue;
      }

      var max = 0;
      for (var r = 0; r < rows.length; r++) max = Math.max(max, Number(rows[r].value) || 0);

      for (var j = 0; j < rows.length; j++) {
        container.appendChild(buildRow(rows[j], max));
      }
    }
  }

  /**
   * Builds a row with DOM APIs rather than innerHTML — the labels are page
   * URLs and referrer hostnames, i.e. attacker-influenced strings. v1
   * interpolated them straight into innerHTML.
   */
  function buildRow(row, max) {
    var item = document.createElement("div");
    item.className = "bap-row";

    var bar = document.createElement("span");
    bar.className = "bap-row-bar";
    var pct = max > 0 ? Math.max(2, Math.round((Number(row.value) / max) * 100)) : 0;
    bar.style.width = pct + "%";

    var label = document.createElement("strong");
    label.className = "bap-row-label";
    label.textContent = row.label;
    label.title = row.label;

    var value = document.createElement("span");
    value.className = "bap-row-value";
    value.textContent = Number(row.value).toLocaleString("fa-IR");

    item.appendChild(bar);
    item.appendChild(label);
    item.appendChild(value);
    return item;
  }

  function syncLayoutPreview() {
    document.querySelectorAll("[data-layout-card]").forEach(function (input) {
      var card = document.querySelector('#bap-cards [data-metric="' + input.getAttribute("data-layout-card") + '"]');
      if (card) card.hidden = !input.checked;
    });
    document.querySelectorAll("[data-layout-panel]").forEach(function (input) {
      var panel = document.querySelector('#bap-panels [data-panel="' + input.getAttribute("data-layout-panel") + '"]');
      if (panel) panel.hidden = !input.checked;
    });
  }

  function saveLayout() {
    if (!config.layoutUrl) return;
    var cards = [];
    var panels = [];
    document.querySelectorAll("[data-layout-card]:checked").forEach(function (input) { cards.push(input.getAttribute("data-layout-card")); });
    document.querySelectorAll("[data-layout-panel]:checked").forEach(function (input) { panels.push(input.getAttribute("data-layout-panel")); });
    setStatus(config.i18n.loading, false);
    fetch(config.layoutUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-WP-Nonce": config.nonce, "Content-Type": "application/json" },
      body: JSON.stringify({ cards: cards, panels: panels }),
    }).then(function (response) {
      if (!response.ok) throw new Error("layout save failed");
      return response.json();
    }).then(function () {
      syncLayoutPreview();
      setStatus(config.i18n.layoutSaved || "Saved", false);
    }).catch(function () { setStatus(config.i18n.error, true); });
  }

  function currentQuery() {
    var range = els.range ? els.range.value : config.defaultRange;
    var params = "?range=" + encodeURIComponent(range);
    if (range === "custom") {
      if (els.from && els.from.value) params += "&from=" + encodeURIComponent(els.from.value);
      if (els.to && els.to.value) params += "&to=" + encodeURIComponent(els.to.value);
    }
    return params;
  }

  function load() {
    if (inFlight) return inFlight;
    setStatus(config.i18n.loading, false);

    inFlight = fetch(config.restUrl + currentQuery(), {
      credentials: "same-origin",
      headers: { "X-WP-Nonce": config.nonce },
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { status: response.status, body: body };
        });
      })
      .then(function (result) {
        if (result.status === 503 && result.body && result.body.error === "not_configured") {
          setStatus(config.i18n.notConfigured, true);
          return;
        }
        if (!result.body || result.body.success !== true) {
          setStatus(config.i18n.error, true);
          return;
        }
        var metrics = result.body.metrics || {};
        renderCards(metrics, result.body.comparison);
        renderPanels(metrics);
        renderChart(metrics, result.body.has_timeseries);
        setStatus(describeSource(result.body, metrics), false);
      })
      .catch(function () {
        setStatus(config.i18n.error, true);
      })
      .then(function () {
        inFlight = null;
      });

    return inFlight;
  }

  // The status line is the only place that says where the numbers came from.
  // Without it, local figures and collector figures look identical, and an
  // administrator whose collector quietly stopped answering would never know
  // they were reading a different dataset.
  function describeSource(body, metrics) {
    var parts = [new Date().toLocaleTimeString("fa-IR")];

    if (body.source === "local") {
      parts.push(body.upstream_error ? config.i18n.localFallback : config.i18n.localSource);

      if (!metrics.total_events) {
        parts.push(config.i18n.noLocalData);
      } else if (body.collecting_since && config.i18n.collectingSince) {
        var since = body.collecting_since;
        if (window.BAPJalali) since = window.BAPJalali.formatISO(since, true);
        parts.push(config.i18n.collectingSince.replace("%s", since));
      }
    }

    (metrics.notes || []).forEach(function (note) {
      parts.push(note);
    });

    return parts.join(" · ");
  }

  function syncCustomVisibility() {
    if (!els.range || !els.customRange) return;
    els.customRange.hidden = els.range.value !== "custom";
  }

  if (els.range) {
    els.range.addEventListener("change", function () {
      syncCustomVisibility();
      load();
    });
  }
  if (els.refresh) {
    els.refresh.addEventListener("click", load);
  }
  [els.from, els.to].forEach(function (input) {
    if (input) input.addEventListener("change", load);
  });

  if (els.customizeToggle && els.customizer) {
    els.customizeToggle.addEventListener("click", function () {
      var open = els.customizer.hidden;
      els.customizer.hidden = !open;
      els.customizeToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    els.customizer.addEventListener("change", syncLayoutPreview);
  }
  if (els.saveLayout) els.saveLayout.addEventListener("click", saveLayout);

  syncCustomVisibility();
  syncLayoutPreview();
  load();

  // Pause polling while the tab is hidden; nobody is reading it.
  timerId = window.setInterval(function () {
    if (document.visibilityState === "visible") load();
  }, config.refreshMs || 30000);

  window.addEventListener("beforeunload", function () {
    if (timerId) window.clearInterval(timerId);
  });
})();
