/** Bahoosh Analytics Pro v4 — settings interactions. */
(function () {
  "use strict";

  var config = window.bapSettingsPage;
  var field = document.getElementById("bap-ai-provider-model");
  if (!config || !field) return;

  var i18n = config.i18n || {};
  var row = field.parentNode;

  var button = document.createElement("button");
  button.type = "button";
  button.className = "button";
  button.textContent = i18n.test || "Test";

  var output = document.createElement("p");
  output.className = "description";
  output.setAttribute("aria-live", "polite");

  row.appendChild(button);
  row.appendChild(output);

  // The test asks the server what it currently has stored, not what is typed
  // in the form. Testing an unsaved value would report a connection the site
  // does not actually have — which is worse than not testing at all.
  button.addEventListener("click", function () {
    button.disabled = true;
    output.textContent = i18n.testing || "Testing…";

    fetch(config.testUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-WP-Nonce": config.nonce }
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (body) {
        var parts = [];

        if (body && body.success) {
          parts.push(i18n.ok || "Connected.");
          if (body.note) parts.push(body.note);
          if (body.models && body.models.length) {
            parts.push((i18n.models || "Models:") + " " + body.models.slice(0, 12).join("، "));
          }
        } else {
          parts.push(i18n.failed || "Failed.");
          if (body && body.error) parts.push(body.error);
        }

        output.textContent = parts.join(" ");
      })
      .catch(function (error) {
        output.textContent = (i18n.failed || "Failed.") + " " + error.message;
      })
      .then(function () {
        button.disabled = false;
      });
  });
})();
