/* Controller: catalogue, form, engine and interface wiring. */
(function (global) {
  const MathBot = global.MathBot;
  const ui = MathBot.ui;
  const $ = ui.$;

  let currentMode = MathBot.MODES[0];
  let lastPayload = null;
  let lastData = null;
  let busy = false;

  function setFieldValue(field, value) {
    if (value === undefined || value === null) return;
    const element = $("f-" + field.key);
    if (element) element.value = value;
  }

  function setMode(id) {
    const mode = MathBot.modeById(id);
    currentMode = mode;
    document.querySelectorAll(".tool-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode.id);
    });
    $("modeLabel").textContent = mode.group;
    $("inputLabel").textContent = mode.inputLabel;
    $("fieldHint").textContent = mode.hint;
    $("expression").placeholder = mode.placeholder;
    $("expression").rows = mode.rows || 2;
    $("variableShell").hidden = mode.variable === false;
    $("keypad").hidden = !mode.calculator;
    ui.renderExtraFields($("extraFields"), mode);
    ui.renderExamples($("examples"), mode, (value) => {
      $("expression").value = value;
      $("expression").focus();
    });
    ui.clearMessages();
  }

  function collectPayload() {
    const payload = {
      mode: currentMode.id,
      expression: $("expression").value.trim(),
      variable: $("variable").value,
    };
    (currentMode.fields || []).forEach((field) => {
      const element = $("f-" + field.key);
      if (!element) return;
      const raw = element.value;
      if (field.type === "number") {
        const minimum = field.min !== undefined ? field.min : 0;
        const maximum = field.max !== undefined ? field.max : 100;
        const parsed = Number(raw);
        payload[field.target] = Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : field.default;
      } else {
        payload[field.target] = raw;
      }
    });
    if (currentMode.id === "graph") {
      const xmin = Number($("graphXmin").value);
      const xmax = Number($("graphXmax").value);
      payload.xmin = Number.isFinite(xmin) ? xmin : -10;
      payload.xmax = Number.isFinite(xmax) ? xmax : 10;
      payload.samples = 260;
    }
    if (currentMode.id === "word") {
      payload.word_problem = payload.expression;
      payload.expression = "";
    }
    return payload;
  }

  async function solve() {
    if (busy) return;
    const payload = collectPayload();
    if (!payload.expression && !payload.word_problem && currentMode.id !== "matrix") {
      ui.showError("Enter an expression first — or choose one of the examples below the input.");
      $("expression").focus();
      return;
    }
    const button = $("solveBtn");
    busy = true;
    button.disabled = true;
    button.classList.add("is-loading");
    ui.clearMessages();
    try {
      const data = await MathBot.api.solve(payload);
      if (!data.ok) { ui.showError(data.error || "That input could not be calculated."); return; }
      lastPayload = payload;
      lastData = data;
      ui.showResult(data, currentMode);
      if (data.series) {
        MathBot.graph.draw($("graphCanvas"), data, $("graphTooltip"));
        MathBot.graph.legend($("graphLegend"), data.series);
      }
      $("resultCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      ui.showError(err.message || "Something went wrong.");
    } finally {
      busy = false;
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  function reset() {
    if (busy) return;
    $("expression").value = "";
    ui.renderExtraFields($("extraFields"), currentMode);
    ui.clearMessages();
    lastPayload = null;
    lastData = null;
    $("expression").focus();
  }

  async function copyAnswer() {
    const text = $("resultText").textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      ui.toast("Answer copied");
    } catch (err) {
      const helper = document.createElement("textarea");
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      try { document.execCommand("copy"); ui.toast("Answer copied"); }
      catch (inner) { ui.toast("Select the answer and copy it manually"); }
      helper.remove();
    }
  }

  function saveResult() {
    if (!lastData) { ui.toast("Calculate something first"); return; }
    MathBot.history.add({
      mode: currentMode.name,
      modeId: currentMode.id,
      expression: lastPayload.expression || lastPayload.word_problem || "—",
      result: ui.formatResult(lastData.result),
      payload: lastPayload,
    });
    ui.toast("Saved to history");
    if (!$("historyDrawer").hidden) refreshHistory();
  }

  function refreshHistory() {
    ui.renderHistory($("historyList"), $("historySearch").value.trim(), (item) => {
      if (item.modeId) setMode(item.modeId);
      $("expression").value = item.expression === "—" ? "" : item.expression;
      if (item.payload) (currentMode.fields || []).forEach((field) => setFieldValue(field, item.payload[field.target]));
      ui.renderExamples($("examples"), currentMode, (value) => { $("expression").value = value; $("expression").focus(); });
      closeHistory();
      solve();
    });
  }

  function openHistory() {
    $("historyDrawer").hidden = false;
    $("drawerScrim").hidden = false;
    requestAnimationFrame(() => $("historyDrawer").classList.add("open"));
    refreshHistory();
  }
  function closeHistory() {
    $("historyDrawer").classList.remove("open");
    $("drawerScrim").hidden = true;
    global.setTimeout(() => { if (!$("historyDrawer").classList.contains("open")) $("historyDrawer").hidden = true; }, 260);
  }

  function redrawGraph() {
    if (!lastData || !lastData.series) return;
    const xmin = Number($("graphXmin").value);
    const xmax = Number($("graphXmax").value);
    if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmax <= xmin) return;
    MathBot.graph.draw($("graphCanvas"), Object.assign({}, lastData, { xmin: xmin, xmax: xmax }), $("graphTooltip"));
  }

  function keypadInsert(value, isOperator) {
    const field = $("expression");
    let current = field.value;
    if (isOperator && /[+\-*/^]\s*$/.test(current)) current = current.replace(/[+\-*/^]\s*$/, "");
    field.value = current + value;
    field.focus();
  }

  function keypadClear() {
    $("expression").value = "";
    ui.clearMessages();
    $("expression").focus();
  }

  function keypadBackspace() {
    const field = $("expression");
    field.value = field.value.slice(0, -1);
    field.focus();
  }

  function keypadSign() {
    const field = $("expression");
    let value = field.value;
    if (!value.trim() || /[+\-*/^(]\s*$/.test(value)) {
      value += "-";
    } else {
      const match = value.match(/(-?\d+(?:\.\d+)?)([^\d.]*)$/);
      if (match) {
        const token = match[1];
        const flipped = token.charAt(0) === "-" ? token.slice(1) : "-" + token;
        value = value.slice(0, match.index) + flipped + value.slice(match.index + token.length);
      } else {
        value += "*-1";
      }
    }
    field.value = value;
    field.focus();
  }

  function bindEvents() {
    ui.renderToolList($("toolList"), MathBot.MODES, setMode);
    ui.renderKeypad($("keypad"), {
      onInsert: keypadInsert,
      onClear: keypadClear,
      onBackspace: keypadBackspace,
      onSign: keypadSign,
      onEquals: solve,
    });
    ui.renderCapabilities($("capabilityGrid"), MathBot.MODES);
    ui.renderTicker($("tickerTrack"), MathBot.MODES);
    ui.renderPaletteMenu($("paletteMenu"), () => {
      $("paletteMenu").hidden = true;
      $("paletteToggle").setAttribute("aria-expanded", "false");
      global.setTimeout(() => { if (lastData && lastData.series) redrawGraph(); }, 60);
    });

    $("calcForm").addEventListener("submit", (event) => { event.preventDefault(); solve(); });
    $("clearBtn").addEventListener("click", reset);
    $("copyBtn").addEventListener("click", copyAnswer);
    $("saveBtn").addEventListener("click", saveResult);
    $("historyToggle").addEventListener("click", () => ($("historyDrawer").hidden ? openHistory() : closeHistory()));
    $("historyClose").addEventListener("click", closeHistory);
    $("drawerScrim").addEventListener("click", closeHistory);
    $("historyClear").addEventListener("click", () => { MathBot.history.clear(); refreshHistory(); ui.toast("History cleared"); });
    $("historySearch").addEventListener("input", refreshHistory);
    $("graphReset").addEventListener("click", () => {
      if (!lastData) return;
      $("graphXmin").value = lastData.xmin;
      $("graphXmax").value = lastData.xmax;
      redrawGraph();
    });
    $("graphXmin").addEventListener("change", redrawGraph);
    $("graphXmax").addEventListener("change", redrawGraph);

    $("paletteToggle").addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = $("paletteMenu");
      const show = menu.hidden;
      menu.hidden = !show;
      $("paletteToggle").setAttribute("aria-expanded", String(show));
    });
    document.addEventListener("click", (event) => {
      if (!$("paletteMenu").hidden && !event.target.closest(".palette-wrap")) {
        $("paletteMenu").hidden = true;
        $("paletteToggle").setAttribute("aria-expanded", "false");
      }
    });

    $("mobileMenu").addEventListener("click", () => document.querySelector(".main-nav").classList.toggle("open"));
    document.querySelectorAll(".main-nav a").forEach((link) => link.addEventListener("click", () => document.querySelector(".main-nav").classList.remove("open")));

    $("expression").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); solve(); }
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (event.key === "Escape") { closeHistory(); reset(); if (typing) target.blur(); return; }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^[1-9]$/.test(event.key)) {
        const mode = MathBot.MODES[Number(event.key) - 1];
        if (mode) setMode(mode.id);
      }
    });

    global.addEventListener("resize", () => {
      if (lastData && lastData.series && !$("graphPanel").hidden) redrawGraph();
    });
  }

  ui.initPalette();
  bindEvents();
  setMode("simplify");
  $("year").textContent = new Date().getFullYear();
  $("heroToolCount").textContent = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen"][MathBot.MODES.length] || String(MathBot.MODES.length);
  $('toolCount').textContent = MathBot.MODES.length;
  $("capabilityTitle").textContent = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen"][MathBot.MODES.length] || String(MathBot.MODES.length);
  ui.setStatus("Engine ready · local");
})(window);
