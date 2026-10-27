"use strict";

let incomeData = null;
const incomeGroup = L.featureGroup();
const incomeTractLayers = new Map();
let incomeHomeBounds = null;
let incomeLoading = false;
const incomeSelector = document.getElementById("income-tract");
const incomeNumber = (value) => value.toLocaleString("en-US");

function incomeNode(tag, text, parent, attributes = {}) {
  const svg = tag === "svg" || parent?.namespaceURI === "http://www.w3.org/2000/svg";
  const node = svg ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  if (text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

function incomePopup(feature) {
  const p = feature.properties;
  const wrapper = incomeNode("div", null, null, { class: "income-popup-content" });
  incomeNode("h2", `${p.borough} ${p.name}`, wrapper);
  incomeNode("p", `GEOID ${p.geoid} | ${p.districts.map((code) => IncomeModel.districtNames[code]).join(", ")}`, wrapper);
  incomeNode("p", `People age 15+: ${incomeNumber(p.total)} +/- ${incomeNumber(p.total_moe)} (90% MOE)`, wrapper);
  incomeNode("p", `${(p.overlap_share * 100).toFixed(2)}% of tract area is inside the district union. ` +
    `${p.partial_overlap ? "Partial overlap. " : ""}Counts cover the WHOLE tract, not just its district portion.`, wrapper);
  const scroll = incomeNode("div", null, wrapper, {
    class: "income-chart-scroll", tabindex: "0", role: "region", "aria-label": "Scrollable income chart",
  });
  const svg = incomeNode("svg", null, scroll, {
    viewBox: "0 0 790 335", role: "img", "aria-label": `Individual income distribution for ${p.geoid}`,
  });
  incomeNode("title", `Income bands (x) and estimated people age 15+ (y), ${p.borough} ${p.name}`, svg);
  const layout = IncomeModel.chartLayout(p.bins);
  incomeNode("text", "Estimated people age 15+", svg, { x: 65, y: 20 });
  for (const value of layout.ticks) {
    const y = 215 - value / layout.ceiling * 180;
    incomeNode("line", null, svg, { x1: 65, x2: 780, y1: y, y2: y, stroke: "#ddd" });
    incomeNode("text", incomeNumber(value), svg, { x: 57, y: y + 4, "text-anchor": "end" });
  }
  p.bins.forEach((bin, index) => {
    const x = 70 + index * 79;
    const rect = incomeNode("rect", null, svg, {
      x, y: 215 - layout.heights[index], width: 65, height: layout.heights[index], fill: "#0035ff",
      tabindex: "0", "aria-label": `${bin.label}: ${incomeNumber(bin.estimate)} +/- ${incomeNumber(bin.moe)} people`,
    });
    incomeNode("title", `${bin.label}: ${incomeNumber(bin.estimate)} +/- ${incomeNumber(bin.moe)} (90% MOE)`, rect);
    const lines = bin.label === "No income" ? ["No income"] :
      bin.label === "$1 to $9,999 or loss" ? ["$1 to", "$9,999", "or loss"] :
        bin.label === "$75,000 or more" ? ["$75,000", "or more"] : bin.label.split(" to ").map((part, i) => i ? part : `${part} to`);
    const label = incomeNode("text", null, svg, { x: x + 32, y: 235, "text-anchor": "middle" });
    lines.forEach((line, i) => incomeNode("tspan", line, label, { x: x + 32, dy: i ? 16 : 0 }));
  });
  incomeNode("text", "Individual annual income (2024 dollars; categorical bands, unequal widths)", svg,
    { x: 420, y: 310, "text-anchor": "middle" });
  incomeNode("p", "2020-2024 ACS B06010. $75,000+ is open-ended. No income is separate from loss/low income. Bar heights are estimates; uncertainty is listed below.", wrapper);
  const table = incomeNode("table", null, wrapper, { class: "income-popup-table" });
  incomeNode("caption", "Estimates and 90% margins of error (people)", table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  ["Income band", "People", "+/- MOE"].forEach((label) => incomeNode("th", label, head, { scope: "col" }));
  const body = incomeNode("tbody", null, table);
  for (const bin of p.bins) {
    const row = incomeNode("tr", null, body);
    incomeNode("th", bin.label, row, { scope: "row" });
    incomeNode("td", incomeNumber(bin.estimate), row);
    incomeNode("td", incomeNumber(bin.moe), row);
  }
  incomeNode("p", "Margins of error are not added together. Area includes water and is not population weighted. ACS is a survey, not an exact census count.", wrapper);
  return wrapper;
}

function fitIncomeMap() {
  if (!incomeHomeBounds) throw new Error("Income bounds have not loaded.");
  map.closePopup();
  map.setMinZoom(9);
  map.setMaxBounds(incomeHomeBounds.pad(0.5));
  map.invalidateSize();
  map.fitBounds(incomeHomeBounds, { padding: [24, 24], animate: false });
}

function openIncomeTract(geoid) {
  const layer = incomeTractLayers.get(geoid);
  if (!layer) throw new Error(`Unknown tract ${geoid}`);
  incomeSelector.value = geoid;
  map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 15, animate: false });
  layer.openPopup();
}

async function loadIncome() {
  if (incomeLoading) return;
  incomeLoading = true;
  const state = document.getElementById("income-state");
  const retry = document.getElementById("income-retry");
  state.textContent = "Loading official ACS tract income data...";
  retry.hidden = true;
  incomeSelector.disabled = true;
  try {
    const response = await fetch("assets/income/tracts.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = IncomeModel.normalize(await response.json());
    incomeGroup.clearLayers();
    incomeTractLayers.clear();
    L.geoJSON(data, {
      style: (feature) => ({
        color: "#0035ff", weight: 1, fillColor: feature.properties.partial_overlap ? "#f0d5b0" : "#dfe8ff",
        fillOpacity: 0.55, dashArray: feature.properties.partial_overlap ? "5 4" : null,
      }),
      onEachFeature(feature, layer) {
        const p = feature.properties;
        layer.bindTooltip(`${p.borough} ${p.name}`);
        layer.bindPopup(() => {
          const options = layer.getPopup().options;
          options.maxWidth = Math.min(800, Math.max(230, map.getSize().x - 55));
          options.maxHeight = Math.max(180, Math.min(620, map.getSize().y - 90));
          return incomePopup(feature);
        }, {
          className: "income-popup",
        });
        layer.on("click", () => { incomeSelector.value = p.geoid; });
        incomeTractLayers.set(p.geoid, layer);
      },
    }).addTo(incomeGroup);
    L.geoJSON(data.districts, {
      interactive: false, style: { color: "#15120f", weight: 2, fill: false, dashArray: "8 5" },
    }).addTo(incomeGroup);
    incomeHomeBounds = incomeGroup.getBounds();
    if (!incomeHomeBounds.isValid()) throw new Error("No usable tract bounds.");
    incomeSelector.replaceChildren(incomeNode("option", "Choose a tract", null, { value: "" }));
    for (const { properties: p } of data.features) {
      incomeSelector.append(incomeNode("option", `${p.borough} ${p.name} (${p.geoid})`, null, { value: p.geoid }));
    }
    incomeData = data;
    incomeSelector.disabled = false;
    if (document.body.dataset.mode === "income") {
      incomeGroup.addTo(map);
      fitIncomeMap();
    }
    state.textContent = `${data.features.length} whole tracts loaded; ${data.features.filter((f) => f.properties.partial_overlap).length} partial overlaps. Click a polygon or choose a tract.`;
  } catch (error) {
    map.removeLayer(incomeGroup);
    incomeGroup.clearLayers();
    incomeTractLayers.clear();
    incomeData = null;
    incomeHomeBounds = null;
    incomeSelector.replaceChildren();
    state.textContent = `Income unavailable: ${error.message}. No tract data displayed.`;
    retry.hidden = false;
    console.error("Income load failed", error);
  } finally {
    incomeLoading = false;
  }
}

incomeSelector.addEventListener("change", () => { if (incomeSelector.value) openIncomeTract(incomeSelector.value); });
document.getElementById("income-retry").addEventListener("click", loadIncome);
