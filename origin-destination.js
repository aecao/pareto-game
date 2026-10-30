"use strict";

const originDestinationGroup = L.featureGroup();
const originDestinationRenderer = L.canvas({ padding: 0.3 });
let originDestinationSelected = null;

function visibleOriginDestinationFlows(p) {
  return OriginDestinationModel.visibleFlows(p.flows, originDestinationMinimum);
}

function originDestinationThresholdSummary(origins) {
  const flows = origins.flatMap((p) => p.flows);
  const visible = OriginDestinationModel.visibleFlows(flows, originDestinationMinimum);
  const shown = visible.reduce((sum, flow) => sum + flow.jobs, 0);
  const total = flows.reduce((sum, flow) => sum + flow.jobs, 0);
  return `Minimum ${incomeNumber(originDestinationMinimum)} links per pair: showing ${incomeNumber(visible.length)} of ${incomeNumber(flows.length)} NYC pairs (${incomeNumber(shown)} job links); hiding ${incomeNumber(flows.length - visible.length)} pairs (${incomeNumber(total - shown)} job links).`;
}

function clearOriginDestination() {
  originDestinationGroup.clearLayers();
  if (incomeGroup.hasLayer(originDestinationGroup)) incomeGroup.removeLayer(originDestinationGroup);
  for (const layer of incomeAreaLayers.values()) layer.setStyle(incomeMapStyle(layer.feature));
  document.getElementById("od-show-all").checked = false;
  originDestinationSelected = null;
  incomeSelector.value = "";
  document.getElementById("od-clear").disabled = true;
  document.getElementById("od-selection").replaceChildren();
}

function originDestinationBounds() {
  return L.latLngBounds(Object.values(incomeData.nodes).map((node) => [node.center[1], node.center[0]]));
}

function selectOriginDestination(geoid) {
  if (incomeData?.metadata.dataset !== "lodes_origin_destination") throw new Error("Origin-destination data is not loaded.");
  const feature = incomeData.features.find((item) => item.properties.geoid === geoid);
  if (!feature) throw new Error(`Unknown LODES origin area ${geoid}.`);
  clearOriginDestination();
  const p = feature.properties;
  drawDestinationBoundaries([feature]);
  drawOriginDestination(p);
  originDestinationGroup.addTo(incomeGroup);
  originDestinationSelected = geoid;
  incomeSelector.value = geoid;
  document.getElementById("od-clear").disabled = false;
  appendOriginDestinationSummary(p, document.getElementById("od-selection"));
  document.getElementById("income-state").textContent = `${p.name} selected. ${originDestinationThresholdSummary([p])}`;
  map.closePopup();
}

function drawDestinationBoundaries(origins) {
  const destinations = new Set(origins.flatMap((feature) => visibleOriginDestinationFlows(feature.properties).map((flow) => flow.destination)));
  L.geoJSON({
    type: "FeatureCollection",
    features: [...destinations].map((id) => incomeData.boundaries[id]),
  }, {
    renderer: originDestinationRenderer,
    interactive: false,
    style: { color: "#7542a6", weight: 1.5, opacity: 0.85, fill: false },
  }).addTo(originDestinationGroup);
}

function drawOriginDestination(p, color = "#375a9e") {
  const geoid = p.geoid;
  const nodes = incomeData.nodes;
  const metadata = incomeData.metadata;
  const area = p.scale === "neighborhood" ? "NTA area" : "tract";
  const origin = L.latLng(nodes[geoid].center[1], nodes[geoid].center[0]);
  const renderer = originDestinationRenderer;
  const selected = incomeAreaLayers.get(geoid);
  selected.setStyle({ color: "#b94c00", weight: 2.5, fillColor: "#ffb36b", fillOpacity: 0.6 });
  const flows = visibleOriginDestinationFlows(p).sort((a, b) => a.jobs - b.jobs || a.destination.localeCompare(b.destination));
  for (const flow of flows) {
    const destination = L.latLng(nodes[flow.destination].center[1], nodes[flow.destination].center[0]);
    let points = [origin, destination];
    if (flow.destination === geoid) {
      const center = map.project(origin, 14);
      points = Array.from({ length: 33 }, (_, i) => {
        const angle = Math.PI + i / 32 * Math.PI * 2;
        return map.unproject(L.point(center.x + 24 + Math.cos(angle) * 24, center.y + Math.sin(angle) * 24), 14);
      });
    }
    const label = `${p.name} to ${nodes[flow.destination].name}: ${incomeNumber(flow.jobs)} primary-job links${flow.destination === geoid ? ` (within the same ${area})` : ""}`;
    L.polyline(points, {
      renderer, color, opacity: 0.55, weight: OriginDestinationModel.linkWidth(flow.jobs, metadata),
      bubblingMouseEvents: false,
    }).bindTooltip(incomeNode("span", label, null), { sticky: true }).addTo(originDestinationGroup);
  }
  for (const flow of flows) {
    if (flow.destination === geoid) continue;
    const node = nodes[flow.destination];
    L.circleMarker([node.center[1], node.center[0]], {
      renderer, radius: OriginDestinationModel.nodeRadius(flow.jobs, metadata),
      color: "#fff", weight: 0.5, fillColor: "#375a9e", fillOpacity: 0.9,
      bubblingMouseEvents: false,
    }).bindTooltip(incomeNode("span", `${node.name}: ${incomeNumber(flow.jobs)} primary-job links from ${p.name}`, null))
      .addTo(originDestinationGroup);
  }
  L.circleMarker(origin, {
    radius: 8, color: "#fff", weight: 2, fillColor: "#c75200", fillOpacity: 1, bubblingMouseEvents: false,
  }).bindTooltip(incomeNode("span", `Origin: ${p.name}`, null)).addTo(originDestinationGroup);
}

function appendOriginDestinationSummary(p, summary) {
  const { nodes } = incomeData;
  const geoid = p.geoid;
  const area = p.scale === "neighborhood" ? "NTA area" : "tract";
  const plural = p.scale === "neighborhood" ? "NTA areas" : "tracts";
  const flows = [...p.flows].sort((a, b) => a.jobs - b.jobs || a.destination.localeCompare(b.destination));
  incomeNode("h2", p.name, summary);
  if (p.scale === "tract") incomeNode("p", p.nta_name, summary);
  incomeNode("p", `${incomeNumber(p.total)} primary-job links to ${incomeNumber(p.flows.length)} NYC workplace ${plural}. Orange node: selected residence ${area}. Blue nodes: workplace ${plural}.`, summary);
  incomeNode("p", originDestinationThresholdSummary([p]), summary);
  if (p.scale === "neighborhood") {
    incomeNode("p", `Sum of ${incomeNumber(p.members.length)} whole native-2020 tracts. Roosevelt Island is separated from Upper East Side-Lenox Hill at both ends; these two areas are custom, not official NTAs.`, summary);
  }
  const same = p.flows.find((flow) => flow.destination === geoid)?.jobs ?? 0;
  incomeNode("p", `${incomeNumber(same)} links stay within this ${area} (loop shown only when its count meets the threshold). ${incomeNumber(p.outside_nyc_jobs)} outside-NYC links are excluded from the diagram; ${incomeNumber(p.resident_primary_jobs)} resident primary jobs in total.`, summary);
  const details = incomeNode("details", null, summary, { class: "od-destinations" });
  incomeNode("summary", "All destination counts (largest first)", details);
  const table = incomeNode("table", null, details, { class: "income-popup-table" });
  incomeNode("caption", "2023 LODES JT01 primary-job links; all destinations, including pairs hidden by the threshold; share of all NYC links for this origin", table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  [`Workplace ${area}`, "Links", "Share"].forEach((label) => incomeNode("th", label, head, { scope: "col" }));
  const body = incomeNode("tbody", null, table);
  for (const flow of [...flows].reverse()) {
    const row = incomeNode("tr", null, body);
    incomeNode("th", `${nodes[flow.destination].name} (${flow.destination})${flow.destination === geoid ? ` - same ${area}` : ""}`, row, { scope: "row" });
    incomeNode("td", incomeNumber(flow.jobs), row);
    incomeNode("td", `${(flow.jobs / p.total * 100).toFixed(1)}%`, row);
  }
}

function showAllOriginDestinations() {
  if (incomeData?.metadata.dataset !== "lodes_origin_destination" || incomeData.metadata.scale !== "neighborhood") {
    throw new Error("Showing all origins requires NTA origin-destination data.");
  }
  clearOriginDestination();
  document.getElementById("od-show-all").checked = true;
  document.getElementById("od-clear").disabled = false;
  const summary = document.getElementById("od-selection");
  incomeNode("h2", "All four study origins", summary);
  incomeNode("p", `${incomeNumber(incomeData.metadata.nyc_jobs)} NYC primary-job links across all four origins. Connection colors identify each origin. Orange nodes are residence origins; blue nodes are workplace destinations. Overlapping destination nodes retain each origin's individual counts, not a combined destination total.`, summary);
  const colors = ["#375a9e", "#8b479f", "#198269", "#bd5619"];
  const origins = [...incomeData.features].sort((a, b) => a.properties.geoid.localeCompare(b.properties.geoid));
  drawDestinationBoundaries(origins);
  origins.forEach(({ properties: p }, i) => {
    drawOriginDestination(p, colors[i]);
    const section = incomeNode("section", null, summary);
    incomeNode("p", p.name, section, { style: `color:${colors[i]};font-weight:700` });
    const details = incomeNode("details", null, section);
    incomeNode("summary", "Origin counts and destinations", details);
    appendOriginDestinationSummary(p, details);
  });
  originDestinationGroup.addTo(incomeGroup);
  document.getElementById("income-state").textContent = `All four study-origin NTAs shown. ${originDestinationThresholdSummary(origins.map((f) => f.properties))} Choose an origin to return to a single diagram.`;
  map.closePopup();
}

document.getElementById("od-clear").addEventListener("click", fitIncomeMap);
document.getElementById("od-threshold").addEventListener("input", (event) => {
  const minimum = Number(event.target.value);
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > incomeData?.metadata.max_pair_jobs) {
    throw new Error("Invalid LODES minimum job-link threshold.");
  }
  originDestinationMinimum = minimum;
  document.getElementById("od-threshold-value").textContent = incomeNumber(minimum);
  if (document.getElementById("od-show-all").checked) showAllOriginDestinations();
  else if (originDestinationSelected) selectOriginDestination(originDestinationSelected);
});
document.getElementById("od-show-all").addEventListener("change", (event) => {
  if (event.target.checked) showAllOriginDestinations();
  else {
    clearOriginDestination();
    document.getElementById("income-state").textContent = "Select an origin NTA to show its NYC connections.";
  }
});
