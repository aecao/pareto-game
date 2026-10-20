"use strict";

let farConfig = null;
let farLoading = false;
let farResult = null;
const farForm = document.getElementById("far-form");
const farError = document.getElementById("far-error");
const farState = document.getElementById("far-state");

function drawFar(inputs, result) {
  const host = document.getElementById("far-chart");
  ModelInteraction.hideDefinition(host.ownerDocument);
  host.replaceChildren();
  const svg = marketSvg("svg", { viewBox: "0 0 900 600", role: "group",
    "aria-label": "Optimal FAR model. Upper plot: housing sale price and average non-land development cost per gross housing square foot. Lower plot: residual land value per lot square foot. Unconstrained maximum, hypothetical ceiling and chosen maximum are marked. Table supplies exact marker values.",
  }, host);
  const left = 100, right = 850, upperTop = 70, upperBottom = 240, lowerTop = 360, lowerBottom = 530;
  const frozen = ModelInteraction.dragGeometry(host);
  const maxFar = frozen?.maxFar ?? Math.max(5, inputs.farCap * 1.15, (result.crossing ?? 0) * 1.2);
  const samples = Array.from({ length: 241 }, (_, i) => FarModel.values(maxFar * i / 240, inputs));
  const topValues = samples.flatMap((r) => [r.price, r.cost]);
  const lowTop = frozen?.lowTop ?? Math.min(0, ...topValues);
  const highTop = frozen?.highTop ?? Math.max(1, ...topValues) * 1.1;
  const landValues = [...samples.map((r) => r.land), result.unconstrained.land];
  const lowLand = frozen?.lowLand ?? Math.min(0, ...landValues) * 1.1;
  const highLand = frozen?.highLand ?? Math.max(1, ...landValues) * 1.1;
  const geometry = { maxFar, lowTop, highTop, lowLand, highLand };
  const x = (far) => left + far / maxFar * (right - left);
  const yTop = (v) => upperBottom - (v - lowTop) / (highTop - lowTop) * (upperBottom - upperTop);
  const yLand = (v) => lowerBottom - (v - lowLand) / (highLand - lowLand) * (lowerBottom - lowerTop);
  const defs = marketSvg("defs", {}, svg);
  const plots = [upperTop, lowerTop].map((top, index) => {
    const bottom = index === 0 ? upperBottom : lowerBottom;
    const id = `far-plot-${index}-clip`;
    const clip = marketSvg("clipPath", { id }, defs);
    marketSvg("rect", { x: left, y: top, width: right - left, height: bottom - top }, clip);
    return marketSvg("g", { "clip-path": `url(#${id})` }, svg);
  });
  for (const [top, bottom, low, high, y] of [
    [upperTop, upperBottom, lowTop, highTop, yTop], [lowerTop, lowerBottom, lowLand, highLand, yLand],
  ]) {
    marketSvg("line", { x1: left, x2: left, y1: top, y2: bottom, class: "scenario-axis" }, svg);
    marketSvg("line", { x1: left, x2: right, y1: y(0), y2: y(0), class: "scenario-axis" }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = low + (high - low) * i / 4;
      marketSvg("line", { x1: left, x2: right, y1: y(v), y2: y(v), class: "market-grid" }, svg);
      marketSvg("text", { x: left - 8, y: y(v) + 4, "text-anchor": "end", class: "far-tick" }, svg, scenarioFormat.format(v));
      const f = maxFar * i / 4;
      marketSvg("text", { x: x(f), y: bottom + 20, "text-anchor": "middle", class: "far-tick" }, svg, scenarioFormat.format(f));
    }
  }
  for (const [key, y, cls] of [["price", yTop, "far-price"], ["cost", yTop, "far-cost"], ["land", yLand, "far-land"]]) {
    marketSvg("polyline", { points: samples.map((r) => `${x(r.far)},${y(r[key])}`).join(" "),
      class: `far-line ${cls}` }, plots[key === "land" ? 1 : 0]);
  }
  for (const [far, cls] of [
    [result.crossing, "far-crossing"], [result.unconstrained.far, "far-optimum"], [inputs.farCap, "far-cap"],
  ]) {
    if (far === null) continue;
    for (const [index, [top, bottom]] of [[upperTop, upperBottom], [lowerTop, lowerBottom]].entries()) {
      marketSvg("line", { x1: x(far), x2: x(far), y1: top, y2: bottom, class: `far-guide ${cls}` }, plots[index]);
    }
  }
  for (const [value, y] of [[result.unconstrained.price, yTop], [result.unconstrained.land, yLand]]) {
    marketSvg("line", { x1: left, x2: x(result.unconstrained.far), y1: y(value), y2: y(value),
      class: "far-guide far-optimum" }, plots[y === yTop ? 0 : 1]);
  }
  for (const [label, row, cls] of [
    ["Unconstrained optimum", result.unconstrained, "far-optimum"],
    ["Chosen optimum under ceiling", result.chosen, "far-chosen"],
  ]) {
    for (const [value, y] of [[row.price, yTop], [row.land, yLand]]) {
      const dot = marketSvg("circle", { cx: x(row.far), cy: y(value), r: cls === "far-chosen" ? 6 : 4,
        class: `far-dot ${cls}` }, plots[y === yTop ? 0 : 1]);
      marketSvg("title", {}, dot, `${label}: FAR ${scenarioFormat.format(row.far)}, price ${scenarioFormat.format(row.price)}, average cost ${scenarioFormat.format(row.cost)}, residual land value ${scenarioFormat.format(row.land)}`);
    }
  }
  for (const [px, py, label] of [
    [100, 30, "HOUSING PRICE / AVERAGE DEVELOPMENT COST"],
    [100, 50, "Arbitrary value units per gross residential sq. ft (not dollars)"],
    [100, 315, "RESIDUAL LAND VALUE = FAR × (PRICE − AVERAGE COST)"],
    [100, 335, "Same arbitrary value units per lot sq. ft; negative values retained"],
    [100, 285, "FAR = gross residential floor area / lot area"],
    [100, 575, "FAR = gross residential floor area / lot area"],
  ]) marketSvg("text", { x: px, y: py, class: "far-label" }, svg, label);
  const handle = (id, far, value, label, fromPoint, extra = {}) => ModelInteraction.bindHandle(svg, {
    host, parameter: farConfig.parameters.find((p) => p.id === id),
    input: farForm.elements.namedItem(id), onChange: updateFar,
    x: Math.max(left, Math.min(right, x(far))), y: Math.max(upperTop, Math.min(upperBottom, yTop(value))),
    label, geometry, valueFromPoint: (px, py) => fromPoint(
      (px - left) / (right - left) * maxFar,
      lowTop + (upperBottom - py) / (upperBottom - upperTop) * (highTop - lowTop)),
    ...extra,
  });
  const priceAnchor = maxFar * 0.55, costAnchor = maxFar * 0.8;
  handle("priceIntercept", 0, inputs.priceIntercept, "Price level", (_f, value) => value,
    { x: left - 20 });
  handle("costIntercept", 0, inputs.costIntercept, "Cost level", (_f, value) => value,
    { x: left + 20, labelY: 24 });
  handle("priceSlope", priceAnchor, FarModel.values(priceAnchor, inputs).price,
    "Price slope", (_f, value) => (inputs.priceIntercept - value) / priceAnchor);
  handle("costSlope", costAnchor, FarModel.values(costAnchor, inputs).cost,
    "Cost slope", (_f, value) => (value - inputs.costIntercept) / costAnchor,
    { labelX: -15, labelY: 24 });
  handle("farCap", inputs.farCap, 0, "FAR ceiling", (far) => far,
    { y: upperTop - 10, orientation: "horizontal", labelX: -15 });
}

function updateFar() {
  if (!farConfig) return;
  try {
    const inputs = {};
    for (const p of farConfig.parameters) {
      const text = farForm.elements.namedItem(p.id).value.trim();
      if (!text) throw new Error(`${p.label} is required.`);
      inputs[p.id] = Number(text);
    }
    const result = FarModel.solve(farConfig, inputs);
    drawFar(inputs, result);
    const body = document.getElementById("far-values");
    body.replaceChildren();
    for (const [label, row] of [
      ["No new building (FAR 0)", FarModel.values(0, inputs)],
      ["Unconstrained optimum F*", result.unconstrained],
      ["Chosen optimum under ceiling", result.chosen],
      ["At hypothetical ceiling", result.cap],
      ["Price = average cost (zero residual)", result.crossingValue],
    ]) {
      const tr = marketElement("tr", "", body);
      marketElement("th", label, tr).scope = "row";
      for (const key of ["far", "price", "cost", "land"]) marketElement("td", row === null ? "No nonnegative crossing" : scenarioFormat.format(row[key]), tr);
    }
    let summary = `Unconstrained F*: ${scenarioFormat.format(result.unconstrained.far)}. Chosen FAR under the hypothetical ceiling: ${scenarioFormat.format(result.chosen.far)}; residual land value: ${scenarioFormat.format(result.chosen.land)} arbitrary units per lot sq. ft. `;
    summary += result.positiveResidual ? (result.capBinding
      ? "Ceiling binds; allowing more FAR up to F* raises residual land value in this model."
      : "Ceiling does not bind; building to the ceiling need not maximize land value.")
      : "No strictly positive development residual is available under these assumptions; FAR 0 is selected. This is not an assessment of existing-use value.";
    document.getElementById("far-summary").textContent = summary;
    farResult = result;
    farError.hidden = true;
    farError.textContent = "";
    farState.textContent = "Illustrative assumptions applied. The price/cost crossing is a zero-residual boundary, not the land-value optimum.";
  } catch (error) {
    console.error("Optimal FAR calculation failed", error);
    farError.textContent = error.message;
    farError.hidden = false;
    farState.textContent = farResult ? "Invalid assumptions. Diagram and table show LAST VALID RESULTS." : "Optimal FAR unavailable; correct inputs or retry.";
  }
}

async function loadFar() {
  if (farConfig || farLoading) return;
  farLoading = true;
  farState.textContent = "Loading illustrative FAR assumptions...";
  document.getElementById("far-retry").hidden = true;
  try {
    const response = await fetch("assets/market/far.json");
    if (!response.ok) throw new Error(`Optimal FAR assumptions download failed (HTTP ${response.status}).`);
    const config = FarModel.validateConfig(await response.json());
    const fields = document.getElementById("far-fields");
    for (const p of config.parameters) {
      const label = marketElement("label", p.label, fields);
      label.htmlFor = `far-${p.id}`;
      const input = document.createElement("input");
      Object.assign(input, { id: label.htmlFor, name: p.id, type: "number", min: String(p.min),
        max: String(p.max), step: String(p.step), value: String(p.default), required: true });
      input.setAttribute("aria-describedby", `${input.id}-note`);
      fields.append(input);
      const note = marketElement("p", p.note, fields);
      note.id = `${input.id}-note`;
      note.className = "section-note";
    }
    farConfig = config;
    fields.disabled = false;
    document.getElementById("far-reset").disabled = false;
    updateFar();
  } catch (error) {
    console.error("Optimal FAR loading failed", error);
    farError.textContent = error.message;
    farError.hidden = false;
    farState.textContent = "Optimal FAR model unavailable. Other Market views remain independent.";
    document.getElementById("far-retry").hidden = false;
  } finally {
    farLoading = false;
  }
}

farForm.addEventListener("submit", (event) => { event.preventDefault(); updateFar(); });
farForm.addEventListener("input", updateFar);
document.getElementById("far-reset").addEventListener("click", () => {
  for (const p of farConfig.parameters) farForm.elements.namedItem(p.id).value = String(p.default);
  updateFar();
});
document.getElementById("far-retry").addEventListener("click", loadFar);
