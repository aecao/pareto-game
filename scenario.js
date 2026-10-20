"use strict";

let scenarioConfig = null;
let scenarioLoading = false;
let scenarioResults = null;
let scenarioInputs = null;
const scenarioForm = document.getElementById("scenario-form");
const scenarioError = document.getElementById("scenario-error");
const scenarioState = document.getElementById("scenario-state");
const scenarioFocus = document.getElementById("scenario-focus");
const scenarioFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function setMarketView(view) {
  if (!["series", "scenario", "far"].includes(view)) throw new Error("Unknown Market view.");
  document.querySelectorAll("[data-market-view]").forEach((button) => {
    const active = button.dataset.marketView === view;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-market-panel]").forEach((panel) => { panel.hidden = panel.dataset.marketPanel !== view; });
  if (view === "scenario") loadScenario();
  if (view === "far") loadFar();
}

function drawScenario() {
  const host = document.getElementById("scenario-chart");
  const focus = scenarioResults.find((r) => r.id === scenarioFocus.value);
  host.replaceChildren();
  const svg = marketSvg("svg", { viewBox: "0 0 960 720", role: "img",
    "aria-label": `Four-quadrant long-run model. Rent up, stock right, annual delivery down, value left. Curves: ${focus.label}. Four scenario equilibrium loops; exact values and short-run comparison in the table.`,
  }, host);
  const cx = 480, cy = 360, extent = 275;
  const top = Math.max(1.5, ...scenarioResults.flatMap((r) => [r.stock, r.rent, r.price, r.flow])) * 1.18;
  const scale = extent / top;
  const point = (x, y) => [cx + x * scale, cy - y * scale];
  const polyline = (coords, cls) => marketSvg("polyline", {
    points: coords.map(([x, y]) => point(x, y).join(",")).join(" "), class: cls,
  }, svg);
  const clip = marketSvg("clipPath", { id: "scenario-plot-clip" }, marketSvg("defs", {}, svg));
  marketSvg("rect", { x: cx - extent, y: cy - extent, width: extent * 2, height: extent * 2 }, clip);
  const curves = marketSvg("g", { "clip-path": "url(#scenario-plot-clip)" }, svg);
  const curve = (coords) => marketSvg("polyline", {
    points: coords.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([x, y]) => point(x, y).join(",")).join(" "), class: "scenario-curve",
  }, curves);
  const steps = Array.from({ length: 301 }, (_, i) => top * (i + 1) / 301);
  curve(steps.map((s) => [s, ScenarioModel.rent(s, scenarioInputs, focus)]));
  curve(steps.map((p) => [-p, scenarioInputs.capRateFactor * p]));
  curve(steps.map((p) => [-p, -ScenarioModel.delivery(p, scenarioInputs, focus)]));
  curve(steps.map((s) => [s, -scenarioInputs.lossFactor * s]));
  for (const [x, y] of [
    [-top, 0], [top, 0], [0, top], [0, -top],
  ]) {
    const [px, py] = point(x, y);
    marketSvg("line", { x1: cx, y1: cy, x2: px, y2: py, class: "scenario-axis" }, svg);
  }
  for (const tick of [0.5, 1, 1.5, 2, 3, 4, 5, 10]) {
    if (tick > top) continue;
    const offset = tick * scale;
    for (const direction of [-1, 1]) {
      marketSvg("text", { x: cx + direction * offset, y: cy + 16, "text-anchor": "middle", class: "scenario-tick" }, svg, tick * 100);
      marketSvg("text", { x: cx + 7, y: cy + direction * offset + 4, class: "scenario-tick" }, svg, tick * 100);
    }
  }
  for (const row of scenarioResults) {
    const coords = [[row.stock, row.rent], [-row.price, row.rent],
      [-row.price, -row.flow], [row.stock, -row.flow], [row.stock, row.rent]];
    polyline(coords, `scenario-loop scenario-${row.id}${row.id === focus.id ? " is-focused" : ""}`);
    for (const [x, y] of coords.slice(0, 4)) {
      const [px, py] = point(x, y);
      const circle = marketSvg("circle", { cx: px, cy: py, r: row.id === focus.id ? 5 : 3,
        class: `scenario-dot scenario-${row.id}` }, svg);
      marketSvg("title", {}, circle, `${row.label}: rent ${scenarioFormat.format(row.rent * 100)}, value ${scenarioFormat.format(row.price * 100)}, stock ${scenarioFormat.format(row.stock * 100)}, annual delivery ${scenarioFormat.format(row.flow * 100)}`);
    }
  }
  for (const [x, y, label] of [
    [480, 30, ["Rent $"]], [480, 686, ["Construction", "(sq. ft.)"]],
    [110, 340, ["Price $"]], [835, 340, ["Stock (sq. ft.)"]],
    [235, 45, ["Asset Market:", "Valuation"]], [720, 45, ["Property Market:", "Rent Determination"]],
    [235, 660, ["Asset Market:", "Construction"]], [720, 660, ["Property Market:", "Stock Adjustment"]],
  ]) {
    const text = marketSvg("text", { x, y, "text-anchor": "middle", class: "scenario-label" }, svg);
    label.forEach((line, index) => marketSvg("tspan", { x, dy: index === 0 ? 0 : 17 }, text, line));
  }
}

function updateScenario() {
  if (!scenarioConfig) return;
  try {
    const inputs = {};
    for (const p of scenarioConfig.parameters) {
      const text = scenarioForm.elements.namedItem(p.id).value.trim();
      if (!text) throw new Error(`${p.label} is required.`);
      inputs[p.id] = Number(text);
    }
    const results = ScenarioModel.solve(scenarioConfig, inputs);
    scenarioInputs = inputs;
    scenarioResults = results;
    drawScenario();
    const body = document.getElementById("scenario-values");
    body.replaceChildren();
    for (const row of results) {
      const tr = marketElement("tr", "", body);
      tr.className = `scenario-${row.id}`;
      marketElement("th", row.label, tr).scope = "row";
      for (const key of ["shortRunRent", "shortRunPrice", "rent", "price", "flow", "stock"]) {
        marketElement("td", scenarioFormat.format(row[key] * 100), tr);
      }
    }
    const baseline = results[0], bridge = results[1], combined = results[3];
    const percent = (value, reference) => `${scenarioFormat.format(100 * (value / reference - 1))}%`;
    document.getElementById("scenario-summary").textContent =
      `Combined long-run rent: ${percent(combined.rent, baseline.rent)} versus no intervention; ${percent(combined.rent, bridge.rent)} versus bridge only. Combined stock: ${percent(combined.stock, baseline.stock)} versus no intervention. These are conditional teaching-model results, not forecasts.`;
    scenarioError.hidden = true;
    scenarioError.textContent = "";
    scenarioState.textContent = "Illustrative assumptions applied. Each axis has its own reference = 100. Common cap-rate, cost and loss changes also move the no-intervention result away from 100.";
  } catch (error) {
    console.error("Explanatory scenario failed", error);
    scenarioError.textContent = error.message;
    scenarioError.hidden = false;
    scenarioState.textContent = scenarioResults
      ? "Invalid assumptions. Chart and table show LAST VALID RESULTS; correct inputs."
      : "Scenario unavailable; correct inputs or retry.";
  }
}

async function loadScenario() {
  if (scenarioConfig || scenarioLoading) return;
  scenarioLoading = true;
  scenarioState.textContent = "Loading illustrative assumptions...";
  document.getElementById("scenario-retry").hidden = true;
  try {
    const response = await fetch("assets/market/scenario.json");
    if (!response.ok) throw new Error(`Scenario assumptions download failed (HTTP ${response.status}).`);
    const config = ScenarioModel.validateConfig(await response.json());
    const fields = document.getElementById("scenario-fields");
    for (const p of config.parameters) {
      const label = marketElement("label", p.label, fields);
      label.htmlFor = `scenario-${p.id}`;
      const input = document.createElement("input");
      Object.assign(input, { id: label.htmlFor, name: p.id, type: "number",
        min: String(p.min), max: String(p.max), step: String(p.step), value: String(p.default), required: true });
      input.setAttribute("aria-describedby", `${input.id}-note`);
      fields.append(input);
      const note = marketElement("p", p.note, fields);
      note.id = `${input.id}-note`;
      note.className = "section-note";
    }
    scenarioConfig = config;
    fields.disabled = false;
    document.getElementById("scenario-reset").disabled = false;
    scenarioFocus.disabled = false;
    updateScenario();
  } catch (error) {
    console.error("Scenario loading failed", error);
    scenarioError.textContent = error.message;
    scenarioError.hidden = false;
    scenarioState.textContent = "Explanatory model unavailable. Monthly series remain independent.";
    document.getElementById("scenario-retry").hidden = false;
  } finally {
    scenarioLoading = false;
  }
}

document.querySelectorAll("[data-market-view]").forEach((button) => {
  button.addEventListener("click", () => setMarketView(button.dataset.marketView));
});
scenarioForm.addEventListener("submit", (event) => { event.preventDefault(); updateScenario(); });
scenarioForm.addEventListener("input", updateScenario);
scenarioFocus.addEventListener("change", () => { if (scenarioResults) drawScenario(); });
document.getElementById("scenario-reset").addEventListener("click", () => {
  for (const p of scenarioConfig.parameters) scenarioForm.elements.namedItem(p.id).value = String(p.default);
  updateScenario();
});
document.getElementById("scenario-retry").addEventListener("click", loadScenario);
