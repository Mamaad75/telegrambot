/** Bahoosh Analytics Pro — the UX fix list. */
(function () {
  "use strict";

  var cfg = window.BAP_TASKS;
  if (!cfg) return;

  var i18n = cfg.i18n || {};
  var statusEl = document.getElementById("bap-tasks-status");
  var listEl = document.getElementById("bap-tasks-list");
  var countsEl = document.getElementById("bap-tasks-counts");
  var showDone = document.getElementById("bap-tasks-show-done");

  var current = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function num(value) {
    return Number(value || 0).toLocaleString("fa-IR");
  }

  function status(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function renderCounts(counts) {
    if (!countsEl) return;
    countsEl.textContent = "";

    [
      ["open", i18n.open, "dashicons-warning"],
      ["done", i18n.done, "dashicons-yes-alt"],
      ["dismissed", i18n.dismissed, "dashicons-minus"],
    ].forEach(function (pair) {
      var card = el("div", "bap-kpi-card");
      card.appendChild(el("div", "bap-kpi-card__label", pair[1]));
      card.appendChild(el("div", "bap-kpi-card__value", num(counts[pair[0]] || 0)));

      var icon = el("span", "bap-kpi-card__icon");
      icon.appendChild(el("span", "dashicons " + pair[2]));
      card.appendChild(icon);

      countsEl.appendChild(card);
    });
  }

  function decide(id, next, row) {
    row.classList.add("is-busy");

    fetch(cfg.restUrl + "/" + encodeURIComponent(id), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-WP-Nonce": cfg.nonce },
      body: JSON.stringify({ status: next }),
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (body) {
        if (!body || body.success !== true) {
          status(i18n.error, true);
          row.classList.remove("is-busy");
          return;
        }
        load();
      })
      .catch(function () {
        status(i18n.error, true);
        row.classList.remove("is-busy");
      });
  }

  function renderTask(task) {
    var row = el("article", "bap-task is-" + task.severity + (task.status !== "open" ? " is-settled" : ""));

    var head = el("div", "bap-task__head");
    head.appendChild(el("span", "bap-severity is-" + task.severity, i18n[task.severity] || task.severity));
    head.appendChild(el("h3", "", task.title));
    row.appendChild(head);

    row.appendChild(el("p", "bap-task__what", task.what));

    var meta = el("div", "bap-task__meta");
    meta.appendChild(el("span", "bap-task__evidence", task.evidence));

    var page = task.page || {};

    // The page, named as the administrator knows it rather than as a path —
    // and labelled with the editor that actually owns its layout, so nobody is
    // sent to the block editor for an Elementor page.
    if (page.title) {
      meta.appendChild(el("span", "bap-muted", page.title + " · " + page.builder_label));
    } else {
      meta.appendChild(el("code", "", task.page_path));
    }
    row.appendChild(meta);

    var actions = el("div", "bap-task__actions");

    if (page.edit_url) {
      var edit = el("a", "button button-primary bap-primary", i18n.edit);
      edit.href = page.edit_url;
      edit.target = "_blank";
      edit.rel = "noopener";
      actions.appendChild(edit);
    }

    if (page.view_url) {
      var view = el("a", "button", i18n.view);
      view.href = page.view_url;
      view.target = "_blank";
      view.rel = "noopener";
      actions.appendChild(view);
    }

    // No edit link means the path could not be matched to a page — a collapsed
    // product id, or a route the theme handles. Saying so beats an inert button.
    if (!page.edit_url && page.post_id === 0) {
      actions.appendChild(el("span", "bap-muted", i18n.noPage));
    }

    if (task.status === "open") {
      var done = el("button", "button", i18n.markDone);
      done.type = "button";
      done.addEventListener("click", function () {
        decide(task.id, "done", row);
      });
      actions.appendChild(done);

      var skip = el("button", "button bap-task__skip", i18n.dismiss);
      skip.type = "button";
      skip.addEventListener("click", function () {
        decide(task.id, "dismissed", row);
      });
      actions.appendChild(skip);
    } else {
      actions.appendChild(el("span", "bap-badge is-active", task.status === "done" ? i18n.isDone : i18n.isDismissed));

      var reopen = el("button", "button", i18n.reopen);
      reopen.type = "button";
      reopen.addEventListener("click", function () {
        decide(task.id, "open", row);
      });
      actions.appendChild(reopen);
    }

    row.appendChild(actions);

    return row;
  }

  function render(tasks, notes) {
    if (!listEl) return;
    listEl.textContent = "";

    var visible = tasks.filter(function (task) {
      return showDone && showDone.checked ? true : task.status === "open";
    });

    (notes || []).forEach(function (note) {
      listEl.appendChild(el("p", "bap-muted", note));
    });

    if (!visible.length) {
      listEl.appendChild(el("div", "bap-empty-state", tasks.length ? i18n.allDone : i18n.empty));
      return;
    }

    visible.forEach(function (task) {
      listEl.appendChild(renderTask(task));
    });
  }

  function load() {
    var range = (document.getElementById("bap-tasks-range") || {}).value || "last_30_days";
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

        current = body.tasks || [];
        renderCounts(body.counts || {});
        render(current, body.notes);
        status(new Date().toLocaleTimeString("fa-IR"), false);
      })
      .catch(function () {
        status(i18n.error, true);
      });
  }

  var refresh = document.getElementById("bap-tasks-refresh");
  var rangeEl = document.getElementById("bap-tasks-range");
  if (refresh) refresh.addEventListener("click", load);
  if (rangeEl) rangeEl.addEventListener("change", load);
  if (showDone) {
    showDone.addEventListener("change", function () {
      render(current, []);
    });
  }

  load();
})();
