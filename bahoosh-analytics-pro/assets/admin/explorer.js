/** Bahoosh Analytics Pro — the events-and-pages explorer. */
(function () {
  "use strict";

  var cfg = window.BAP_EXPLORER;
  if (!cfg) return;

  var i18n = cfg.i18n || {};
  var statusEl = document.getElementById("bap-explorer-status");

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function num(value) {
    return Number(value || 0).toLocaleString("fa-IR");
  }

  function when(stamp) {
    if (!stamp) return "";
    // Stored as UTC without a zone marker; say so explicitly or the browser
    // reads it as local time and every timestamp is off by the site's offset.
    var date = new Date(String(stamp).replace(" ", "T") + "Z");
    if (isNaN(date.getTime())) return String(stamp);
    return date.toLocaleString("fa-IR");
  }

  function status(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  /** A table built from rows of {label, values[]}. */
  function table(target, rows, empty) {
    var box = document.getElementById(target);
    if (!box) return;
    box.textContent = "";

    if (!rows.length) {
      box.appendChild(el("div", "bap-empty-state", empty || i18n.empty));
      return;
    }

    rows.forEach(function (row) {
      var line = el("div", "bap-explorer-row");
      var main = el("div", "bap-explorer-row__main");
      main.appendChild(el("strong", "", row.label));
      if (row.sub) main.appendChild(el("span", "bap-muted", row.sub));
      line.appendChild(main);

      var stats = el("div", "bap-explorer-row__stats");
      (row.values || []).forEach(function (pair) {
        var stat = el("span", "bap-explorer-stat");
        stat.appendChild(el("b", "", pair[0]));
        stat.appendChild(el("i", "", pair[1]));
        stats.appendChild(stat);
      });
      line.appendChild(stats);

      box.appendChild(line);
    });
  }

  function renderPages(pages) {
    table(
      "bap-explorer-pages",
      pages.map(function (page) {
        // The per-page event mix is the useful part: a product page with views
        // and no add-to-cart is a different problem from one with neither.
        var mix = Object.keys(page.by_type || {})
          .slice(0, 4)
          .map(function (type) {
            return typeLabel(type) + " " + num(page.by_type[type]);
          })
          .join(" · ");

        var values = [
          [num(page.views), i18n.views],
          [num(page.visitors), i18n.visitors],
          [num(page.events), i18n.events],
        ];

        if (page.revenue > 0) values.push([num(page.revenue), i18n.revenue]);

        return { label: page.page_path, sub: mix, values: values };
      })
    );
  }

  var typeLabels = {};

  function typeLabel(type) {
    return typeLabels[type] || type;
  }

  function renderTypes(types) {
    types.forEach(function (row) {
      typeLabels[row.event_type] = row.label;
    });

    table(
      "bap-explorer-types",
      types.map(function (row) {
        return {
          label: row.label,
          sub: row.event_type,
          values: [
            [num(row.count), i18n.events],
            [num(row.visitors), i18n.visitors],
          ],
        };
      })
    );
  }

  function renderSearches(searches, notes) {
    table(
      "bap-explorer-searches",
      searches.map(function (row) {
        return {
          label: row.term,
          values: [
            [num(row.count), i18n.times],
            [num(row.visitors), i18n.visitors],
          ],
        };
      }),
      (notes || [])[0]
    );
  }

  function renderPaths(paths) {
    table(
      "bap-explorer-paths",
      paths.map(function (row) {
        return { label: row.path, values: [[num(row.visitors), i18n.visitors]] };
      })
    );
  }

  function renderFeed(feed) {
    var box = document.getElementById("bap-explorer-feed");
    if (!box) return;
    box.textContent = "";

    if (!feed.length) {
      box.appendChild(el("div", "bap-empty-state", i18n.noEvents));
      return;
    }

    feed.forEach(function (row) {
      var line = el("div", "bap-feed-row");
      line.appendChild(el("span", "bap-pill", typeLabel(row.event_type)));
      line.appendChild(el("code", "", row.page_path));
      if (row.label) line.appendChild(el("span", "bap-feed-label", row.label));
      if (row.value > 0) line.appendChild(el("b", "", num(row.value)));
      line.appendChild(el("span", "bap-muted", when(row.at)));
      box.appendChild(line);
    });
  }

  function load() {
    var range = (document.getElementById("bap-explorer-range") || {}).value || "last_7_days";
    status(i18n.loading, false);

    fetch(cfg.restUrl + "?range=" + encodeURIComponent(range), {
      credentials: "same-origin",
      headers: { "X-WP-Nonce": cfg.nonce },
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (body) {
        if (!body || body.success !== true) {
          status(i18n.error, true);
          return;
        }

        renderTypes(body.types || []);
        renderPages(body.pages || []);
        renderSearches(body.searches || [], body.notes);
        renderPaths(body.paths || []);
        renderFeed(body.feed || []);

        var parts = [];
        if (body.stored_events) {
          parts.push((i18n.stored || "%s").replace("%s", num(body.stored_events)));
        }
        if (body.collecting_since) {
          var since = body.collecting_since;
          if (window.BAPJalali) since = window.BAPJalali.formatISO(since, true);
          parts.push((i18n.since || "%s").replace("%s", since));
        }
        if (body.truncated) parts.push(i18n.truncated);
        if (!body.stored_events) parts.push(i18n.noEvents);

        status(parts.join(" · "), Boolean(body.truncated));
      })
      .catch(function () {
        status(i18n.error, true);
      });
  }

  var refresh = document.getElementById("bap-explorer-refresh");
  var range = document.getElementById("bap-explorer-range");
  if (refresh) refresh.addEventListener("click", load);
  if (range) range.addEventListener("change", load);

  load();
})();
