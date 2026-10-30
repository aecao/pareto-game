"use strict";

let incomeData = null;
const incomeGroup = L.featureGroup();
const incomeAreaRenderer = L.canvas({ padding: 0.3 });
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
let destinationOriginScale = "neighborhood";
let jobsIndustryScale = "neighborhood";
let populationScale = "neighborhood";
let originDestinationMinimum = 1;
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

function incomeMapStyle(feature, metadata = incomeData?.metadata) {
  if (feature.properties.dataset === "population") {
    return { color: "#52677e", weight: 0.5,
      fillColor: PopulationModel.color(feature.properties.density, metadata), fillOpacity: 0.8 };
  }
  if (feature.properties.dataset === "jobs") {
    return { color: "#777", weight: 0.6, fillColor: "#fff", fillOpacity: 0.02 };
  }
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
    document.getElementById("income-state").textContent = `${incomeNumber(incomeData.features.length)} ${incomeData.metadata.direction ? "workplace" : "origin"} ${nta ? "NTA areas" : "tracts"} loaded. Select ${nta ? "an NTA" : "a tract"} to show its NYC connections.`;
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
  if (incomeData?.metadata.dataset !== "population") {
    map.fitBounds(layer.getBounds(), { padding: [20, 20], maxZoom: 15, animate: false });
  }
  layer.openPopup();
}

function jobsIndustryLegend(data) {
  const mode = document.getElementById("jobs-classification").value;
  const definition = JobsIndustryModel.classification(data.metadata, mode);
  const legend = document.getElementById("jobs-industry-legend");
  legend.replaceChildren();
  for (const group of Object.values(definition.groups)) {
    const item = incomeNode("p", null, legend);
    incomeNode("span", "\u25cf ", item, { style: `color:${group.color}`, "aria-hidden": "true" });
    incomeNode("span", group.label, item);
  }
  document.getElementById("jobs-classification-note").textContent = definition.proportional
    ? `Dots are split by exact category job counts. One dot per 10 jobs within each category; smaller remainder dots preserve small categories.${mode === "earnings" ? " Earnings are monthly job earnings, not household income." : ""}`
    : "All jobs in each area use its dominant category color, including jobs in other categories. Ties use the first category ID. Click an area for exact counts.";
}

async function loadIncome() {
  const request = ++incomeRequest;
  if (incomeController) incomeController.abort();
  incomeController = new AbortController();
  const scale = incomeScale.value;
  const transport = incomeDataset.value === "transport";
  const reverse = incomeDataset.value === "do";
  const jobs = incomeDataset.value === "jobs";
  const population = incomeDataset.value === "population";
  const od = incomeDataset.value === "od" || reverse;
  if ((transport && scale !== "tract") || ((od || jobs) && !["tract", "neighborhood"].includes(scale)) ||
      (population && !["block_group", "tract", "neighborhood"].includes(scale))) {
    throw new Error("Unsupported geography for this dataset.");
  }
  const cacheKey = od || jobs || population ? `${incomeDataset.value}:${scale}` : transport ? "transport:tract" : scale;
  const datasetLabel = population ? "population density" : jobs ? "jobs/industry" : reverse ? "destination-origin" : od ? "origin-destination" : transport ? "transportation" : "household income";
  const definition = IncomeModel.scales[scale];
  const state = document.getElementById("income-state");
  const retry = document.getElementById("income-retry");
  state.textContent = `Loading NYC ${definition.plural} ${datasetLabel}...`;
  document.querySelector(".map-shell").setAttribute("aria-label",
    `Interactive ${datasetLabel} map of NYC ${definition.plural}`);
  retry.hidden = true;
  incomeSelector.disabled = true;
  document.getElementById("od-threshold").disabled = true;
  document.getElementById("od-threshold").value = "0";
  document.getElementById("od-threshold-number").disabled = true;
  document.getElementById("od-threshold-number").value = "1";
  document.getElementById("od-threshold-number").setAttribute("aria-invalid", "false");
  document.getElementById("od-threshold-error").textContent = "";
  document.getElementById("od-threshold-value").textContent = "1";
  originDestinationMinimum = 1;
  document.getElementById("od-show-all").disabled = true;
  document.getElementById("od-show-all-control").hidden = !(od && !reverse && scale === "neighborhood");
  document.getElementById("od-direction-help").hidden = !reverse;
  document.getElementById("od-forward-legend").hidden = reverse;
  map.closePopup();
  if (incomeData?.metadata.dataset === "lodes_origin_destination") clearOriginDestination();
  incomeGroup.clearLayers();
  incomeAreaLayers.clear();
  incomeData = null;
  document.getElementById("jobs-classification").disabled = true;
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
      if (population) {
        const [counts, geography] = await Promise.all([
          (async () => {
            const response = await fetch(`assets/population/${scale}.json?v=population-v1`, {
              cache: "no-cache", signal: incomeController.signal,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })(),
          incomeCache.has(scale) ? incomeCache.get(scale) : fetchData(definition.file),
        ]);
        data = PopulationModel.normalize(counts, geography, scale);
      } else if (jobs) {
        const [geometry, categories] = await Promise.all([`${scale}.json`, `categories-${scale}.json`].map(async file => {
          const response = await fetch(`assets/jobs_industry/${file}?v=jobs-v5`, {
            cache: "no-cache", signal: incomeController.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        }));
        data = JobsIndustryModel.withCategories(JobsIndustryModel.normalize(geometry, scale), categories);
      } else if (od) {
        const [payload, boundaries] = await Promise.all([
          fetchData(`${reverse ? "destination-origin" : "origin-destination"}${scale === "neighborhood" ? "-nta" : ""}.json`),
          fetchData(`od-boundaries-${scale}.json`),
        ]);
        data = OriginDestinationModel.normalize(payload, scale, reverse ? "do" : "od");
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
    const reference = !od && !jobs && !population && scale === "neighborhood"
      ? data.features.find((feature) => feature.properties.geoid === "MN0801-RI")?.properties : null;
    if (!od && !jobs && !population && scale === "neighborhood" && !reference) throw new Error("Missing Roosevelt Island neighborhood reference.");
    L.geoJSON(data, {
      renderer: incomeAreaRenderer,
      style: feature => incomeMapStyle(feature, data.metadata),
      onEachFeature(feature, layer) {
        const p = feature.properties;
        const label = p.scale ? p.name : `${p.borough} ${p.name}`;
        if (population) {
          layer.bindTooltip(`${label}: ${p.density === null ? "no land area; density not applicable"
            : `${incomeNumber(Math.round(p.density))} people per land sq mile`}`);
          layer.bindPopup(() => populationPopup(feature), {
            className: "income-popup", maxHeight: 500, minWidth: 260, maxWidth: 420, autoPan: false,
          });
          layer.on("click", () => { incomeSelector.value = p.geoid; });
          incomeAreaLayers.set(p.geoid, layer);
          return;
        }
        if (jobs) {
          layer.bindTooltip(`${label}: ${incomeNumber(p.total)} primary jobs`);
          layer.bindPopup(() => {
            const options = layer.getPopup().options;
            options.minWidth = options.maxWidth = Math.min(420, Math.max(230, map.getSize().x - 70));
            options.maxHeight = Math.max(180, Math.min(620, map.getSize().y - 90));
            return jobsIndustryPopup(feature);
          }, { className: "income-popup" });
          layer.on("click", () => { incomeSelector.value = p.geoid; });
          incomeAreaLayers.set(p.geoid, layer);
          return;
        }
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
    if (population) populationLegend(data);
    if (jobs) {
      jobsIndustryLegend(data);
      document.getElementById("jobs-classification").disabled = false;
      new JobsIndustryLayer(data).addTo(incomeGroup);
    }
    if (od) {
      document.getElementById("od-threshold").max = "1000";
      document.getElementById("od-threshold").disabled = false;
      document.getElementById("od-threshold-number").max = String(data.metadata.max_pair_jobs);
      document.getElementById("od-threshold-number").disabled = false;
      document.getElementById("od-threshold").setAttribute("aria-valuetext", "1 primary-job link per pair");
      const { min_link_width_px: minimum, max_link_width_px: maximum } = data.metadata.display;
      document.getElementById("od-width-legend").textContent =
        `Fixed square-root scale across selected ${reverse ? "workplaces" : "origins"} at this geography (${incomeNumber(data.metadata.max_pair_jobs)} links at maximum size): ${minimum}-${maximum} px lines and ${data.metadata.display.min_node_radius_px}-${data.metadata.display.max_node_radius_px} px linked-node radii. Larger counts give thicker lines and larger nodes; exact counts are in tooltips and the table.`;
    }
    incomeSelector.disabled = false;
    document.getElementById("od-show-all").disabled = !(od && !reverse && scale === "neighborhood");
    if (document.body.dataset.mode === "income") {
      incomeGroup.addTo(map);
      fitIncomeMap();
    }
    state.textContent = population
      ? `${incomeNumber(data.metadata.total_population)} estimated residents across ${incomeNumber(data.features.length)} ${definition.plural}. Darker means greater population per square mile of land.`
      : od
      ? `${incomeNumber(data.features.length)} ${reverse ? "workplace" : "origin"} ${scale === "neighborhood" ? "NTA areas" : "tracts"} loaded. Select an area to show its NYC connections.`
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
  const reverse = incomeDataset.value === "do";
  const jobs = incomeDataset.value === "jobs";
  const population = incomeDataset.value === "population";
  const od = incomeDataset.value === "od" || reverse;
  const nonHousehold = transport || od || jobs || population;
  if (incomePreviousDataset === "household") householdScale = incomeScale.value;
  if (incomePreviousDataset === "od") originDestinationScale = incomeScale.value;
  if (incomePreviousDataset === "do") destinationOriginScale = incomeScale.value;
  if (incomePreviousDataset === "jobs") jobsIndustryScale = incomeScale.value;
  if (incomePreviousDataset === "population") populationScale = incomeScale.value;
  incomeScale.value = population ? populationScale : jobs ? jobsIndustryScale : reverse ? destinationOriginScale : od ? originDestinationScale : transport ? "tract" : householdScale;
  incomeScale.disabled = transport;
  for (const option of incomeScale.options ?? []) {
    option.disabled = population ? !["block_group", "tract", "neighborhood"].includes(option.value)
      : od || jobs ? !["tract", "neighborhood"].includes(option.value) : transport && option.value !== "tract";
  }
  incomePreviousDataset = incomeDataset.value;
  document.querySelectorAll("[data-household-copy]").forEach((node) => { node.hidden = nonHousehold; });
  document.getElementById("transport-source-note").hidden = !transport;
  document.getElementById("od-source-note").hidden = !od || reverse;
  document.getElementById("od-controls").hidden = !od;
  document.getElementById("jobs-industry-controls").hidden = !jobs;
  document.getElementById("population-controls").hidden = !population;
  document.getElementById("nhgis-citation").hidden = od || jobs;
  document.getElementById("data-source-eyebrow").textContent = od || jobs ? "DATA / LODES 2023" : "DATA / ACS 2024";
  loadIncome();
});
incomeSelector.addEventListener("change", () => {
  if (incomeSelector.value) openIncomeArea(incomeSelector.value);
  else if (incomeData?.metadata.dataset === "lodes_origin_destination") fitIncomeMap();
});
document.getElementById("income-retry").addEventListener("click", loadIncome);
