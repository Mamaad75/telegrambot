/** Bahoosh Analytics Pro — the search rescue screen. */
(function () {
  "use strict";

  var cfg = window.BAP_RESCUE;
  if (!cfg) return;

  var i18n = cfg.i18n || {};
  var statusEl = document.getElementById("bap-rescue-status");
  var listEl = document.getElementById("bap-rescue-list");
  var countsEl = document.getElementById("bap-rescue-counts");

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

  function renderCounts(counts, catalogue) {
    if (!countsEl) return;
    countsEl.textContent = "";

    [
      [counts.lost_searches, i18n.lostSearches, "dashicons-search"],
      [counts.synonyms, i18n.synonyms, "dashicons-editor-spellcheck"],
      [counts.missing, i18n.missing, "dashicons-cart"],
      [catalogue, i18n.catalogue, "dashicons-products"],
    ].forEach(function (row) {
      var card = el("div", "bap-kpi-card");
      card.appendChild(el("div", "bap-kpi-card__label", row[1]));
      card.appendChild(el("div", "bap-kpi-card__value", num(row[0])));

      var icon = el("span", "bap-kpi-card__icon");
      icon.appendChild(el("span", "dashicons " + row[2]));
      card.appendChild(icon);

      countsEl.appendChild(card);
    });
  }

  function renderTerm(term) {
    var isSynonym = term.verdict === "synonym";
    var row = el("article", "bap-rescue-row is-" + term.verdict);

    var head = el("div", "bap-rescue-row__head");
    head.appendChild(el("span", "bap-severity is-" + (isSynonym ? "high" : "medium"), isSynonym ? i18n.verdictSynonym : i18n.verdictMissing));
    head.appendChild(el("h3", "", "«" + term.term + "»"));
    row.appendChild(head);

    var meta = el("div", "bap-rescue-row__meta");
    meta.appendChild(el("span", "", i18n.searchedTimes.replace("%s", num(term.searches))));
    meta.appendChild(el("span", "bap-muted", i18n.visitors.replace("%s", num(term.visitors))));
    row.appendChild(meta);

    if (isSynonym) {
      var hit = el("div", "bap-rescue-row__match");
      hit.appendChild(el("span", "bap-muted", i18n.probablyMeant));
      hit.appendChild(el("strong", "", term.product));
      hit.appendChild(el("span", "bap-badge is-active", i18n.confidence.replace("%s", num(term.confidence))));
      row.appendChild(hit);

      if (term.reason) row.appendChild(el("p", "bap-rescue-row__reason", term.reason));

      var advice = el("p", "bap-rescue-row__advice");
      advice.textContent = i18n.adviceSynonym.replace("%s", term.term);
      row.appendChild(advice);
    } else {
      row.appendChild(el("p", "bap-rescue-row__advice", i18n.adviceMissing));
    }

    var actions = el("div", "bap-rescue-row__actions");

    if (term.edit_url) {
      var edit = el("a", "button", i18n.editProduct);
      edit.href = term.edit_url;
      edit.target = "_blank";
      edit.rel = "noopener";
      actions.appendChild(edit);
    }

    if (term.view_url) {
      var view = el("a", "button", i18n.viewProduct);
      view.href = term.view_url;
      view.target = "_blank";
      view.rel = "noopener";
      actions.appendChild(view);
    }

    if (actions.childNodes.length) row.appendChild(actions);

    return row;
  }

  function render(body) {
    if (!listEl) return;
    listEl.textContent = "";

    (body.notes || []).forEach(function (note) {
      listEl.appendChild(el("p", "bap-muted", note));
    });

    // The provider that actually answered, stated rather than assumed: the
    // deterministic matcher and a model produce different quality of match.
    if (body.provider) {
      var by = el("p", "bap-rescue-provider");
      by.textContent = (body.provider === "local" ? i18n.byLocal : i18n.byModel.replace("%s", body.provider));
      listEl.appendChild(by);
    }

    if (body.error) listEl.appendChild(el("p", "bap-rescue-error", body.error));

    var terms = body.terms || [];

    if (!terms.length) {
      listEl.appendChild(el("div", "bap-empty-state", i18n.empty));
      return;
    }

    terms.forEach(function (term) {
      listEl.appendChild(renderTerm(term));
    });
  }

  function load(fresh) {
    var range = (document.getElementById("bap-rescue-range") || {}).value || "last_30_days";
    status(fresh ? i18n.asking : i18n.loading, false);

    fetch(cfg.restUrl + "?range=" + encodeURIComponent(range) + (fresh ? "&fresh=1" : ""), {
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
        renderCounts(body.counts || {}, body.catalogue || 0);
        render(body);
        status(new Date().toLocaleTimeString("fa-IR"), false);
      })
      .catch(function () {
        status(i18n.error, true);
      });
  }

  var reload = document.getElementById("bap-rescue-reload");
  var freshBtn = document.getElementById("bap-rescue-fresh");
  var rangeEl = document.getElementById("bap-rescue-range");

  if (reload) reload.addEventListener("click", function () { load(false); });
  if (freshBtn) freshBtn.addEventListener("click", function () { load(true); });
  if (rangeEl) rangeEl.addEventListener("change", function () { load(false); });

  load(false);
})();
