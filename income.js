"use strict";

let incomeData = null;
const incomeGroup = L.featureGroup();
const incomeAreaLayers = new Map();
const incomeCache = new Map();
let incomeHomeBounds = null;
let incomeRequest = 0;
let incomeController = null;
const incomeSelector = document.getElementById("income-block-group");
const incomeScale = document.getElementById("income-scale");
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
  const aggregated = Boolean(p.scale);
  const name = aggregated ? p.name : `${p.borough}: Block Group ${p.block_group}, Tract ${p.tract}`;
  const moeLabel = aggregated ? "approximate 90% MOE" : "90% MOE";
  incomeNode("h2", name, wrapper);
  incomeNode("p", `${aggregated ? IncomeModel.scales[p.scale].label : "GEOID"} ${p.geoid}`, wrapper);
  incomeNode("p", `Households: ${incomeNumber(p.total)} +/- ${incomeNumber(p.total_moe)} (${moeLabel})`, wrapper);
  if (p.total === 0) incomeNode("p", "No estimated households. Shown in grey; reported zeros are not missing data.", wrapper);
  const chart = incomeNode("div", null, wrapper, {
    class: "income-chart", tabindex: "0", role: "region", "aria-label": "Household income chart",
  });
  const svg = incomeNode("svg", null, chart, {
    viewBox: "0 0 800 315", role: "img", "aria-label": `Household income distribution for ${name}`,
  });
  incomeNode("title", `Annual household income (x) and number of households in each source income band (y), ${p.name}`, svg);
  const layout = IncomeModel.areaLayout(p.bins);
  const gradientId = `income-fill-${p.geoid}`;
  const gradient = incomeNode("linearGradient", null, incomeNode("defs", null, svg), {
    id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1",
  });
  incomeNode("stop", null, gradient, { offset: "0%", "stop-color": "#0035ff", "stop-opacity": "0.38" });
  incomeNode("stop", null, gradient, { offset: "100%", "stop-color": "#0035ff", "stop-opacity": "0.04" });
  incomeNode("text", "Number of households", svg, { x: 76, y: 20, class: "income-axis-title" });
  for (const value of layout.ticks) {
    const y = 242 - value / layout.ceiling * 205;
    incomeNode("line", null, svg, { x1: 76, x2: 764, y1: y, y2: y, class: "income-grid-line" });
    incomeNode("text", incomeNumber(value), svg, { x: 64, y: y + 4, "text-anchor": "end" });
  }
  incomeNode("path", null, svg, { d: layout.area, fill: `url(#${gradientId})`, class: "income-area-fill" });
  incomeNode("path", null, svg, { d: layout.line, fill: "none", stroke: "#0035ff", "stroke-width": 2.5,
    "stroke-linejoin": "round", "stroke-linecap": "round", class: "income-area-line" });
  p.bins.forEach((bin, index) => {
    const point = layout.points[index];
    const marker = incomeNode("circle", null, svg, {
      cx: point.x, cy: point.y, r: 4, fill: "#fff", stroke: "#0035ff", "stroke-width": 2,
      tabindex: "0", "aria-label": `${bin.label}: ${incomeNumber(bin.estimate)} +/- ${incomeNumber(bin.moe)} households`,
    });
    incomeNode("title", `${bin.label}: ${incomeNumber(bin.estimate)} +/- ${incomeNumber(bin.moe)} (${moeLabel})`, marker);
  });
  for (const value of layout.incomeTicks) {
    const x = 76 + value / 200000 * 688;
    incomeNode("line", null, svg, { x1: x, x2: x, y1: 242, y2: 248, stroke: "#aaa" });
    incomeNode("text", value === 0 ? "$0" : `$${value / 1000}k${value === 200000 ? "+" : ""}`, svg,
      { x, y: 266, "text-anchor": "middle" });
  }
  incomeNode("text", "Annual household income (2024 dollars)", svg,
    { x: 420, y: 300, "text-anchor": "middle", class: "income-axis-title" });
  incomeNode("p", "Grouped ACS estimates, not exact-dollar measurements. Points mark band midpoints; the open-ended lowest and $200k+ groups sit at the chart ends. Unequal-width band counts are connected for display, not a continuous density.", wrapper);
  const details = incomeNode("details", null, wrapper, { class: "income-data-details" });
  incomeNode("summary", "Source ranges, estimates & uncertainty", details);
  incomeNode("p", "2020-2024 ACS B19001 via IPUMS NHGIS. These are households, not people. The line and fill retain all 16 source estimates; no within-band incomes are inferred.", details);
  if (aggregated) {
    incomeNode("p", `Sum of ${incomeNumber(p.member_count)} whole block groups. Approximate margins of error use the square root of summed squared source MOEs, rounded up; covariance is unavailable. These are not independently published ACS estimates for this area.`, details);
    if (p.scale === "community_district") {
      incomeNode("p", "CDTA: a 2020 census approximation of a community district, not its exact legal boundary. Joint Interest Areas are retained.", details);
    } else if (p.scale === "neighborhood") {
      incomeNode("p", "2020 Neighborhood Tabulation Area (NTA), including special areas; not an informal neighborhood boundary.", details);
    }
  }
  const table = incomeNode("table", null, details, { class: "income-popup-table" });
  incomeNode("caption", `Estimates and ${aggregated ? "approximate " : ""}90% margins of error (households)`, table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  ["Household income band", "Households", "+/- MOE"].forEach((label) => incomeNode("th", label, head, { scope: "col" }));
  const body = incomeNode("tbody", null, table);
  for (const bin of p.bins) {
    const row = incomeNode("tr", null, body);
    incomeNode("th", bin.label, row, { scope: "row" });
    incomeNode("td", incomeNumber(bin.estimate), row);
    incomeNode("td", incomeNumber(bin.moe), row);
  }
  incomeNode("p", aggregated
    ? "Boundaries are unions of source block-group polygons. 2020 tract/NTA/CDTA relationships are used without clipping or allocating households. NTAs/CDTAs can cross borough lines; borough totals use the source county. ACS is a survey, not an exact census count."
    : "Whole block-group estimates; no filtering or allocation. Original source margins of error are retained. ACS is a survey, not an exact census count.", details);
  return wrapper;
}

function incomeMapStyle(feature) {
  const noHouseholds = feature.properties.total === 0;
  return {
    color: noHouseholds ? "#777" : "#0035ff", weight: 0.7,
    fillColor: noHouseholds ? "#bdbdbd" : "#dfe8ff", fillOpacity: 0.55,
  };
}

function fitIncomeMap() {
  if (!incomeHomeBounds) throw new Error("Income bounds have not loaded.");
  map.closePopup();
  map.setMinZoom(9);
  map.setMaxBounds(incomeHomeBounds.pad(0.5));
  map.invalidateSize();
  map.fitBounds(incomeHomeBounds, { padding: [24, 24], animate: false });
}

function openIncomeArea(geoid) {
  const layer = incomeAreaLayers.get(geoid);
  if (!layer) throw new Error(`Unknown income area ${geoid}`);
  incomeSelector.value = geoid;
  map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 15, animate: false });
  layer.openPopup();
}

async function loadIncome() {
  const request = ++incomeRequest;
  if (incomeController) incomeController.abort();
  incomeController = new AbortController();
  const scale = incomeScale.value;
  const definition = IncomeModel.scales[scale];
  const state = document.getElementById("income-state");
  const retry = document.getElementById("income-retry");
  state.textContent = `Loading NYC ${definition.plural} household income...`;
  retry.hidden = true;
  incomeSelector.disabled = true;
  map.closePopup();
  incomeGroup.clearLayers();
  incomeAreaLayers.clear();
  incomeData = null;
  incomeHomeBounds = null;
  incomeSelector.replaceChildren(incomeNode("option", "Loading areas...", null, { value: "" }));
  document.getElementById("income-area-label").textContent = `Open a ${definition.label.toLowerCase()}`;
  try {
    let data = incomeCache.get(scale);
    if (!data) {
      const response = await fetch(`assets/income/${definition.file}?v=income-scales-v2`, {
        cache: "no-cache", signal: incomeController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = IncomeModel.normalizeAreas(await response.json(), scale);
      incomeCache.set(scale, data);
    }
    if (request !== incomeRequest) return;
    L.geoJSON(data, {
      renderer: L.canvas({ padding: 0.3 }),
      style: incomeMapStyle,
      onEachFeature(feature, layer) {
        const p = feature.properties;
        const label = p.scale ? p.name : `${p.borough} ${p.name}`;
        layer.bindTooltip(`${label}${p.total === 0 ? " — No estimated households" : ""}`);
        layer.bindPopup(() => {
          const options = layer.getPopup().options;
          options.minWidth = options.maxWidth = Math.min(820, Math.max(230, map.getSize().x - 70));
          options.maxHeight = Math.max(180, Math.min(620, map.getSize().y - 90));
          return incomePopup(feature);
        }, {
          className: "income-popup",
        });
        layer.on("click", () => { incomeSelector.value = p.geoid; });
        incomeAreaLayers.set(p.geoid, layer);
      },
    }).addTo(incomeGroup);
    incomeHomeBounds = incomeGroup.getBounds();
    if (!incomeHomeBounds.isValid()) throw new Error("No usable income-area bounds.");
    incomeSelector.replaceChildren(incomeNode("option", `Choose a ${definition.label.toLowerCase()}`, null, { value: "" }));
    const sorted = [...data.features].sort((a, b) => a.properties.borough.localeCompare(b.properties.borough)
      || a.properties.name.localeCompare(b.properties.name, "en", { numeric: true }));
    for (const { properties: p } of sorted) {
      const label = scale === "block_group"
        ? `${p.borough}: Tract ${p.tract}, BG ${p.block_group} (${p.geoid})`
        : `${p.name} (${p.geoid})`;
      incomeSelector.append(incomeNode("option", label, null, { value: p.geoid }));
    }
    incomeData = data;
    incomeSelector.disabled = false;
    if (document.body.dataset.mode === "income") {
      incomeGroup.addTo(map);
      fitIncomeMap();
    }
    state.textContent = `${incomeNumber(data.features.length)} NYC ${definition.plural} loaded. Click a polygon or choose an area.`;
  } catch (error) {
    if (request !== incomeRequest || error.name === "AbortError") return;
    map.removeLayer(incomeGroup);
    incomeGroup.clearLayers();
    incomeAreaLayers.clear();
    incomeData = null;
    incomeHomeBounds = null;
    incomeSelector.replaceChildren();
    state.textContent = `Income unavailable: ${error.message}. No ${definition.plural} displayed.`;
    retry.hidden = false;
    console.error("Income load failed", error);
  }
}

incomeScale.addEventListener("change", loadIncome);
incomeSelector.addEventListener("change", () => { if (incomeSelector.value) openIncomeArea(incomeSelector.value); });
document.getElementById("income-retry").addEventListener("click", loadIncome);
