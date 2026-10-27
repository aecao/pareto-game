"use strict";

const connectivityGroup = L.featureGroup();
const connectivityStreets = L.featureGroup().addTo(connectivityGroup);
const connectivityLinks = L.featureGroup().addTo(connectivityGroup);
const connectivityFields = document.getElementById("connectivity-fields");
const connectivityState = document.getElementById("connectivity-state");
const connectivityError = document.getElementById("connectivity-error");
const connectivityRetry = document.getElementById("connectivity-retry");
const connectivityBridgeList = document.getElementById("connectivity-bridges");
const CONNECTIVITY_COLORS = { baseline: "#7AADFF", selected: "#FF8D21", bridge: "#F54927" };
// Each reach fades from its origin colour (near the island) to its display colour at the budget edge.
const CONNECTIVITY_RAMPS = { baseline: ["#4D73FF", "#7AADFF"], selected: ["#FFD04D", "#FF8D21"] };
const CONNECTIVITY_BAND_MINUTES = 5;
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

function selectedBridges() {
  return [...connectivityBridgeList.querySelectorAll("input:checked")].map((input) => input.value);
}

function rampColor([from, to], t) {
  const channel = (hex, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t)
    .toString(16).padStart(2, "0")).join("")}`;
}

function bandCount(budget) {
  return Math.max(1, Math.ceil(budget / CONNECTIVITY_BAND_MINUTES));
}

function drawReachable(scenario, budget, ramp, label) {
  const count = bandCount(budget);
  const byBand = Array.from({ length: count }, () => []);
  for (const piece of ConnectivityModel.bandedReachable(connectivityData, scenario, budget, CONNECTIVITY_BAND_MINUTES)) {
    byBand[Math.min(piece.band, count - 1)].push(piece.coordinates.map(([lon, lat]) => [lat, lon]));
  }
  byBand.forEach((lines, band) => {
    if (!lines.length) return;
    const start = band * CONNECTIVITY_BAND_MINUTES;
    const end = Math.min(budget, start + CONNECTIVITY_BAND_MINUTES);
    L.polyline(lines, { color: rampColor(ramp, count > 1 ? band / (count - 1) : 1), weight: 5, opacity: 1 })
      .bindPopup(connectivityPopup(label, `${start}–${end} minutes from the origin`))
      .addTo(connectivityStreets);
  });
}

function renderLegendRamps(budget) {
  const count = bandCount(budget);
  for (const [key, ramp] of Object.entries(CONNECTIVITY_RAMPS)) {
    const swatch = document.querySelector(`.connectivity-legend .connectivity-${key === "baseline" ? "baseline" : "bridge"}`);
    if (!swatch) continue;
    const stops = Array.from({ length: count }, (_v, i) => {
      const color = rampColor(ramp, count > 1 ? i / (count - 1) : 1);
      return `${color} ${(100 * i) / count}% ${(100 * (i + 1)) / count}%`;
    });
    swatch.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
  }
  document.getElementById("connectivity-legend-scale").textContent =
    `${CONNECTIVITY_BAND_MINUTES}-minute bands: darker near the origin → ${budget} min at the outer edge`;
}

function renderConnectivity() {
  if (!connectivityData) return;
  const budget = Number(document.getElementById("connectivity-budget").value);
  document.getElementById("connectivity-budget-value").textContent = `${budget} min`;
  const comparison = document.getElementById("connectivity-scenario").value;
  const active = selectedBridges();
  const scenario = ConnectivityModel.scenarioName(connectivityData, active);
  connectivityStreets.clearLayers();
  // Baseline is drawn last so it sits in front of the selected-bridge reach.
  if (comparison !== "baseline" && scenario !== "baseline") {
    drawReachable(scenario, budget, CONNECTIVITY_RAMPS.selected, "Reachable with selected bridges");
  }
  if (comparison !== "selected") {
    drawReachable("baseline", budget, CONNECTIVITY_RAMPS.baseline, "Baseline");
  }
  renderLegendRamps(budget);
  connectivityLinks.clearLayers();
  L.geoJSON(connectivityData.links, {
    style: (f) => {
      const on = f.properties.bridge === null || active.includes(f.properties.bridge);
      return {
        color: CONNECTIVITY_COLORS.bridge, weight: f.properties.kind === "proposed_bridge" ? 5 : 3,
        opacity: on ? 1 : 0.25, dashArray: f.properties.kind === "proposed_bridge" ? null : "6 5",
      };
    },
    onEachFeature(f, layer) {
      const bridge = connectivityData.bridges.find((b) => b.id === f.properties.bridge);
      layer.bindPopup(connectivityPopup(bridge ? bridge.label : f.properties.street,
        `${f.properties.kind.replace("_", " ")}: ${f.properties.length_ft.toFixed(0)} ft / ${f.properties.minutes.toFixed(2)} min`));
    },
  }).addTo(connectivityLinks);
  const base = ConnectivityModel.metrics(connectivityData, "baseline", budget);
  const chosen = ConnectivityModel.metrics(connectivityData, scenario, budget);
  const metrics = document.getElementById("connectivity-metrics");
  metrics.replaceChildren();
  const format = (value) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  for (const [label, key] of [
    ["Queens nodes", "queens"],
    ["Island nodes", "island"],
    ["Manhattan/other nodes", "other"],
    ["Street miles", "existingMiles"],
  ]) {
    metrics.append(connectivityNode("dt", label),
      connectivityNode("dd", `${format(base[key])} → ${format(chosen[key])}`));
  }
  const names = connectivityData.bridges.filter((b) => active.includes(b.id)).map((b) => b.label);
  document.getElementById("connectivity-summary").textContent =
    `Baseline → ${names.length ? names.join(" + ") : "no proposed bridges"}, within ${budget} minutes of the island centre.`;
  connectivityState.textContent = `${budget}-minute reachability / ${names.length} of ${connectivityData.bridges.length} bridges on. Precomputed; no live routing.`;
}

function buildBridgeToggles(data) {
  connectivityBridgeList.replaceChildren();
  for (const bridge of data.bridges) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = bridge.id;
    input.checked = true;
    input.addEventListener("change", renderConnectivity);
    const penalty = bridge.stops.some((stop) => stop.exit_penalty_minutes > 0) ? "; island stop +3 min" : "";
    label.append(input, ` ${bridge.label} (${Math.round(bridge.length_ft).toLocaleString("en-US")} ft${penalty})`);
    connectivityBridgeList.append(label);
  }
}

async function loadConnectivity() {
  if (connectivityLoading || connectivityData) return;
  connectivityLoading = true;
  connectivityRetry.hidden = true;
  connectivityError.hidden = true;
  connectivityState.textContent = "Loading verified walking snapshot...";
  try {
    const response = await fetch("assets/connectivity/walking.json?v=three-bridges-v7", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Walking snapshot unavailable (${response.status}).`);
    const data = ConnectivityModel.validate(await response.json());
    connectivityData = data;
    buildBridgeToggles(data);
    const island = L.geoJSON(data.island, {
      style: { color: mapPalette.island, weight: 1, fillOpacity: 0.02 },
    }).addTo(connectivityGroup);
    // Streets are redrawn on every render, so markers need their own pane to stay in front.
    if (!map.getPane("connectivityMarkers")) map.createPane("connectivityMarkers").style.zIndex = 650;
    const markerPane = { pane: "connectivityMarkers", renderer: L.svg({ pane: "connectivityMarkers" }) };
    const markers = L.geoJSON(data.markers, {
      filter: (f) => f.properties.role === "origin" || f.properties.role === "island_stop",
      pointToLayer: (f, latlng) => {
        if (f.properties.role !== "origin") {
          return L.circleMarker(latlng, {
            ...markerPane, radius: 5, color: "#111", weight: 2, fillColor: "#fff", fillOpacity: 1,
          });
        }
        return L.featureGroup([
          L.circleMarker(latlng, { ...markerPane, radius: 13, color: "#fff", weight: 5, fill: false }),
          L.circleMarker(latlng, { ...markerPane, radius: 13, color: "#111", weight: 2, fill: false }),
          L.circleMarker(latlng, { ...markerPane, radius: 5, color: "#fff", weight: 2, fillColor: "#111", fillOpacity: 1 })
            .bindTooltip("Origin", { permanent: true, direction: "right", offset: [14, 0], className: "connectivity-origin-label" }),
        ]);
      },
      onEachFeature(f, layer) {
        if (f.properties.role !== "origin") layer.bindTooltip(f.properties.name);
      },
    }).addTo(connectivityGroup);
    connectivityBounds = L.featureGroup([island, markers, L.geoJSON(data.links)]).getBounds().pad(0.6);
    document.getElementById("connectivity-provenance").textContent =
      `LION ${data.provenance.lion} / ${data.provenance.source_edges.toLocaleString("en-US")} source edges; ${data.settings.walking_speed_mph} mph. ${Object.keys(data.scenarios).length} precomputed bridge combinations.`;
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
    connectivityBridgeList.replaceChildren();
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

document.getElementById("connectivity-budget").addEventListener("input", renderConnectivity);
document.getElementById("connectivity-scenario").addEventListener("change", renderConnectivity);
connectivityRetry.addEventListener("click", loadConnectivity);
