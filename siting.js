"use strict";

const sitingForm = document.getElementById("siting-form");
const sitingFields = document.getElementById("siting-fields");
const sitingResults = document.querySelector(".siting-results");
const sitingError = document.getElementById("siting-error");
const sitingState = document.getElementById("siting-load-state");
const sitingGroup = L.featureGroup();
const sitingSiteLayers = new Map();
let sitingData = null;
let sitingCalculation = null;
let sitingSelectedId = null;
let sitingLoading = false;
let sitingSummaryText = "";

const formatSiting = (value, digits = 0) => value === null
  ? "Unknown" : value.toLocaleString("en-US", { maximumFractionDigits: digits });

function sitingNode(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function readSitingParameters() {
  const value = (name) => sitingForm.elements.namedItem(name).valueAsNumber;
  return {
    units: value("units"), unitSize: value("unitSize"), efficiency: value("efficiency") / 100,
    weights: {
      accommodation: value("accommodation") / 100,
      removal: value("removal") / 100,
      assembly: value("assembly") / 100,
    },
  };
}

function setSitingDefaults() {
  const defaults = sitingData.defaults;
  for (const [name, value] of Object.entries({
    units: defaults.units, unitSize: defaults.unitSize, efficiency: defaults.efficiency * 100,
    accommodation: defaults.weights.accommodation * 100,
    removal: defaults.weights.removal * 100, assembly: defaults.weights.assembly * 100,
  })) sitingForm.elements.namedItem(name).value = value;
}

function sitingStyle(site) {
  const selected = site.site_id === sitingSelectedId;
  const color = site.rank === null ? mapPalette.unranked : site.rank <= 10 ? mapPalette.top : mapPalette.ranked;
  return {
    color: selected ? mapPalette.selected : color, weight: selected ? 3 : 1.3,
    fillColor: color, fillOpacity: selected ? 0.7 : 0.38,
    dashArray: site.rank === null ? "4 3" : null,
  };
}

function renderSitingDetail() {
  const site = sitingCalculation.sites.find((candidate) => candidate.site_id === sitingSelectedId);
  const panel = document.getElementById("siting-detail");
  panel.replaceChildren();
  if (!site) {
    panel.append(sitingNode("p", "Select a site on the map or in the list."));
    return;
  }
  panel.append(
    sitingNode("span", site.rank === null ? "UNRANKED GROUP" : `RANK ${site.rank} / SCORE ${formatSiting(site.score, 3)}`, "eyebrow"),
    sitingNode("h3", site.site_id),
    sitingNode("p", site.addresses.split("|").join(" / ") || `Queens block ${site.block}`, "site-address"),
  );
  const metrics = document.createElement("dl");
  metrics.className = "siting-metrics";
  for (const [label, value] of [
    ["Lots to assemble", formatSiting(site.lot_count)],
    ["Existing units removed", formatSiting(site.existing_units_removed)],
    ["Proxy replacement units", formatSiting(site.proxyUnits, 1)],
    ["Target shortfall (proxy)", formatSiting(site.shortfall, 1)],
    ["Conditional net total units", formatSiting(site.netUnits)],
    ["Required FAR (source lot area)", formatSiting(site.requiredFar, 2)],
    ["Accommodation component", site.components.accommodation === null ? "Unknown" : `${formatSiting(site.components.accommodation * 100, 1)} / 100`],
    ["Fewer removals component", site.components.removal === null ? "Not scored" : `${formatSiting(site.components.removal * 100, 1)} / 100`],
    ["Fewer lots component", site.components.assembly === null ? "Not scored" : `${formatSiting(site.components.assembly * 100, 1)} / 100`],
  ]) metrics.append(sitingNode("dt", label), sitingNode("dd", value));
  panel.append(metrics);
  panel.append(sitingNode("p", "Net units assume delivery of the full gross target and full demolition. They are not an achieved yield or displaced-household count.", "section-note"));
  const flags = document.createElement("ul");
  flags.className = "site-flags";
  if (!site.rankable) flags.append(sitingNode("li", `Not ranked: ${site.unranked_reason.split("|").join("; ").replaceAll("_", " ")}.`));
  if (site.parks_overlap_sqft > 0) flags.append(sitingNode("li", `Parks Properties overlap: ${formatSiting(site.parks_overlap_sqft)} sq ft. Legal/control conflict requires review.`));
  if (site.planimetric_park_boundary_overlap_sqft > 0) flags.append(sitingNode("li", `Planimetric parks overlap: ${formatSiting(site.planimetric_park_boundary_overlap_sqft)} sq ft; may overlap the same park evidence.`));
  if (site.condo_review) flags.append(sitingNode("li", "Condominium structure requires review."));
  if (site.zone_set_difference_lots > 0) flags.append(sitingNode("li", `PLUTO/mapped zoning labels differ on ${site.zone_set_difference_lots} lots; not automatically a legal zoning change.`));
  if (site.split_or_boundary_review_lots > 0) flags.append(sitingNode("li", `Split zoning or boundary coverage review: ${site.split_or_boundary_review_lots} lots.`));
  flags.append(sitingNode("li", "Legal capacity, land control, affordability delivery and displacement remain unverified."));
  panel.append(flags);
  const zoning = [
    site.mapped_base_zones, site.special_districts, site.subdistricts,
  ].filter(Boolean).join(" / ");
  panel.append(sitingNode("p", `Mapped designations: ${zoning || "Unresolved"}`, "section-note"));
  const bbls = document.createElement("details");
  bbls.append(sitingNode("summary", "Constituent tax lots"), sitingNode("p", site.bbls.split("|").join(", ")));
  panel.append(bbls);
}

function selectSitingSite(id, zoom = false) {
  sitingSelectedId = id;
  for (const site of sitingCalculation.sites) {
    const layer = sitingSiteLayers.get(site.site_id);
    layer.setStyle(sitingStyle(site));
    if (site.site_id === id) layer.bringToFront();
  }
  document.querySelectorAll(".site-select").forEach((button) => {
    const selected = button.dataset.siteId === id;
    button.setAttribute("aria-pressed", String(selected));
    button.closest("tr").classList.toggle("is-selected", selected);
  });
  renderSitingDetail();
  if (zoom) map.fitBounds(sitingSiteLayers.get(id).getBounds(), { padding: [45, 45], maxZoom: 17 });
}

function renderSitingRanking() {
  const body = document.getElementById("siting-ranks");
  const rows = document.createDocumentFragment();
  for (const site of sitingCalculation.sites) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    const button = sitingNode("button", `${site.rank === null ? "\u2014" : `#${site.rank}`} ${site.site_id}`, "site-select");
    button.type = "button";
    button.dataset.siteId = site.site_id;
    button.setAttribute("aria-pressed", String(site.site_id === sitingSelectedId));
    button.addEventListener("click", () => selectSitingSite(site.site_id, true));
    cell.append(button);
    const notes = [`${site.lot_count} lots`];
    if (site.parks_overlap_sqft > 0 || site.planimetric_park_boundary_overlap_sqft > 0) notes.push("PARK OVERLAP");
    if (!site.rankable) notes.push("UNRANKED");
    cell.append(sitingNode("small", notes.join(" \u00b7 ")));
    row.append(cell, sitingNode("td", site.score === null ? "Not ranked" : formatSiting(site.score, 3)), sitingNode("td", formatSiting(site.proxyUnits, 1)));
    row.classList.toggle("is-selected", site.site_id === sitingSelectedId);
    rows.append(row);
    const layer = sitingSiteLayers.get(site.site_id);
    layer.setStyle(sitingStyle(site));
    layer.unbindTooltip();
    layer.bindTooltip(site.rank !== null && site.rank <= 10 ? `#${site.rank}` : `${site.rank === null ? "Unranked" : `#${site.rank}`} ${site.site_id}`, {
      permanent: site.rank !== null && site.rank <= 10,
      direction: "center", className: "site-rank-label",
    });
  }
  body.replaceChildren(rows);
  renderSitingDetail();
}

function updateSiting() {
  if (!sitingData) return;
  try {
    const parameters = readSitingParameters();
    const total = Object.values(parameters.weights).reduce((sum, value) => sum + value, 0) * 100;
    document.getElementById("siting-weight-total").textContent = `Weight total: ${Number.isFinite(total) ? formatSiting(total, 2) : "incomplete"}%`;
    sitingCalculation = SitingModel.calculate(sitingData.sites.features.map((feature) => feature.properties), parameters);
    sitingError.hidden = true;
    sitingResults.classList.remove("is-stale");
    sitingSummaryText = `${sitingCalculation.ranked} ranked / ${sitingCalculation.unranked} unranked groups. ${sitingCalculation.targetMet} of ${sitingCalculation.ranked} ranked sites meet the ${formatSiting(parameters.units)}-unit target under the proxy.`;
    document.getElementById("siting-summary").textContent = sitingSummaryText;
    const originalWeights = Object.keys(parameters.weights).every(
      (key) => Math.abs(parameters.weights[key] - sitingData.defaults.weights[key]) < 1e-9,
    );
    document.getElementById("siting-policy-state").textContent = originalWeights
      ? "Baseline pilot weights: 40% accommodation / 40% fewer removals / 20% fewer lots."
      : "Exploratory weights: these are not the approved baseline pilot ranking.";
    document.getElementById("siting-area").textContent = `Required residential gross floor area: ${formatSiting(sitingCalculation.requiredGsf)} sq ft.`;
    if (sitingSelectedId === null) sitingSelectedId = sitingCalculation.sites[0].site_id;
    renderSitingRanking();
  } catch (error) {
    sitingError.textContent = `${error.message} Showing the last valid results until corrected.`;
    sitingError.hidden = false;
    sitingResults.classList.add("is-stale");
    document.getElementById("siting-summary").textContent = `${sitingSummaryText} Last valid results; current inputs are invalid.`;
  }
}

function validateSitingPayload(data) {
  if (data.schema_version !== 1 || data.sites?.type !== "FeatureCollection" || data.reference?.type !== "FeatureCollection") {
    throw new Error("Unsupported or incomplete Siting snapshot.");
  }
  for (const collection of [data.sites, data.reference]) {
    if (!Array.isArray(collection.features) || !collection.features.length) throw new Error("Missing map features.");
    for (const feature of collection.features) {
      if (feature.type !== "Feature" || !feature.properties || !feature.geometry
          || !["Polygon", "MultiPolygon", "LineString", "MultiLineString"].includes(feature.geometry.type)
          || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) {
        throw new Error("Invalid Siting map geometry.");
      }
    }
  }
  SitingModel.validateParameters(data.defaults);
  SitingModel.validateSites(data.sites.features.map((feature) => feature.properties));
  for (const { properties: site } of data.sites.features) {
    for (const field of ["addresses", "bbls", "mapped_base_zones", "special_districts", "subdistricts"]) {
      if (typeof site[field] !== "string") throw new Error(`Missing ${field}: ${site.site_id}`);
    }
    for (const field of ["parks_overlap_sqft", "planimetric_park_boundary_overlap_sqft", "zone_set_difference_lots", "split_or_boundary_review_lots"]) {
      if (typeof site[field] !== "number" || !Number.isFinite(site[field]) || site[field] < 0) {
        throw new Error(`Invalid ${field}: ${site.site_id}`);
      }
    }
    if (typeof site.condo_review !== "boolean") throw new Error(`Missing condominium review flag: ${site.site_id}`);
  }
  if (data.sites.features.length !== data.provenance?.sites) throw new Error("Pilot site count differs from provenance.");
  const referenceNames = data.reference.features.map((feature) => feature.properties.name);
  if (referenceNames.length !== 3 || !["candidate_corridor", "facing_shoreline", "roosevelt_island_reference"].every((name) => referenceNames.includes(name))) {
    throw new Error("Pilot reference layers are incomplete.");
  }
}

async function loadSiting() {
  if (sitingLoading || sitingData) return;
  sitingLoading = true;
  sitingState.textContent = "Loading pilot data...";
  document.getElementById("siting-retry").hidden = true;
  try {
    const response = await fetch("assets/siting/pilot.json");
    if (!response.ok) throw new Error(`Pilot snapshot unavailable (HTTP ${response.status}).`);
    const data = await response.json();
    validateSitingPayload(data);
    L.geoJSON(data.reference, {
      interactive: false,
      style: (feature) => feature.properties.name === "candidate_corridor"
        ? { color: mapPalette.corridor, weight: 1, fillColor: mapPalette.corridor, fillOpacity: 0.06 }
        : { color: mapPalette.island, weight: 2, fillColor: mapPalette.island, fillOpacity: 0.12 },
    }).addTo(sitingGroup);
    L.geoJSON(data.sites, {
      style: { color: mapPalette.ranked, weight: 1.3 },
      onEachFeature(feature, layer) {
        const id = feature.properties.site_id;
        sitingSiteLayers.set(id, layer);
        layer.on("click", () => selectSitingSite(id));
      },
    }).addTo(sitingGroup);
    sitingData = data;
    sitingHomeBounds = L.featureGroup([...sitingSiteLayers.values()]).getBounds();
    setSitingDefaults();
    sitingFields.disabled = false;
    sitingState.textContent = `${data.provenance.sites} groups / ${data.provenance.constituent_lots.toLocaleString("en-US")} lots loaded.`;
    document.getElementById("siting-provenance").textContent = `Snapshot: ${data.provenance.pilot}. PLUTO ${data.provenance.pluto}; mapped zoning ${data.provenance.mapped_zoning}. WGS84 display; source metrics in square feet.`;
    updateSiting();
    if (document.body.dataset.mode === "siting") {
      sitingGroup.addTo(map);
      fitSitingMap();
    }
  } catch (error) {
    sitingGroup.clearLayers();
    sitingSiteLayers.clear();
    sitingData = null;
    sitingCalculation = null;
    sitingSelectedId = null;
    sitingHomeBounds = null;
    sitingFields.disabled = true;
    document.getElementById("siting-ranks").replaceChildren();
    document.getElementById("siting-summary").textContent = "Siting data unavailable; no ranking displayed.";
    sitingState.textContent = `Could not load Siting: ${error.message}`;
    document.getElementById("siting-retry").hidden = false;
    console.error("Siting load failed", error);
  } finally {
    sitingLoading = false;
  }
}

function fitSitingMap() {
  map.setMaxBounds(sitingHomeBounds.pad(0.6));
  map.setMinZoom(11);
  map.invalidateSize();
  map.fitBounds(sitingHomeBounds, { padding: [24, 24], animate: false });
}

function setStudyMode(mode) {
  document.body.dataset.mode = mode;
  const isSiting = mode === "siting";
  document.querySelector(".workspace").classList.toggle("is-siting", isSiting);
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(".siting-only").forEach((element) => { element.hidden = !isSiting; });
  document.querySelectorAll(".exploration-only").forEach((element) => { element.hidden = isSiting; });
  if (isSiting) {
    map.removeLayer(buildingLayer);
    if (sitingData) {
      sitingGroup.addTo(map);
      fitSitingMap();
    } else {
      map.invalidateSize();
      loadSiting();
    }
  } else {
    map.removeLayer(sitingGroup);
    buildingLayer.addTo(map);
    map.setMaxBounds(studyBounds);
    map.setMinZoom(13);
    map.invalidateSize();
    map.setView(islandCenter, islandZoom, { animate: false });
  }
}

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setStudyMode(button.dataset.mode));
});
sitingForm.addEventListener("submit", (event) => { event.preventDefault(); updateSiting(); });
sitingForm.addEventListener("input", updateSiting);
document.getElementById("siting-reset").addEventListener("click", () => { setSitingDefaults(); updateSiting(); });
document.getElementById("siting-retry").addEventListener("click", loadSiting);
document.body.dataset.mode = "exploration";
