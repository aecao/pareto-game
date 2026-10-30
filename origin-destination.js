"use strict";

const originDestinationGroup = L.featureGroup();
const originDestinationRenderer = L.canvas({ padding: 0.3 });
let originDestinationSelected = null;

function clearOriginDestination() {
  originDestinationGroup.clearLayers();
  if (incomeGroup.hasLayer(originDestinationGroup)) incomeGroup.removeLayer(originDestinationGroup);
  if (originDestinationSelected) {
    const layer = incomeAreaLayers.get(originDestinationSelected);
    if (layer) layer.setStyle(incomeMapStyle(layer.feature));
  }
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
  if (!feature) throw new Error(`Unknown LODES origin tract ${geoid}.`);
  clearOriginDestination();
  const p = feature.properties;
  const nodes = incomeData.nodes;
  const metadata = incomeData.metadata;
  const origin = L.latLng(nodes[geoid].center[1], nodes[geoid].center[0]);
  const renderer = originDestinationRenderer;
  const selected = incomeAreaLayers.get(geoid);
  selected.setStyle({ color: "#b94c00", weight: 2.5, fillColor: "#ffb36b", fillOpacity: 0.6 });
  const flows = [...p.flows].sort((a, b) => a.jobs - b.jobs || a.destination.localeCompare(b.destination));
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
    const label = `${p.name} to ${nodes[flow.destination].name}: ${incomeNumber(flow.jobs)} primary-job links${flow.destination === geoid ? " (within the same tract)" : ""}`;
    L.polyline(points, {
      renderer, color: "#375a9e", opacity: 0.38, weight: OriginDestinationModel.linkWidth(flow.jobs, metadata),
      bubblingMouseEvents: false,
    }).bindTooltip(incomeNode("span", label, null), { sticky: true }).addTo(originDestinationGroup);
  }
  for (const flow of flows) {
    if (flow.destination === geoid) continue;
    const node = nodes[flow.destination];
    L.circleMarker([node.center[1], node.center[0]], {
      renderer, radius: 3.5, color: "#fff", weight: 0.8, fillColor: "#375a9e", fillOpacity: 0.9,
      bubblingMouseEvents: false,
    }).bindTooltip(incomeNode("span", `${node.name}: ${incomeNumber(flow.jobs)} primary-job links from ${p.name}`, null))
      .addTo(originDestinationGroup);
  }
  L.circleMarker(origin, {
    radius: 8, color: "#fff", weight: 2, fillColor: "#c75200", fillOpacity: 1, bubblingMouseEvents: false,
  }).bindTooltip(incomeNode("span", `Origin: ${p.name}`, null)).addTo(originDestinationGroup);
  originDestinationGroup.addTo(incomeGroup);
  originDestinationSelected = geoid;
  incomeSelector.value = geoid;
  document.getElementById("od-clear").disabled = false;
  const summary = document.getElementById("od-selection");
  incomeNode("h2", p.name, summary);
  incomeNode("p", p.nta_name, summary);
  incomeNode("p", `${incomeNumber(p.total)} primary-job links to ${incomeNumber(p.flows.length)} NYC workplace tracts. Orange node: selected residence tract. Blue nodes: workplace tracts.`, summary);
  const same = p.flows.find((flow) => flow.destination === geoid)?.jobs ?? 0;
  incomeNode("p", `${incomeNumber(same)} links stay within this tract (drawn as a loop). ${incomeNumber(p.outside_nyc_jobs)} outside-NYC links are excluded from the diagram; ${incomeNumber(p.resident_primary_jobs)} resident primary jobs in total.`, summary);
  const details = incomeNode("details", null, summary, { class: "od-destinations" });
  incomeNode("summary", "All destination counts (largest first)", details);
  const table = incomeNode("table", null, details, { class: "income-popup-table" });
  incomeNode("caption", "2023 LODES JT01 primary-job links; share of displayed NYC links", table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  ["Workplace tract", "Links", "Share"].forEach((label) => incomeNode("th", label, head, { scope: "col" }));
  const body = incomeNode("tbody", null, table);
  for (const flow of [...flows].reverse()) {
    const row = incomeNode("tr", null, body);
    incomeNode("th", `${nodes[flow.destination].name} (${flow.destination})${flow.destination === geoid ? " - same tract" : ""}`, row, { scope: "row" });
    incomeNode("td", incomeNumber(flow.jobs), row);
    incomeNode("td", `${(flow.jobs / p.total * 100).toFixed(1)}%`, row);
  }
  document.getElementById("income-state").textContent = `${p.name} selected. All ${incomeNumber(p.flows.length)} NYC destinations shown; no top-N filter.`;
  map.closePopup();
}

document.getElementById("od-clear").addEventListener("click", fitIncomeMap);
