"use strict";

let marketData = null;
let marketLoading = false;
const marketFields = document.getElementById("market-fields");
const marketMetric = document.getElementById("market-metric");
const marketGeography = document.getElementById("market-geography");
const marketStart = document.getElementById("market-start");
const marketEnd = document.getElementById("market-end");
const marketState = document.getElementById("market-state");
const marketError = document.getElementById("market-error");
const marketRetry = document.getElementById("market-retry");
const marketNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function marketElement(tag, text, parent) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function marketOptions(resetDates = false) {
  const metric = marketData.metrics.find((m) => m.id === marketMetric.value);
  const previous = marketGeography.value || marketData.defaults.geography;
  const available = new Set(metric.series.map((s) => s.geography));
  const geographies = marketData.geographies.filter((g) => available.has(g.id));
  marketGeography.replaceChildren();
  for (const g of geographies) {
    marketGeography.add(new Option(`${g.name}${g.type === "neighborhood" ? ` / ${g.borough}` : ""} (${g.type})`, g.id));
  }
  const replaced = !available.has(previous);
  marketGeography.value = replaced ? marketData.defaults.geography : previous;
  for (const input of [marketStart, marketEnd]) {
    input.min = metric.months[0];
    input.max = metric.months.at(-1);
  }
  if (resetDates) {
    marketStart.value = metric.months[0];
    marketEnd.value = metric.months.at(-1);
  }
  renderMarket([
    resetDates ? "Period set to the selected metric's full history." : "",
    replaced ? "Previous geography is unavailable for this metric; showing Queens borough." : "",
  ].filter(Boolean).join(" "));
}

function marketSvg(tag, attributes, parent, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

function drawMarketChart(selection) {
  const host = document.getElementById("market-chart");
  host.replaceChildren();
  const segments = MarketModel.segments(selection.rows);
  if (!segments.length) {
    marketElement("p", "No reported values in this period. Missing cells remain visible in the table.", host);
    return;
  }
  const svg = marketSvg("svg", { viewBox: "0 0 900 330", role: "img",
    "aria-label": `${selection.geography.name}: ${selection.metric.label}, ${selection.rows[0].month} to ${selection.rows.at(-1).month}. ${selection.missing} missing and ${selection.flagged} flagged months. See table for values.`,
  }, host);
  const values = segments.flat().map((r) => r.value);
  let low = Math.min(...values), high = Math.max(...values);
  const padding = high === low ? Math.max(Math.abs(high) * 0.05, 1) : (high - low) * 0.06;
  low -= padding;
  high += padding;
  const first = MarketModel.monthIndex(selection.rows[0].month);
  const duration = Math.max(1, MarketModel.monthIndex(selection.rows.at(-1).month) - first);
  const x = (row) => 100 + (MarketModel.monthIndex(row.month) - first) / duration * 775;
  const y = (row) => 280 - (row.value - low) / (high - low) * 250;
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    const position = 280 - i / 4 * 250;
    marketSvg("line", { x1: 100, x2: 875, y1: position, y2: position, class: "market-grid" }, svg);
    marketSvg("text", { x: 90, y: position + 4, "text-anchor": "end" }, svg, marketNumber.format(value));
  }
  for (const index of new Set([0, Math.floor((selection.rows.length - 1) / 2), selection.rows.length - 1])) {
    const row = selection.rows[index];
    marketSvg("text", { x: x(row), y: 310, "text-anchor": index === 0 ? "start" : index === selection.rows.length - 1 ? "end" : "middle" }, svg, row.month);
  }
  for (const segment of segments) {
    marketSvg("polyline", { points: segment.map((r) => `${x(r)},${y(r)}`).join(" "), class: "market-line" }, svg);
    for (const row of segment) {
      const point = marketSvg("circle", { cx: x(row), cy: y(row), r: row.flagged ? 5 : 3,
        class: row.flagged ? "market-point is-flagged" : "market-point" }, svg);
      marketSvg("title", {}, point, `${row.month}: ${marketNumber.format(row.value)}${row.flagged ? " (flagged source value)" : ""}`);
    }
  }
}

function renderMarket(notice = "") {
  try {
    const selected = MarketModel.select(marketData, marketMetric.value, marketGeography.value, marketStart.value, marketEnd.value);
    marketError.hidden = true;
    marketError.textContent = "";
    document.getElementById("market-title").textContent = `${selected.metric.label} / ${selected.geography.name}`;
    document.getElementById("market-description").textContent = selected.metric.description;
    const latest = selected.latest
      ? `Latest reported in this period: ${marketNumber.format(selected.latest.value)} (${selected.latest.month})${selected.latest.flagged ? "; FLAGGED source value" : ""}.`
      : "No reported values in this period.";
    document.getElementById("market-summary").textContent = `${latest} ${selected.rows.length} month${selected.rows.length === 1 ? "" : "s"}; ${selected.missing} missing; ${selected.flagged} flagged.`;
    drawMarketChart(selected);
    const tbody = document.getElementById("market-values");
    tbody.replaceChildren();
    for (const row of [...selected.rows].reverse()) {
      const tr = marketElement("tr", "", tbody);
      if (row.flagged) tr.classList.add("is-flagged");
      marketElement("th", row.month, tr).scope = "row";
      marketElement("td", row.value === null ? "Not reported" : marketNumber.format(row.value), tr);
      const status = marketElement("td", row.value === null ? "Missing source cell" : row.flagged ? "Flagged source value" : "Reported", tr);
      status.title = `Original zero-based publisher source row: ${row.sourceRow}`;
    }
    marketState.textContent = `${notice ? `${notice} ` : ""}${selected.geography.type}${selected.geography.borough ? ` / ${selected.geography.borough}` : ""}; ${marketStart.value} through ${marketEnd.value}.`;
    const p = marketData.provenance;
    document.getElementById("market-provenance").textContent = `${p.publisher} cleaned snapshot: ${marketData.metrics.length} metrics, ${marketData.geographies.length} published labels, ${p.cells.toLocaleString("en-US")} source cells. History and available geographies differ by metric. Source hashes and full-precision values are included in the JSON download. No geographic assignment or model fit.`;
  } catch (error) {
    console.error("Market selection failed", error);
    marketError.textContent = error.message;
    marketError.hidden = false;
    marketState.textContent = "Invalid selection. The chart and table show the LAST VALID RESULTS; correct the month range.";
  }
}

async function loadMarket() {
  if (marketData || marketLoading) return;
  marketLoading = true;
  marketFields.disabled = true;
  marketError.hidden = true;
  marketRetry.hidden = true;
  marketState.textContent = "Loading and validating monthly market data...";
  try {
    const response = await fetch("assets/market/monthly.json");
    if (!response.ok) throw new Error(`Market data download failed (HTTP ${response.status}).`);
    const data = MarketModel.validate(await response.json());
    marketData = data;
    for (const m of data.metrics) marketMetric.add(new Option(m.label, m.id));
    marketMetric.value = data.defaults.metric;
    marketOptions(true);
    marketFields.disabled = false;
  } catch (error) {
    console.error("Market loading failed", error);
    marketData = null;
    marketMetric.replaceChildren();
    marketGeography.replaceChildren();
    marketState.textContent = "Monthly market data is unavailable.";
    marketError.textContent = `${error.message} Retry to download and validate the snapshot again.`;
    marketError.hidden = false;
    marketRetry.hidden = false;
  } finally {
    marketLoading = false;
  }
}

marketMetric.addEventListener("change", () => marketOptions(true));
for (const field of [marketGeography, marketStart, marketEnd]) field.addEventListener("change", () => renderMarket());
marketRetry.addEventListener("click", loadMarket);
