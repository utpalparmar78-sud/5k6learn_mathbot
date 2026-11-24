/* DOM rendering and visual state. */
(function (global) {
  const MathBot = (global.MathBot = global.MathBot || {});
  const $ = (id) => document.getElementById(id);
  let toastTimer = null;

  function toast(message) {
    const element = $("toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(() => element.classList.remove("show"), 2400);
  }

  function setStatus(text) {
    const element = $("footerStatus");
    if (element) element.textContent = text;
  }

  function icon(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }

  function applyPalette(id) {
    const palette = MathBot.PALETTES.find((p) => p.id === id) || MathBot.PALETTES[0];
    document.documentElement.dataset.palette = palette.id;
    try { global.localStorage.setItem("mathbot.palette", palette.id); } catch (err) { /* ignore */ }
    const label = $("paletteName");
    if (label) label.textContent = palette.name;
    document.querySelectorAll(".palette-option").forEach((option) => {
      option.classList.toggle("active", option.dataset.palette === palette.id);
    });
    return palette;
  }

  function initPalette() {
    let saved = null;
    try { saved = global.localStorage.getItem("mathbot.palette"); } catch (err) { /* ignore */ }
    return applyPalette(saved || "graphite");
  }

  function renderPaletteMenu(container, onSelect) {
    container.innerHTML = "";
    MathBot.PALETTES.forEach((palette) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "palette-option";
      option.dataset.palette = palette.id;
      const swatch = document.createElement("span");
      swatch.className = "palette-swatch";
      swatch.style.background = palette.fg;
      swatch.style.setProperty("--swatch-accent", palette.accent);
      const name = document.createElement("span");
      name.textContent = palette.name;
      option.appendChild(swatch);
      option.appendChild(name);
      option.appendChild(icon("i-check"));
      option.addEventListener("click", () => { applyPalette(palette.id); onSelect(palette.id); });
      container.appendChild(option);
    });
  }

  function renderToolList(container, modes, onSelect) {
    container.innerHTML = "";
    modes.forEach((mode, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool-item";
      button.dataset.mode = mode.id;
      button.title = mode.name;
      const number = document.createElement("span");
      number.className = "tool-no";
      number.textContent = String(index + 1).padStart(2, "0");
      const label = document.createElement("span");
      label.className = "tool-name";
      label.textContent = mode.name;
      button.appendChild(number);
      button.appendChild(icon(mode.glyph));
      button.appendChild(label);
      button.addEventListener("click", () => onSelect(mode.id));
      container.appendChild(button);
    });
  }

  function renderCapabilities(container, modes) {
    container.innerHTML = "";
    modes.forEach((mode, index) => {
      const item = document.createElement("article");
      item.className = "capability";
      const number = document.createElement("span");
      number.className = "cap-no";
      number.textContent = String(index + 1).padStart(2, "0");
      const heading = document.createElement("h3");
      heading.textContent = mode.name;
      const description = document.createElement("p");
      description.textContent = mode.description;
      item.appendChild(number);
      item.appendChild(heading);
      item.appendChild(description);
      container.appendChild(item);
    });
  }

  function renderTicker(container, modes) {
    const content = modes.map((mode) => mode.name.toUpperCase()).join("  ");
    container.innerHTML = "";
    for (let i = 0; i < 2; i++) {
      const span = document.createElement("span");
      span.textContent = content;
      container.appendChild(span);
    }
  }

  function renderExtraFields(container, mode) {
    container.innerHTML = "";
    const fields = mode.fields || [];
    if (!fields.length) return;
    const grid = document.createElement("div");
    grid.className = "extra-grid";
    fields.forEach((field) => {
      const item = document.createElement("div");
      item.className = "extra-item";
      const label = document.createElement("label");
      label.textContent = field.label;
      label.htmlFor = "f-" + field.key;
      let input;
      if (field.type === "select") {
        input = document.createElement("select");
        (field.options || []).forEach(([value, text]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          input.appendChild(option);
        });
      } else {
        input = document.createElement("input");
        input.type = field.type || "text";
        input.placeholder = field.placeholder || "";
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        input.autocomplete = "off";
        input.spellcheck = false;
      }
      input.id = "f-" + field.key;
      input.value = field.default !== undefined ? field.default : "";
      item.appendChild(label);
      item.appendChild(input);
      grid.appendChild(item);
    });
    container.appendChild(grid);
  }

  function renderKeypad(container, handlers) {
    container.innerHTML = "";
    const functions = [
      { label: "√", insert: "sqrt(" },
      { label: "x²", insert: "^2" },
      { label: "%", insert: "/100" },
      { label: "±", action: "sign" },
      { label: "π", insert: "pi" },
    ];
    const strip = document.createElement("div");
    strip.className = "keypad-functions";
    functions.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "key key-function";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        if (item.action === "sign") handlers.onSign();
        else handlers.onInsert(item.insert);
      });
      strip.appendChild(button);
    });

    const grid = document.createElement("div");
    grid.className = "keypad-grid";
    const keys = [
      ["C", "clear", "key-clear"], ["(", "insert", ""], [")", "insert", ""], ["÷", "operator", "key-operator"],
      ["7", "insert", ""], ["8", "insert", ""], ["9", "insert", ""], ["×", "operator", "key-operator"],
      ["4", "insert", ""], ["5", "insert", ""], ["6", "insert", ""], ["−", "operator", "key-operator"],
      ["1", "insert", ""], ["2", "insert", ""], ["3", "insert", ""], ["+", "operator", "key-operator"],
      ["0", "insert", "key-zero"], [".", "insert", ""], ["back", "backspace", "key-back"], ["=", "equals", "key-equals"],
    ];
    keys.forEach(([label, action, className]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "key " + className;
      if (action === "backspace") button.appendChild(icon("i-backspace"));
      else button.textContent = label;
      const value = action === "insert" ? label : action === "operator" ? ({ "÷": "/", "×": "*", "−": "-", "+": "+" })[label] : null;
      button.addEventListener("click", () => {
        if (action === "clear") handlers.onClear();
        else if (action === "backspace") handlers.onBackspace();
        else if (action === "equals") handlers.onEquals();
        else handlers.onInsert(value, action === "operator");
      });
      grid.appendChild(button);
    });

    container.appendChild(strip);
    container.appendChild(grid);
  }

  function renderExamples(container, mode, onPick) {
    container.innerHTML = "";
    const lead = document.createElement("span");
    lead.className = "examples-label";
    lead.textContent = "Examples";
    container.appendChild(lead);
    (mode.examples || []).forEach((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "example";
      button.textContent = value;
      button.addEventListener("click", () => onPick(value));
      container.appendChild(button);
    });
  }

  function showError(message) {
    $("errorText").textContent = message;
    $("errorBox").hidden = false;
    $("resultCard").hidden = true;
  }

  function clearMessages() {
    $("errorBox").hidden = true;
    $("resultCard").hidden = true;
  }

  function formatResult(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(formatResult).join("\n");
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, item]) => key + ": " + formatResult(item)).join("\n");
    }
    return String(value);
  }

  function showResult(data, mode) {
    $("resultTitle").textContent = data.title || mode.title;
    $("resultText").textContent = formatResult(data.result);
    const badges = [mode.name.toUpperCase(), "LOCAL ENGINE"];
    if (data.exact) badges.push("EXACT INPUT: " + String(data.exact).slice(0, 48));
    $("resultMeta").textContent = badges.join("   ·   ");

    const steps = $("stepsList");
    steps.innerHTML = "";
    (data.steps || []).forEach((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      steps.appendChild(li);
    });

    if (data.series && data.series.length) {
      $("graphPanel").hidden = false;
      $("graphXmin").value = data.xmin;
      $("graphXmax").value = data.xmax;
      MathBot.graph.draw($("graphCanvas"), data, $("graphTooltip"));
      MathBot.graph.legend($("graphLegend"), data.series);
    } else {
      $("graphPanel").hidden = true;
    }
    $("resultCard").hidden = false;
  }

  function renderHistory(container, query, onRestore) {
    const items = MathBot.history.all();
    const filtered = query
      ? items.filter((item) => (item.expression + " " + item.result + " " + item.mode).toLowerCase().includes(query.toLowerCase()))
      : items;
    container.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = query ? "No matches found." : "Nothing saved yet. Calculate something, then choose Save to keep it here.";
      container.appendChild(empty);
      return;
    }
    filtered.forEach((item) => {
      const card = document.createElement("div");
      card.className = "history-item";
      card.title = "Load this calculation";
      const mode = document.createElement("div");
      mode.className = "h-mode";
      mode.textContent = item.mode;
      const expression = document.createElement("div");
      expression.className = "h-expr";
      expression.textContent = item.expression || "—";
      const result = document.createElement("div");
      result.className = "h-result";
      result.textContent = String(item.result).slice(0, 90);
      const time = document.createElement("div");
      time.className = "h-time";
      time.textContent = new Date(item.ts).toLocaleString();
      card.appendChild(mode);
      card.appendChild(expression);
      card.appendChild(result);
      card.appendChild(time);
      card.addEventListener("click", () => onRestore(item));
      container.appendChild(card);
    });
  }

  MathBot.ui = {
    $, icon, toast, setStatus, applyPalette, initPalette, renderPaletteMenu,
    renderToolList, renderCapabilities, renderTicker, renderExtraFields,
    renderKeypad, renderExamples, showError, clearMessages, formatResult, showResult, renderHistory,
  };
})(window);
