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
const incomeDataset = document.getElementById("income-dataset");
let householdScale = incomeScale.value;
let incomePreviousDataset = incomeDataset.value;
let originDestinationScale = "tract";
const incomeNumber = (value) => value.toLocaleString("en-US");

function incomeNode(tag, text, parent, attributes = {}) {
  const svg = tag === "svg" || parent?.namespaceURI === "http://www.w3.org/2000/svg";
  const node = svg ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  if (text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

function incomePopup(feature, reference = null) {
  const p = feature.properties;
  const wrapper = incomeNode("div", null, null, { class: "income-popup-content" });
  const aggregated = Boolean(p.scale);
  const name = aggregated ? p.name : `${p.borough}: Block Group ${p.block_group}, Tract ${p.tract}`;
  const moeLabel = aggregated ? "approximate 90% MOE" : "90% MOE";
  const overlay = p.scale === "neighborhood" && p.geoid !== "MN0801-RI" ? reference : null;
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
  const layout = IncomeModel.areaLayout(p.bins, overlay?.bins);
  incomeNode("text", "Number of households", svg, { x: 76, y: 20, class: "income-axis-title" });
  for (const value of layout.ticks) {
    const y = 242 - value / layout.ceiling * 205;
    incomeNode("line", null, svg, { x1: 76, x2: 764, y1: y, y2: y, class: "income-grid-line" });
    incomeNode("text", incomeNumber(value), svg, { x: 64, y: y + 4, "text-anchor": "end" });
  }
  const series = [{ data: p, color: "#0035ff", layout }];
  if (overlay) {
    series.push({ data: overlay, color: "#E86F16", layout: IncomeModel.areaLayout(overlay.bins, p.bins) });
  }
  for (const item of series) {
    incomeNode("path", null, svg, { d: item.layout.area, fill: item.color, "fill-opacity": 0.55,
      class: "income-area-fill" });
  }
  for (const item of series) {
    incomeNode("path", null, svg, { d: item.layout.line, fill: "none", stroke: item.color, "stroke-width": 2.5,
      "stroke-linejoin": "round", "stroke-linecap": "round", class: "income-area-line",
      "stroke-dasharray": item.data === overlay ? "6 3" : "none" });
    item.data.bins.forEach((bin, index) => {
      const point = item.layout.points[index];
      const marker = incomeNode("circle", null, svg, {
        cx: point.x, cy: point.y, r: 4, fill: "#fff", stroke: item.color, "stroke-width": 2,
        tabindex: "0", "aria-label": `${item.data.name} — ${bin.label}: ${incomeNumber(bin.estimate)} +/- ${incomeNumber(bin.moe)} households`,
      });
      incomeNode("title", `${item.data.name} — ${bin.label}: ${incomeNumber(bin.estimate)} +/- ${incomeNumber(bin.moe)} (${item.data.scale ? "approximate 90% MOE" : "90% MOE"})`, marker);
    });
  }
  if (overlay) {
    const legend = incomeNode("div", null, chart, { class: "income-chart-legend", "aria-label": "Chart series" });
    for (const item of series) {
      const label = incomeNode("span", null, legend);
      incomeNode("span", null, label, { class: item.data === overlay ? "income-legend-reference" : "income-legend-selected",
        "aria-hidden": "true" });
      incomeNode("span", item.data.name, label);
    }
    incomeNode("p", "Both series show household counts on the same axis, not percentages. Roosevelt Island is the orange dashed reference.", chart);
  }
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
      incomeNode("p", p.custom_neighborhood
        ? "Custom neighborhood split of NTA MN0801: Roosevelt Island is tracts 238.02, 238.03 and 238.04; Upper East Side-Lenox Hill is the remainder. Not an official NTA boundary."
        : "2020 Neighborhood Tabulation Area (NTA), including special areas; not an informal neighborhood boundary.", details);
    }
  }
  const table = incomeNode("table", null, details, { class: "income-popup-table" });
  incomeNode("caption", `Estimates and ${aggregated ? "approximate " : ""}90% margins of error (households)`, table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  const headers = ["Household income band", "Households", "+/- MOE"];
  if (overlay) headers.push("Roosevelt Island households", "RI +/- MOE (approx.)");
  headers.forEach((label) => incomeNode("th", label, head, { scope: "col" }));
  const body = incomeNode("tbody", null, table);
  for (const [i, bin] of p.bins.entries()) {
    const row = incomeNode("tr", null, body);
    incomeNode("th", bin.label, row, { scope: "row" });
    incomeNode("td", incomeNumber(bin.estimate), row);
    incomeNode("td", incomeNumber(bin.moe), row);
    if (overlay) {
      incomeNode("td", incomeNumber(overlay.bins[i].estimate), row);
      incomeNode("td", incomeNumber(overlay.bins[i].moe), row);
    }
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
  const od = incomeData?.metadata.dataset === "lodes_origin_destination";
  if (od) {
    clearOriginDestination();
    const nta = incomeData.metadata.scale === "neighborhood";
    document.getElementById("income-state").textContent = `${incomeNumber(incomeData.features.length)} origin ${nta ? "NTA areas" : "tracts"} loaded. Select ${nta ? "an NTA" : "a tract"} to show its NYC connections.`;
  }
  map.closePopup();
  map.setMinZoom(9);
  map.setMaxBounds((od ? originDestinationBounds() : incomeHomeBounds).pad(0.5));
  map.invalidateSize();
  map.fitBounds(incomeHomeBounds, { padding: [24, 24], animate: false });
}

function openIncomeArea(geoid) {
  const layer = incomeAreaLayers.get(geoid);
  if (!layer) throw new Error(`Unknown income area ${geoid}`);
  if (incomeData?.metadata.dataset === "lodes_origin_destination") {
    selectOriginDestination(geoid);
    return;
  }
  incomeSelector.value = geoid;
  map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 15, animate: false });
  layer.openPopup();
}

async function loadIncome() {
  const request = ++incomeRequest;
  if (incomeController) incomeController.abort();
  incomeController = new AbortController();
  const scale = incomeScale.value;
  const transport = incomeDataset.value === "transport";
  const od = incomeDataset.value === "od";
  if ((transport && scale !== "tract") || (od && !["tract", "neighborhood"].includes(scale))) {
    throw new Error("Unsupported geography for this dataset.");
  }
  const cacheKey = od ? `od:${scale}` : transport ? "transport:tract" : scale;
  const datasetLabel = od ? "origin-destination" : transport ? "transportation" : "household income";
  const definition = IncomeModel.scales[scale];
  const state = document.getElementById("income-state");
  const retry = document.getElementById("income-retry");
  state.textContent = `Loading NYC ${definition.plural} ${datasetLabel}...`;
  document.querySelector(".map-shell").setAttribute("aria-label",
    `Interactive ${datasetLabel} map of NYC ${definition.plural}`);
  retry.hidden = true;
  incomeSelector.disabled = true;
  document.getElementById("od-show-all").disabled = true;
  document.getElementById("od-show-all-control").hidden = !(od && scale === "neighborhood");
  map.closePopup();
  if (incomeData?.metadata.dataset === "lodes_origin_destination") clearOriginDestination();
  incomeGroup.clearLayers();
  incomeAreaLayers.clear();
  incomeData = null;
  incomeHomeBounds = null;
  incomeSelector.replaceChildren(incomeNode("option", "Loading areas...", null, { value: "" }));
  document.getElementById("income-area-label").textContent = `Open a ${definition.label.toLowerCase()}`;
  try {
    let data = incomeCache.get(cacheKey);
    if (!data) {
      const fetchData = async (file) => {
        const response = await fetch(`assets/income/${file}?v=data-od-v3`, {
          cache: "no-cache", signal: incomeController.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      };
      if (od) {
        const [payload, boundaries] = await Promise.all([
          fetchData(scale === "neighborhood" ? "origin-destination-nta.json" : "origin-destination.json"),
          fetchData(`od-boundaries-${scale}.json`),
        ]);
        data = OriginDestinationModel.normalize(payload, scale);
        data = { ...data, boundaries: OriginDestinationModel.normalizeBoundaries(boundaries, data, scale) };
      } else if (transport) {
        const [payload, geography] = await Promise.all([
          fetchData("transport-tracts.json"),
          incomeCache.has("tract") ? incomeCache.get("tract") : fetchData(definition.file),
        ]);
        data = TransportModel.normalize(payload, IncomeModel.normalizeAreas(geography, "tract"));
      } else {
        data = IncomeModel.normalizeAreas(await fetchData(definition.file), scale);
      }
      if (request !== incomeRequest) return;
      incomeCache.set(cacheKey, data);
    }
    if (request !== incomeRequest) return;
    const reference = !od && scale === "neighborhood"
      ? data.features.find((feature) => feature.properties.geoid === "MN0801-RI")?.properties : null;
    if (!od && scale === "neighborhood" && !reference) throw new Error("Missing Roosevelt Island neighborhood reference.");
    L.geoJSON(data, {
      renderer: L.canvas({ padding: 0.3 }),
      style: incomeMapStyle,
      onEachFeature(feature, layer) {
        const p = feature.properties;
        const label = p.scale ? p.name : `${p.borough} ${p.name}`;
        if (od) {
          layer.bindTooltip(`${label} - ${p.nta_name}: ${incomeNumber(p.total)} NYC primary-job links`);
          layer.on("click", () => { selectOriginDestination(p.geoid); });
          incomeAreaLayers.set(p.geoid, layer);
          return;
        }
        layer.bindTooltip(`${label}${p.total === 0 ? ` — No estimated ${transport ? "workers with earnings" : "households"}` : ""}`);
        layer.bindPopup(() => {
          const options = layer.getPopup().options;
          options.minWidth = options.maxWidth = Math.min(transport ? 1120 : 820, Math.max(230, map.getSize().x - 70));
          options.maxHeight = Math.max(180, Math.min(620, map.getSize().y - 90));
          return transport ? transportPopup(feature) : incomePopup(feature, reference);
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
    if (od) {
      const { min_link_width_px: minimum, max_link_width_px: maximum } = data.metadata.display;
      document.getElementById("od-width-legend").textContent =
        `Fixed square-root scale across origins at this geography (${incomeNumber(data.metadata.max_pair_jobs)} links at maximum size): ${minimum}-${maximum} px lines and ${data.metadata.display.min_node_radius_px}-${data.metadata.display.max_node_radius_px} px destination radii. Larger counts give thicker lines and larger nodes; exact counts are in tooltips and the table.`;
    }
    incomeSelector.disabled = false;
    document.getElementById("od-show-all").disabled = !(od && scale === "neighborhood");
    if (document.body.dataset.mode === "income") {
      incomeGroup.addTo(map);
      fitIncomeMap();
    }
    state.textContent = od
      ? `${incomeNumber(data.features.length)} origin ${scale === "neighborhood" ? "NTA areas" : "tracts"} loaded. Select an area to show its NYC connections.`
      : `${incomeNumber(data.features.length)} NYC ${definition.plural} loaded. Click a polygon or choose an area.`;
  } catch (error) {
    if (request !== incomeRequest || error.name === "AbortError") return;
    if (od) clearOriginDestination();
    map.removeLayer(incomeGroup);
    incomeGroup.clearLayers();
    incomeAreaLayers.clear();
    incomeData = null;
    incomeHomeBounds = null;
    incomeSelector.replaceChildren();
    state.textContent = `Data unavailable: ${error.message}. No ${definition.plural} displayed.`;
    retry.hidden = false;
    console.error("Data load failed", error);
  }
}

incomeScale.addEventListener("change", loadIncome);
incomeDataset.addEventListener("change", () => {
  const transport = incomeDataset.value === "transport";
  const od = incomeDataset.value === "od";
  const nonHousehold = transport || od;
  if (incomePreviousDataset === "household") householdScale = incomeScale.value;
  if (incomePreviousDataset === "od") originDestinationScale = incomeScale.value;
  incomeScale.value = od ? originDestinationScale : transport ? "tract" : householdScale;
  incomeScale.disabled = transport;
  for (const option of incomeScale.options ?? []) {
    option.disabled = od ? !["tract", "neighborhood"].includes(option.value) : transport && option.value !== "tract";
  }
  incomePreviousDataset = incomeDataset.value;
  document.querySelectorAll("[data-household-copy]").forEach((node) => { node.hidden = nonHousehold; });
  document.getElementById("transport-source-note").hidden = !transport;
  document.getElementById("od-source-note").hidden = !od;
  document.getElementById("od-controls").hidden = !od;
  document.getElementById("nhgis-citation").hidden = od;
  document.getElementById("data-source-eyebrow").textContent = od ? "DATA / LODES 2023" : "DATA / ACS 2024";
  loadIncome();
});
incomeSelector.addEventListener("change", () => {
  if (incomeSelector.value) openIncomeArea(incomeSelector.value);
  else if (incomeData?.metadata.dataset === "lodes_origin_destination") fitIncomeMap();
});
document.getElementById("income-retry").addEventListener("click", loadIncome);
