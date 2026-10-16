/**
 * The light/dark control.
 *
 * Three things happen on a click, in this order, and the order is the point:
 *
 *   1. the attribute on <html> changes, so the panel repaints immediately;
 *   2. the choice goes into localStorage, so the *next* page load is already
 *      right even if the user navigates before the request finishes;
 *   3. the preference is saved to user meta, so it follows them to another
 *      browser.
 *
 * Doing (3) first and waiting for it would make the control feel broken on a
 * slow connection, and doing only (3) would make the choice vanish on the next
 * page until the response landed. The inline boot script in the document head
 * reads the same localStorage key, which is what closes that gap.
 */
(function () {
  "use strict";

  var cfg = window.bapTheme || {};
  var root = document.documentElement;

  function resolve(choice) {
    if (choice !== "auto") return choice;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function apply(choice) {
    root.setAttribute("data-bap-theme", resolve(choice));
    root.setAttribute("data-bap-theme-choice", choice);

    try {
      window.localStorage.setItem("bapAdminTheme", choice);
    } catch (e) {
      /* Private browsing. The server-side preference still works. */
    }
  }

  function save(choice) {
    if (!cfg.ajaxUrl || !cfg.nonce) return;

    var body = new URLSearchParams();
    body.set("action", "bap_set_theme");
    body.set("theme", choice);
    body.set("nonce", cfg.nonce);

    window
      .fetch(cfg.ajaxUrl, { method: "POST", credentials: "same-origin", body: body })
      .catch(function () {
        /* The visible change already happened; a failed save is not worth a
           dialog over an appearance setting. */
      });
  }

  function mount(group) {
    var options = group.querySelectorAll("[data-bap-theme-value]");

    Array.prototype.forEach.call(options, function (button) {
      button.addEventListener("click", function () {
        var choice = button.getAttribute("data-bap-theme-value");

        Array.prototype.forEach.call(options, function (other) {
          var on = other === button;
          other.classList.toggle("is-active", on);
          other.setAttribute("aria-pressed", on ? "true" : "false");
        });

        apply(choice);
        save(choice);
      });
    });
  }

  function ready() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-bap-theme-toggle]"), mount);

    // While the preference is "auto", the operating system is in charge, so a
    // change to it has to be followed without a reload.
    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: light)");
      var onChange = function () {
        if (root.getAttribute("data-bap-theme-choice") === "auto") {
          root.setAttribute("data-bap-theme", resolve("auto"));
        }
      };

      if (query.addEventListener) {
        query.addEventListener("change", onChange);
      } else if (query.addListener) {
        query.addListener(onChange);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
