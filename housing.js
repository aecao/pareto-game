"use strict";

const housingSheet = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR6qlE4hFULSfzCQ9ZwbQqA8jIEkcfJMfg8Ro4GulHRZpl9oRDl6ank0QavwYA8U6AFXdJFELQNdP1y/pub?output=csv&gid=";
let housingLoading = false;
const housingMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function housingNode(tag, parent, text, attributes = {}) {
  const node = tag === "svg" || parent.namespaceURI === "http://www.w3.org/2000/svg"
    ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  parent.append(node);
  return node;
}

function renderHousing(data) {
  const host = document.getElementById("housing-chart");
  host.replaceChildren();
  const width = Math.max(1050, data.developments.length * 140 + 160);
  const left = 100, right = width - 60, bottom = 440, top = 65;
  const barWidth = (right - left) / data.developments.length;
  const maximum = Math.max(1, ...data.developments.map((d) => d.total)) * 1.12;
  const svg = housingNode("svg", host, undefined, { viewBox: `0 0 ${width} 620`, role: "img", "aria-label": `${data.period}. Development revenue descending. Full values in table below.` });
  for (let i = 0; i <= 4; i++) {
    const value = maximum * i / 4, y = bottom - (bottom - top) * i / 4;
    housingNode("line", svg, undefined, { x1: left, x2: right, y1: y, y2: y, class: "housing-grid" });
    housingNode("text", svg, housingMoney.format(value), { x: left - 8, y: y + 4, "text-anchor": "end" });
  }
  housingNode("text", svg, "Revenue ($, source period)", { x: left, y: 25 });
  data.developments.forEach((d, index) => {
    const x = left + index * barWidth, center = x + barWidth / 2;
    let sum = 0;
    d.values.forEach((value, component) => {
      const height = value / maximum * (bottom - top);
      const rect = housingNode("rect", svg, undefined, { x, y: bottom - sum - height, width: barWidth, height, fill: HousingModel.components[component].color, class: "housing-revenue" });
      housingNode("title", rect, `${d.name}: ${HousingModel.components[component].label} ${housingMoney.format(value)}`);
      sum += height;
    });
    housingNode("text", svg, housingMoney.format(d.total), { x: center, y: bottom - sum - 10, "text-anchor": "middle", class: "housing-total" });
    const label = housingNode("text", svg, undefined, { x: center, y: bottom + 49, "text-anchor": "middle", class: "housing-name" });
    const words = d.name.split(" ");
    let line = "", lineIndex = 0;
    for (const word of words) {
      if ((line + " " + word).trim().length > 17 && line) {
        housingNode("tspan", label, line, { x: center, dy: lineIndex++ ? 18 : 0 }); line = word;
      } else line = (line + " " + word).trim();
    }
    housingNode("tspan", label, line, { x: center, dy: lineIndex ? 18 : 0 });
  });
  const body = document.getElementById("housing-values");
  body.replaceChildren();
  for (const d of data.developments) {
    const row = housingNode("tr", body);
    housingNode("th", row, d.name, { scope: "row" });
    for (const value of [...d.values, d.total]) housingNode("td", row, housingMoney.format(value));
  }
  document.getElementById("housing-period").textContent = data.period;
  document.getElementById("housing-general").textContent = data.general
    ? `General (unclassified): ${housingMoney.format(data.general.total)}. Excluded from development bars; classification unresolved.`
    : "No General (unclassified) row in the current sheet.";
  document.getElementById("housing-warnings").textContent = data.warnings.join(" ");
  renderHousingUnits(data);
}

function renderHousingUnits(data) {
  const host = document.getElementById("housing-unit-chart"), body = document.getElementById("housing-unit-values");
  host.replaceChildren();
  body.replaceChildren();
  if (!data.unitBuildings.length) {
    housingNode("p", host, "No individual building records available in the source.");
    return;
  }
  const width = Math.max(1050, data.unitBuildings.length * 140 + 140);
  const columns = 10, iconSize = 8, pitch = 11;
  const maximum = Math.max(1, ...data.unitBuildings.map((b) => b.total ?? b.known));
  const bottom = 65 + Math.ceil(maximum / columns) * pitch;
  const left = 70, barWidth = (width - 110) / data.unitBuildings.length;
  const svg = housingNode("svg", host, undefined, { viewBox: `0 0 ${width} ${bottom + 210}`, role: "img",
    "aria-label": "Building unit icon arrays: one square equals one housing unit, ten columns per building. Grouped by development then building number. Missing categories remain unknown; full source values in the table below." });
  housingNode("text", svg, "1 square = 1 housing unit / 10 columns per building", { x: left, y: 25 });
  data.unitBuildings.forEach((b, index) => {
    const x = left + index * barWidth, center = x + barWidth / 2;
    const values = [...b.values, b.remainder];
    let unitsDrawn = 0;
    values.forEach((value, component) => {
      if (value === null || value === 0) return;
      const group = housingNode("g", svg, undefined, { class: "housing-unit-category",
        "data-building": b.name, "data-category": component });
      housingNode("title", group, `${b.displayName}, ${b.address || "Address unknown"}: ${HousingModel.unitComponents[component].label}: ${value} units. Each square represents one unit.`);
      for (let unit = 0; unit < value; unit++, unitsDrawn++) {
        housingNode("rect", group, undefined, {
          x: center - ((columns - 1) * pitch + iconSize) / 2 + (unitsDrawn % columns) * pitch,
          y: bottom - Math.floor(unitsDrawn / columns) * pitch - iconSize,
          width: iconSize, height: iconSize, rx: 1,
          fill: HousingModel.unitComponents[component].color, class: "housing-unit-icon",
        });
      }
    });
    housingNode("text", svg, b.total === null ? (b.known ? `${b.known}+ known` : "Units unknown") : `${b.total}`,
      { x: center, y: bottom - Math.ceil(unitsDrawn / columns) * pitch - 12, "text-anchor": "middle", class: "housing-total" });
    const label = housingNode("text", svg, undefined, { x: center, y: bottom + 25, "text-anchor": "middle", class: "housing-building-name" });
    const words = b.displayName.split(" ");
    let line = "", lines = [];
    for (const word of words) {
      if ((line + " " + word).trim().length > 18 && line) { lines.push(line); line = word; }
      else line = (line + " " + word).trim();
    }
    lines.push(line);
    lines.forEach((text, i) => housingNode("tspan", label, text, { x: center, dy: i ? 17 : 0 }));
    const address = housingNode("text", svg, undefined, { x: center, y: bottom + 65, "text-anchor": "middle", class: "housing-building-address" });
    const addressWords = (b.address || "Address unknown").split(" ");
    let addressLine = "", addressLines = [];
    for (const word of addressWords) {
      if ((addressLine + " " + word).trim().length > 19 && addressLine) { addressLines.push(addressLine); addressLine = word; }
      else addressLine = (addressLine + " " + word).trim();
    }
    addressLines.push(addressLine);
    addressLines.forEach((text, i) => housingNode("tspan", address, text, { x: center, dy: i ? 16 : 0 }));
    housingNode("text", svg, b.values.some((v) => v === null) ? "Mix incomplete" : "Mix reported",
      { x: center, y: bottom + 105, "text-anchor": "middle" });
    if (index === 0 || data.unitBuildings[index - 1].development !== b.development) {
      const count = data.unitBuildings.filter((item) => item.development === b.development).length;
      housingNode("line", svg, undefined, { x1: x, x2: x + count * barWidth, y1: bottom + 132, y2: bottom + 132, stroke: "#15120f" });
      housingNode("text", svg, b.development, { x: x + count * barWidth / 2, y: bottom + 154, "text-anchor": "middle", class: "housing-name" });
    }
    const row = housingNode("tr", body);
    const buildingCell = housingNode("th", row, undefined, { scope: "row" });
    housingNode("span", buildingCell, b.displayName);
    housingNode("small", buildingCell, b.address || "Address unknown", { class: "housing-table-address" });
    housingNode("td", row, b.development);
    b.values.forEach((value, i) => housingNode("td", row, value === null ? `Unknown${b.raw[i] ? ` (${b.raw[i]})` : " (blank)"}` : String(value)));
    housingNode("td", row, b.total === null ? "Unknown" : String(b.total));
    housingNode("td", row, b.remainder === null ? "Unknown total" : String(b.remainder));
  });
}

async function loadHousing() {
  if (housingLoading) return;
  housingLoading = true;
  const state = document.getElementById("housing-state"), button = document.getElementById("housing-refresh");
  button.disabled = true;
  state.textContent = "Loading both live published tabs...";
  document.getElementById("housing-chart").replaceChildren();
  document.getElementById("housing-values").replaceChildren();
  document.getElementById("housing-unit-chart").replaceChildren();
  document.getElementById("housing-unit-values").replaceChildren();
  for (const id of ["housing-period", "housing-general", "housing-warnings"]) document.getElementById(id).textContent = "";
  try {
    const texts = await Promise.all(["2081099550", "898231653"].map(async (gid) => {
      const response = await fetch(housingSheet + gid, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Sheet HTTP ${response.status}.`);
      return response.text();
    }));
    const data = HousingModel.parse(...texts);
    renderHousing(data);
    state.textContent = `${data.developments.length} developments. Retrieved ${new Date().toLocaleString()}. Google publication may lag edits.`;
  } catch (error) {
    document.getElementById("housing-chart").replaceChildren();
    document.getElementById("housing-values").replaceChildren();
    document.getElementById("housing-unit-chart").replaceChildren();
    document.getElementById("housing-unit-values").replaceChildren();
    state.textContent = `Housing unavailable: ${error.message} No chart shown. Use Refresh to retry.`;
    console.error("Housing load failed", error);
  } finally {
    housingLoading = false;
    button.disabled = false;
  }
}

document.getElementById("housing-refresh").addEventListener("click", loadHousing);
