/* Canvas graph renderer: grid, axes, multiple series and a hover readout. */
(function (global) {
  const MathBot = (global.MathBot = global.MathBot || {});
  let state = null;

  function niceStep(range, count) {
    const raw = range / count;
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const normalised = raw / magnitude;
    const multiplier = normalised < 1.5 ? 1 : normalised < 3 ? 2 : normalised < 7 ? 5 : 10;
    return multiplier * magnitude;
  }

  function tickLabel(value) {
    if (Math.abs(value) < 1e-9) return "0";
    if (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3) return value.toExponential(1);
    return String(Number(value.toFixed(2)));
  }

  function quantile(sorted, p) {
    if (!sorted.length) return NaN;
    const index = (sorted.length - 1) * p;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
  }

  function renderBase(canvas, payload, colors) {
    const compact = global.innerWidth <= 620;
    const ratio = compact ? 0.9 : 320 / 760;
    const width = canvas.getBoundingClientRect().width || 760;
    const height = width * ratio;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const base = document.createElement("canvas");
    base.width = canvas.width;
    base.height = canvas.height;
    const ctx = base.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = compact ? { left: 38, right: 14, top: 14, bottom: 26 } : { left: 46, right: 18, top: 18, bottom: 30 };
    const xmin = payload.xmin;
    const xmax = payload.xmax;
    const points = payload.series.reduce((acc, s) => acc.concat(s.points), []);
    if (!points.length || xmax <= xmin) return null;

    const sortedY = points.map((p) => p.y).filter(Number.isFinite).sort((a, b) => a - b);
    let ymin = quantile(sortedY, 0.01);
    let ymax = quantile(sortedY, 0.99);
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax) || ymax - ymin < 1e-9) {
      const centre = Number.isFinite(ymin) ? ymin : 0;
      ymin = centre - 1;
      ymax = centre + 1;
    }
    const breathing = (ymax - ymin) * 0.12;
    ymin -= breathing;
    ymax += breathing;

    const X = (x) => pad.left + ((x - xmin) / (xmax - xmin)) * (width - pad.left - pad.right);
    const Y = (y) => height - pad.bottom - ((y - ymin) / (ymax - ymin)) * (height - pad.top - pad.bottom);
    const styles = getComputedStyle(document.documentElement);
    const light = styles.getPropertyValue("--palette-light").trim() === "1";
    const gridColor = light ? "rgba(20,30,45,.10)" : "rgba(255,255,255,.09)";
    const axisColor = light ? "rgba(20,30,45,.38)" : "rgba(255,255,255,.34)";
    const textColor = styles.getPropertyValue("--muted").trim() || (light ? "#626d8a" : "#9ca3aa");

    ctx.font = (compact ? "11px" : "10px") + " 'JetBrains Mono', monospace";
    ctx.fillStyle = textColor;
    ctx.lineWidth = 1;

    // Grid and tick labels
    const xStep = niceStep(xmax - xmin, 8);
    ctx.textAlign = "center";
    for (let value = Math.ceil(xmin / xStep) * xStep; value <= xmax + xStep * 1e-6; value += xStep) {
      const px = X(value);
      ctx.strokeStyle = gridColor;
      ctx.beginPath(); ctx.moveTo(px, pad.top); ctx.lineTo(px, height - pad.bottom); ctx.stroke();
      ctx.fillText(tickLabel(value), px, height - pad.bottom + 15);
    }
    const yStep = niceStep(ymax - ymin, 6);
    ctx.textAlign = "right";
    for (let value = Math.ceil(ymin / yStep) * yStep; value <= ymax + yStep * 1e-6; value += yStep) {
      const py = Y(value);
      ctx.strokeStyle = gridColor;
      ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(width - pad.right, py); ctx.stroke();
      ctx.fillText(tickLabel(value), pad.left - 8, py + 3);
    }

    // Axes
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1.4;
    if (ymin <= 0 && ymax >= 0) {
      ctx.beginPath(); ctx.moveTo(pad.left, Y(0)); ctx.lineTo(width - pad.right, Y(0)); ctx.stroke();
    }
    if (xmin <= 0 && xmax >= 0) {
      ctx.beginPath(); ctx.moveTo(X(0), pad.top); ctx.lineTo(X(0), height - pad.bottom); ctx.stroke();
    }

    // Series
    payload.series.forEach((series) => {
      if (!series.points.length) return;
      const spacing = (xmax - xmin) / Math.max(series.points.length - 1, 1);
      ctx.strokeStyle = series.colour || "#9b8cff";
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = series.colour || "#9b8cff";
      ctx.shadowBlur = 9;
      ctx.beginPath();
      let previous = null;
      series.points.forEach((point) => {
        const px = X(point.x);
        const py = Y(point.y);
        if (!previous || point.x - previous.x > spacing * 2.5) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        previous = point;
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    return { base, width, height, dpr, X, Y, xmin, xmax, ymin, ymax, pad, colors };
  }

  function clearHover() {
    if (!state) return;
    const ctx = state.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    ctx.drawImage(state.base, 0, 0);
    state.tooltip.classList.add("hidden");
  }

  function showHover(index, point, series) {
    const ctx = state.canvas.getContext("2d");
    clearHover();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    const px = state.X(point.x);
    const py = state.Y(point.y);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5b8cff";
    ctx.strokeStyle = accent;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, state.pad.top); ctx.lineTo(px, state.height - state.pad.bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(state.pad.left, py); ctx.lineTo(state.width - state.pad.right, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = series.colour || "#9b8cff";
    ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();

    const tooltip = state.tooltip;
    tooltip.textContent = `x = ${tickLabel(point.x)}   y = ${tickLabel(point.y)}`;
    tooltip.style.left = Math.max(60, Math.min(state.width - 60, px)) + "px";
    tooltip.style.top = Math.max(30, py) + "px";
    tooltip.classList.remove("hidden");
  }

  function onPointerMove(event) {
    if (!state) return;
    const rect = state.canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let best = null;
    let bestDistance = Infinity;
    state.series.forEach((series) => {
      series.points.forEach((point) => {
        const distance = Math.hypot(state.X(point.x) - mx, state.Y(point.y) - my);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { point: point, series: series };
        }
      });
    });
    if (best && bestDistance < 26) showHover(0, best.point, best.series);
    else clearHover();
  }

  MathBot.graph = {
    draw(canvas, payload, tooltip) {
      if (!canvas || !payload || !payload.series || !payload.series.length) return;
      const rendered = renderBase(canvas, payload);
      if (!rendered) return;
      state = {
        canvas: canvas, tooltip: tooltip, series: payload.series,
        base: rendered.base, width: rendered.width, height: rendered.height,
        dpr: rendered.dpr, X: rendered.X, Y: rendered.Y,
        pad: rendered.pad, xmin: rendered.xmin, xmax: rendered.xmax,
      };
      clearHover();
      if (!canvas._hoverBound) {
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerleave", clearHover);
        canvas._hoverBound = true;
      }
    },
    legend(element, series) {
      if (!element) return;
      element.innerHTML = "";
      series.forEach((seriesItem) => {
        const item = document.createElement("span");
        item.className = "legend-item";
        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.background = seriesItem.colour || "#9b8cff";
        const label = document.createElement("span");
        label.textContent = seriesItem.label;
        item.appendChild(swatch);
        item.appendChild(label);
        element.appendChild(item);
      });
    },
  };
})(window);
