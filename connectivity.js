"use strict";

const connectivityGroup = L.featureGroup();
const connectivityStreets = L.featureGroup().addTo(connectivityGroup);
const connectivityLinks = L.featureGroup().addTo(connectivityGroup);
const connectivityFields = document.getElementById("connectivity-fields");
const connectivityState = document.getElementById("connectivity-state");
const connectivityError = document.getElementById("connectivity-error");
const connectivityRetry = document.getElementById("connectivity-retry");
let connectivityData = null;
let connectivityLoading = false;
let connectivityBounds = null;

function connectivityNode(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function connectivityPopup(label, detail) {
  const node = document.createElement("div");
  node.append(connectivityNode("strong", label), connectivityNode("p", detail));
  return node;
}

function fitConnectivityMap() {
  map.setMinZoom(11);
  map.setMaxBounds(connectivityBounds.pad(1.2));
  map.invalidateSize();
  map.fitBounds(connectivityBounds, { padding: [24, 24], animate: false });
}

function renderConnectivity() {
  if (!connectivityData) return;
  const budget = Number(document.getElementById("connectivity-budget").value);
  const scenario = document.getElementById("connectivity-scenario").value;
  const selected = ConnectivityModel.selection(connectivityData, budget, scenario);
  connectivityStreets.clearLayers();
  L.geoJSON({ type: "FeatureCollection", features: selected }, {
    style: (f) => ({
      color: f.properties.scenario === "baseline" ? mapPalette.ranked : mapPalette.top,
      weight: f.properties.scenario === "baseline" ? 5 : 2.5, opacity: 0.85,
    }),
    onEachFeature(f, layer) {
      layer.bindPopup(connectivityPopup(f.properties.street,
        `${f.properties.scenario} / ${budget}-minute reachable interval`));
    },
  }).addTo(connectivityStreets);
  connectivityLinks.clearLayers();
  L.geoJSON(connectivityData.scenario_links, {
    filter: (f) => scenario !== "baseline"
      || ["roosevelt_origin:access", "island_landing:access"].includes(f.properties.name),
    style: { color: mapPalette.building, weight: 4, dashArray: "7 5" },
    onEachFeature(f, layer) {
      layer.bindPopup(connectivityPopup(f.properties.street,
        `${f.properties.length_ft.toFixed(1)} ft / ${f.properties.minutes.toFixed(2)} min; hypothetical/assumed access`));
    },
  }).addTo(connectivityLinks);
  const rows = connectivityData.summary.filter((row) => row.budget_minutes === budget);
  const baseline = rows.find((row) => row.scenario === "baseline");
  const bridge = rows.find((row) => row.scenario === "bridge");
  const metrics = document.getElementById("connectivity-metrics");
  metrics.replaceChildren();
  for (const [label, value] of [
    ["Queens nodes: baseline", baseline.queens_source_nodes],
    ["Queens nodes: bridge", bridge.queens_source_nodes],
    ["Island nodes: baseline", baseline.island_source_nodes],
    ["Island nodes: bridge", bridge.island_source_nodes],
  ]) metrics.append(connectivityNode("dt", label), connectivityNode("dd", value.toLocaleString("en-US")));
  document.getElementById("connectivity-summary").textContent =
    `Origin: Roosevelt Island. Counts show source street nodes reachable within ${budget} minutes.`;
  connectivityState.textContent = `${budget}-minute reachability / ${scenario === "both" ? "both scenarios" : scenario}. Fixed Roosevelt Island origin; no live routing.`;
}

async function loadConnectivity() {
  if (connectivityLoading || connectivityData) return;
  connectivityLoading = true;
  connectivityRetry.hidden = true;
  connectivityError.hidden = true;
  connectivityState.textContent = "Loading verified walking snapshot...";
  try {
    const response = await fetch("assets/connectivity/walking.json");
    if (!response.ok) throw new Error(`Walking snapshot unavailable (${response.status}).`);
    const data = ConnectivityModel.validate(await response.json());
    connectivityData = data;
    const site = L.geoJSON(data.site, {
      style: { color: mapPalette.selected, weight: 2, fillOpacity: 0.1 },
    }).addTo(connectivityGroup);
    connectivityBounds = site.getBounds().pad(2.5);
    L.geoJSON(data.island, {
      style: { color: mapPalette.island, weight: 1, fillOpacity: 0.02 },
    }).addTo(connectivityGroup);
    const markers = L.geoJSON(data.markers, {
      pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
        radius: 5, color: mapPalette.selected, fillColor: "#fff", fillOpacity: 1,
      }),
      onEachFeature(f, layer) { layer.bindTooltip(f.properties.name); },
    }).addTo(connectivityGroup);
    connectivityBounds = L.featureGroup([site, markers]).getBounds().pad(1.2);
    document.getElementById("connectivity-provenance").textContent =
      `LION ${data.provenance.lion} / ${data.provenance.source_edges.toLocaleString("en-US")} source edges. ${data.bridge_length_ft.toFixed(1)}-ft hypothetical crossing; ${data.settings.walking_speed_mph} mph. Exact saved display geometry and reachability summaries.`;
    connectivityFields.disabled = false;
    renderConnectivity();
    if (document.body.dataset.mode === "connectivity") {
      connectivityGroup.addTo(map);
      fitConnectivityMap();
    }
  } catch (error) {
    connectivityGroup.clearLayers();
    connectivityStreets.clearLayers();
    connectivityLinks.clearLayers();
    connectivityStreets.addTo(connectivityGroup);
    connectivityLinks.addTo(connectivityGroup);
    connectivityData = null;
    connectivityBounds = null;
    connectivityFields.disabled = true;
    connectivityError.textContent = `Could not load Connectivity: ${error.message}`;
    connectivityError.hidden = false;
    connectivityRetry.hidden = false;
    connectivityState.textContent = "Walking data unavailable. No connectivity results displayed.";
    document.getElementById("connectivity-summary").textContent = "Connectivity unavailable.";
    document.getElementById("connectivity-provenance").textContent = "";
    document.getElementById("connectivity-metrics").replaceChildren();
    console.error("Connectivity load failed", error);
  } finally {
    connectivityLoading = false;
  }
}

document.getElementById("connectivity-budget").addEventListener("change", renderConnectivity);
document.getElementById("connectivity-scenario").addEventListener("change", renderConnectivity);
connectivityRetry.addEventListener("click", loadConnectivity);
