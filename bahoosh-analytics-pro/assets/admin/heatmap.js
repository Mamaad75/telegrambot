/**
 * The click-and-scroll heatmap on the dashboard.
 *
 * The page is loaded in a same-origin frame at a fixed device width and the
 * density grid is painted over it on a canvas. Two passes: blobs are drawn in
 * greyscale first, then every pixel's alpha is looked up in a colour ramp. That
 * is the only way to get a true density field — drawing coloured blobs directly
 * makes overlapping ones darken each other instead of adding up.
 */
(function () {
  "use strict";

  var CFG = window.BAP_HEATMAP || {};
  var I18N = CFG.i18n || {};

  var root = document.getElementById("bap-heatmap");
  if (!root) return;

  var pageSelect = document.getElementById("bap-heat-page");
  var deviceSelect = document.getElementById("bap-heat-device");
  var overlayToggle = document.getElementById("bap-heat-overlay");
  var stage = root.querySelector("[data-heat-stage]");
  var status = root.querySelector("[data-heat-status]");
  var note = root.querySelector("[data-heat-note]");
  var badge = root.querySelector("[data-heat-count]");
  var legend = root.querySelector("[data-heat-legend]");
  var legendMin = root.querySelector("[data-heat-legend-min]");
  var legendMax = root.querySelector("[data-heat-legend-max]");
  var legendCaption = root.querySelector("[data-heat-legend-caption]");
  var table = root.querySelector("[data-heat-table]");
  var openLink = root.querySelector("[data-heat-open]");
  var modeButtons = root.querySelectorAll("[data-heat-mode]");

  if (badge) badge.hidden = true;

  var mode = "click";
  var current = null;
  var frame = null;
  var canvas = null;
  var redrawTimer = null;

  /**
   * The thermal ramp.
   *
   * A multi-hue ramp for a magnitude is normally the wrong choice, because a
   * reader cannot tell whether green or yellow is "more". Semantic heat is the
   * documented exception, and it is the convention every heatmap tool has
   * taught people to read — so it ships with a scale legend and a table of the
   * same numbers, which is what the exception is conditional on.
   */
  var RAMP = [
    [0.0, [43, 80, 255, 0]],
    [0.2, [43, 80, 255, 120]],
    [0.4, [0, 213, 255, 190]],
    [0.6, [68, 224, 106, 215]],
    [0.8, [255, 224, 43, 235]],
    [1.0, [255, 45, 45, 245]],
  ];

  function text(el, value) {
    if (el) el.textContent = value;
  }

  function fa(n) {
    try {
      return Number(n).toLocaleString("fa-IR");
    } catch (e) {
      return String(n);
    }
  }

  /** The 256-entry lookup table the second pass reads. */
  function buildRampTable() {
    var lut = new Uint8ClampedArray(256 * 4);

    for (var i = 0; i < 256; i++) {
      var t = i / 255;
      var lo = RAMP[0];
      var hi = RAMP[RAMP.length - 1];

      for (var s = 0; s < RAMP.length - 1; s++) {
        if (t >= RAMP[s][0] && t <= RAMP[s + 1][0]) {
          lo = RAMP[s];
          hi = RAMP[s + 1];
          break;
        }
      }

      var span = hi[0] - lo[0];
      var k = span > 0 ? (t - lo[0]) / span : 0;

      for (var c = 0; c < 4; c++) {
        lut[i * 4 + c] = lo[1][c] + (hi[1][c] - lo[1][c]) * k;
      }
    }

    return lut;
  }

  var RAMP_LUT = buildRampTable();

  // ------------------------------------------------------------------ fetch

  function request(params) {
    var url = CFG.restUrl + (CFG.restUrl.indexOf("?") === -1 ? "?" : "&") + params;

    return window
      .fetch(url, {
        credentials: "same-origin",
        headers: { "X-WP-Nonce": CFG.nonce },
      })
      .then(function (res) {
        if (!res.ok) throw new Error("http " + res.status);
        return res.json();
      });
  }

  function loadPages() {
    return request("_=" + Date.now()).then(function (data) {
      var pages = data.pages || [];

      pageSelect.innerHTML = "";
      pages.forEach(function (page) {
        var option = document.createElement("option");
        option.value = page.path;
        option.textContent = page.path + "  (" + fa(page.clicks) + ")";
        pageSelect.appendChild(option);
      });

      if (!pages.length) {
        // The one message that matters here. Click coordinates were on the
        // wire from the first version and stored nowhere, so an install that
        // has been collecting for a year still starts this table from empty.
        text(status, data.enabled ? I18N.noData : I18N.disabled);
        text(note, data.enabled ? I18N.fromNow : "");
        return null;
      }

      if (data.click_capture !== "all") {
        text(note, I18N.interactiveOnly);
      }

      return load();
    });
  }

  function load() {
    var path = pageSelect.value;
    if (!path) return Promise.resolve(null);

    text(status, I18N.loading);

    return request(
      "path=" + encodeURIComponent(path) + "&device=" + encodeURIComponent(deviceSelect.value)
    ).then(function (data) {
      current = data;
      render();
      return data;
    });
  }

  // ----------------------------------------------------------------- render

  function deviceWidth() {
    var option = deviceSelect.options[deviceSelect.selectedIndex];
    return option ? parseInt(option.getAttribute("data-width"), 10) || 1280 : 1280;
  }

  function render() {
    if (!current) return;

    var clicks = current.clicks || {};
    var scroll = current.scroll || {};
    var hasClicks = (clicks.clicks || 0) > 0;
    var hasScroll = (scroll.views || 0) > 0;

    if (openLink) {
      openLink.href = current.frameUrl || "#";
      openLink.hidden = !current.frameUrl;
    }

    // A bucket like /product/{id} covers every product, so there is no one page
    // to lay the heat over. The numbers are still real; only the backdrop is
    // missing, and the screen says which.
    if (!current.frameUrl) {
      text(note, I18N.collapsedPath);
    }

    if (badge) {
      badge.textContent =
        mode === "click"
          ? I18N.clickCount.replace("%s", fa(clicks.clicks || 0))
          : I18N.viewCount.replace("%s", fa(scroll.views || 0));
      // An empty badge still draws its pill, which reads as a loading state
      // that never finishes.
      badge.hidden = false;
    }

    if (mode === "click" && !hasClicks) {
      teardown();
      text(status, I18N.noDeviceData);
      return;
    }

    if (mode === "scroll" && !hasScroll) {
      teardown();
      text(status, I18N.noScrollData);
      return;
    }

    text(status, "");
    buildStage();
    renderTable();
  }

  function teardown() {
    stage.innerHTML = "";
    stage.appendChild(status);
    frame = null;
    canvas = null;
    if (legend) legend.hidden = true;
    if (table) table.hidden = true;
  }

  /**
   * Builds the frame and the overlay.
   *
   * The frame is laid out at the device's own width and then scaled down to fit
   * the admin column, rather than being squeezed into it: squeezing would
   * re-flow the page to a width no visitor used, and every recorded coordinate
   * would land somewhere else.
   */
  function buildStage() {
    var width = deviceWidth();
    var showPage = !overlayToggle || overlayToggle.checked;

    stage.innerHTML = "";

    var available = stage.clientWidth || 900;
    var scale = Math.min(1, available / width);

    var shell = document.createElement("div");
    shell.className = "bap-heatmap__shell";
    shell.style.width = Math.round(width * scale) + "px";

    var inner = document.createElement("div");
    inner.className = "bap-heatmap__inner";
    inner.style.width = width + "px";
    inner.style.transform = "scale(" + scale + ")";

    canvas = document.createElement("canvas");
    canvas.className = "bap-heatmap__canvas";

    if (showPage && current.frameUrl) {
      frame = document.createElement("iframe");
      frame.className = "bap-heatmap__frame";
      frame.setAttribute("title", I18N.frameTitle || "");
      frame.setAttribute("scrolling", "no");
      frame.setAttribute("loading", "lazy");
      frame.width = width;
      frame.height = 1200;
      frame.src = current.frameUrl;
      frame.addEventListener("load", onFrameLoad);
      inner.appendChild(frame);
    } else {
      frame = null;
    }

    var labels = document.createElement("div");
    labels.className = "bap-heatmap__labels";

    inner.appendChild(canvas);
    inner.appendChild(labels);
    shell.appendChild(inner);
    stage.appendChild(shell);
    stage.appendChild(status);

    // With no frame there is no page to measure against, so the canvas is sized
    // to the data: the deepest band that holds a click.
    if (!frame) {
      paint(width, dataHeight(), scale, shell, inner);
    }
  }

  /** The document height implied by the grid, for the no-frame case. */
  function dataHeight() {
    var clicks = current.clicks || {};
    var band = clicks.band || 40;
    var deepest = 0;

    (clicks.cells || []).forEach(function (cell) {
      deepest = Math.max(deepest, cell.y);
    });

    return Math.max(1200, (deepest + 2) * band);
  }

  function onFrameLoad() {
    var height = 0;

    // Same origin, so the frame's own document is readable. A security plugin
    // that sends X-Frame-Options: DENY on the front end makes it unreadable;
    // that is a configuration this plugin cannot override, so it says so and
    // draws the heatmap on its own backdrop instead of silently misaligning it.
    try {
      var doc = frame.contentDocument;
      height = Math.max(
        doc.body ? doc.body.scrollHeight : 0,
        doc.documentElement ? doc.documentElement.scrollHeight : 0
      );
    } catch (e) {
      height = 0;
    }

    var shell = stage.querySelector(".bap-heatmap__shell");
    var inner = stage.querySelector(".bap-heatmap__inner");
    var width = deviceWidth();
    var scale = Math.min(1, (stage.clientWidth || 900) / width);

    if (!height) {
      text(note, I18N.frameBlocked);
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
      paint(width, dataHeight(), scale, shell, inner);
      return;
    }

    frame.height = height;
    paint(width, height, scale, shell, inner);
  }

  function paint(width, height, scale, shell, inner) {
    if (!canvas) return;

    inner.style.height = height + "px";
    shell.style.height = Math.round(height * scale) + "px";

    canvas.width = width;
    canvas.height = height;

    if (mode === "click") paintClicks(width, height);
    else paintScroll(width, height);
  }

  /** Greyscale density first, then the ramp. */
  function paintClicks(width, height) {
    var ctx = canvas.getContext("2d");
    var clicks = current.clicks || {};
    var cells = clicks.cells || [];
    var cols = clicks.cols || 40;
    var band = clicks.band || 40;
    var peak = clicks.peak || 1;

    ctx.clearRect(0, 0, width, height);

    var colWidth = width / cols;
    // A blob about one and a half columns across: wide enough that neighbours
    // merge into a field, narrow enough that two separate buttons stay separate.
    var radius = Math.max(14, Math.round(colWidth * 1.5));

    cells.forEach(function (cell) {
      var cx = (cell.x + 0.5) * colWidth;
      var cy = (cell.y + 0.5) * band;

      if (cy > height + radius) return;

      // The square root keeps a single runaway hotspot from flattening
      // everything else to invisible — with raw proportions, a nav link clicked
      // 400 times erases a button clicked 30 times, which is still a button
      // worth seeing.
      var weight = Math.pow(cell.n / peak, 0.5);

      var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, "rgba(0,0,0," + weight.toFixed(3) + ")");
      gradient.addColorStop(1, "rgba(0,0,0,0)");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    colorise(ctx, width, height);

    clearLabels();

    if (legend) {
      legend.hidden = false;
      text(legendMin, fa(0));
      text(legendMax, fa(peak));
      text(legendCaption, I18N.legendClick);
    }
  }

  /** Maps accumulated alpha through the ramp. */
  function colorise(ctx, width, height) {
    if (width < 1 || height < 1) return;

    var image = ctx.getImageData(0, 0, width, height);
    var px = image.data;

    for (var i = 0; i < px.length; i += 4) {
      var alpha = px[i + 3];
      if (!alpha) continue;

      var at = alpha * 4;
      px[i] = RAMP_LUT[at];
      px[i + 1] = RAMP_LUT[at + 1];
      px[i + 2] = RAMP_LUT[at + 2];
      px[i + 3] = RAMP_LUT[at + 3];
    }

    ctx.putImageData(image, 0, 0);
  }

  /**
   * Scroll depth as four bands down the page.
   *
   * The tracker reports a milestone when the *bottom of the viewport* passes it,
   * so "reached 50" means the visitor saw everything down to the halfway mark.
   * Each band is therefore shaded by the share who reached its lower edge.
   *
   * The canvas paints colour only. The labels are HTML placed over it, because
   * canvas `fillText` has no bidi algorithm: a Persian label with a number in it
   * came out with the number on the wrong side of the words.
   */
  function paintScroll(width, height) {
    var ctx = canvas.getContext("2d");
    var reach = (current.scroll || {}).reach || [];

    ctx.clearRect(0, 0, width, height);
    clearLabels();

    var previous = 0;
    reach.forEach(function (step) {
      var top = (previous / 100) * height;
      var bottom = (step.depth / 100) * height;
      previous = step.depth;

      var share = step.percent === null ? 0 : step.percent / 100;
      var at = Math.round(Math.max(0, Math.min(1, share)) * 255) * 4;

      ctx.fillStyle =
        "rgba(" + RAMP_LUT[at] + "," + RAMP_LUT[at + 1] + "," + RAMP_LUT[at + 2] + ",0.52)";
      ctx.fillRect(0, top, width, bottom - top);

      ctx.fillStyle = "rgba(10,13,24,0.82)";
      ctx.fillRect(0, bottom - 1, width, 2);

      addLabel(
        bottom,
        step.percent === null
          ? I18N.depth.replace("%s", fa(step.depth) + "٪")
          : I18N.reached
              .replace("%1$s", fa(step.percent) + "٪")
              .replace("%2$s", fa(step.depth) + "٪")
      );
    });

    if (legend) {
      legend.hidden = false;
      text(legendMin, fa(0) + "٪");
      text(legendMax, fa(100) + "٪");
      text(legendCaption, I18N.legendScroll);
    }
  }

  function clearLabels() {
    var layer = stage.querySelector(".bap-heatmap__labels");
    if (layer) layer.innerHTML = "";
  }

  /** One boundary marker, as HTML so the text is laid out by the browser. */
  function addLabel(y, label) {
    var layer = stage.querySelector(".bap-heatmap__labels");
    if (!layer) return;

    var mark = document.createElement("span");
    mark.className = "bap-heatmap__depth";
    mark.style.top = Math.max(0, y - 30) + "px";
    mark.textContent = label;
    layer.appendChild(mark);
  }

  /**
   * The same numbers as a table.
   *
   * Required rather than decorative: a colour ramp is the only encoding on the
   * canvas, so the numbers have to be readable somewhere that does not depend
   * on telling yellow from green.
   */
  function renderTable() {
    if (!table) return;

    var body = table.querySelector("tbody");
    body.innerHTML = "";

    var rows = [];

    if (mode === "click") {
      var clicks = current.clicks || {};
      var band = clicks.band || 40;
      var total = clicks.clicks || 0;
      var byBand = {};

      (clicks.cells || []).forEach(function (cell) {
        // Bands are 40px; a table row per band would be hundreds of rows for
        // one page. Grouped into screenfuls, which is the unit someone reading
        // a heatmap actually thinks in.
        var screenful = Math.floor((cell.y * band) / 600);
        byBand[screenful] = (byBand[screenful] || 0) + cell.n;
      });

      Object.keys(byBand)
        .sort(function (a, b) {
          return byBand[b] - byBand[a];
        })
        .slice(0, 12)
        .forEach(function (key) {
          var n = byBand[key];
          rows.push([
            I18N.screenful.replace("%s", fa(Number(key) + 1)),
            fa(n),
            total > 0 ? fa(Math.round((n / total) * 100)) + "٪" : "—",
          ]);
        });
    } else {
      var scroll = current.scroll || {};
      (scroll.reach || []).forEach(function (step) {
        rows.push([
          I18N.depth.replace("%s", fa(step.depth) + "٪"),
          fa(step.visitors),
          step.percent === null ? "—" : fa(step.percent) + "٪",
        ]);
      });
    }

    rows.forEach(function (cells) {
      var tr = document.createElement("tr");
      cells.forEach(function (value) {
        var td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    table.hidden = !rows.length;
  }

  // ------------------------------------------------------------------ wiring

  function fail(error) {
    teardown();
    text(status, I18N.error);
    if (window.console && window.console.warn) window.console.warn("bahoosh heatmap", error);
  }

  pageSelect.addEventListener("change", function () {
    load().catch(fail);
  });

  deviceSelect.addEventListener("change", function () {
    load().catch(fail);
  });

  if (overlayToggle) {
    overlayToggle.addEventListener("change", render);
  }

  Array.prototype.forEach.call(modeButtons, function (button) {
    button.addEventListener("click", function () {
      mode = button.getAttribute("data-heat-mode");
      Array.prototype.forEach.call(modeButtons, function (other) {
        other.classList.toggle("is-active", other === button);
      });
      render();
    });
  });

  // The stage width decides the scale, so a resized window needs a redraw.
  window.addEventListener("resize", function () {
    if (redrawTimer) window.clearTimeout(redrawTimer);
    redrawTimer = window.setTimeout(render, 250);
  });

  loadPages().catch(fail);
})();
