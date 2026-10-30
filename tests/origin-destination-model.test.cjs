"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../origin-destination-model.js");
const income = require("../income-model.js");
const transport = require("../transport-model.js");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const data = JSON.parse(read("assets/income/origin-destination.json"));
const ntaData = JSON.parse(read("assets/income/origin-destination-nta.json"));
const tractBoundaries = JSON.parse(read("assets/income/od-boundaries-tract.json"));
const ntaBoundaries = JSON.parse(read("assets/income/od-boundaries-neighborhood.json"));
const neighborhood = JSON.parse(read("assets/income/geographies/neighborhood.json"));

test("LODES snapshot has exactly the four requested origin areas and all 42,310 NYC links", () => {
  assert.equal(model.normalize(data), data);
  assert.equal(data.features.length, 30);
  assert.deepEqual(Object.fromEntries(Object.keys(data.metadata.origin_areas).map((id) =>
    [id, data.features.filter((f) => f.properties.nta === id).length])),
  { QN0201: 9, QN0105: 12, QN0102: 6, "MN0801-RI": 3 });
  assert.equal(Object.keys(data.nodes).length, 2327);
  assert.equal(data.features.reduce((sum, f) => sum + f.properties.total, 0), 42310);
  assert.equal(data.features.reduce((sum, f) => sum + f.properties.resident_primary_jobs, 0), 48212);
  assert.equal(data.features.reduce((sum, f) => sum + f.properties.outside_nyc_jobs, 0), 5902);
  assert.equal(data.features.reduce((sum, f) => sum + f.properties.flows.length, 0), 11626);
  assert.equal(data.features.reduce((sum, f) => sum + (f.properties.flows.find((x) =>
    x.destination === f.properties.geoid)?.jobs ?? 0), 0), 524);
});

test("invalid scope, geometry, keys, counts, missing nodes, duplicate links and nonreconciliation fail", () => {
  for (const edit of [
    (d) => { d.metadata.job_type = "JT00"; },
    (d) => { d.metadata.destination_scope = "US"; },
    (d) => { d.metadata.geography_vintage = 2024; },
    (d) => { d.metadata.geometry_crs = "EPSG:2263"; },
    (d) => { d.metadata.nyc_jobs++; },
    (d) => { d.metadata.max_pair_jobs++; },
    (d) => { d.metadata.display.min_link_width_px = 0; },
    (d) => { d.metadata.display.max_link_width_px = 0.1; },
    (d) => { d.metadata.display.size_scale = "linear"; },
    (d) => { d.metadata.display.min_node_radius_px = 0; },
    (d) => { d.metadata.display.max_node_radius_px = 1; },
    (d) => { d.features[0].geometry = null; },
    (d) => { d.features[0].properties.total++; },
    (d) => { d.features[0].properties.outside_nyc_jobs++; },
    (d) => { d.features[0].properties.geoid = 36061023802; },
    (d) => { d.features[0].properties.nta = "other"; },
    (d) => { d.features[0].properties.flows.push(d.features[0].properties.flows[0]); },
    (d) => { d.features[0].properties.flows[0].destination = "34001000100"; },
    (d) => { delete d.nodes[d.features[0].properties.flows[0].destination]; },
    (d) => { d.nodes[d.features[0].properties.geoid].center = [null, 40]; },
    (d) => { d.features[1] = d.features[0]; },
  ]) {
    const copy = structuredClone(data);
    edit(copy);
    assert.throws(() => model.normalize(copy));
  }
  for (const value of [null, undefined, -1, 0, "1", 1.2, NaN]) {
    const copy = structuredClone(data);
    copy.features[0].properties.flows[0].jobs = value;
    assert.throws(() => model.normalize(copy));
  }
});

test("line widths and node radii increase with counts on a fixed square-root scale", () => {
  const m = data.metadata;
  for (let count = 1; count <= m.max_pair_jobs; count++) {
    const width = model.linkWidth(count, m);
    assert.ok(width >= m.display.min_link_width_px && width <= m.display.max_link_width_px);
    assert.equal(width, m.display.min_link_width_px +
      Math.sqrt(count / m.max_pair_jobs) * (m.display.max_link_width_px - m.display.min_link_width_px));
    const radius = model.nodeRadius(count, m);
    assert.equal(radius, m.display.min_node_radius_px +
      Math.sqrt(count / m.max_pair_jobs) * (m.display.max_node_radius_px - m.display.min_node_radius_px));
    assert.ok(radius >= m.display.min_node_radius_px && radius <= m.display.max_node_radius_px);
    if (count > 1) assert.ok(radius > model.nodeRadius(count - 1, m));
    if (count > 1) assert.ok(width > model.linkWidth(count - 1, m));
  }
  assert.equal(model.linkWidth(m.max_pair_jobs, m), m.display.max_link_width_px);
  assert.equal(model.nodeRadius(m.max_pair_jobs, m), m.display.max_node_radius_px);
  assert.ok(model.linkWidth(10, m) > model.linkWidth(1, m) * 2);
  assert.ok(model.nodeRadius(1, m) < 2);
  for (const value of [null, 0, -1, 0.5, "1", m.max_pair_jobs + 1]) {
    assert.throws(() => model.linkWidth(value, m));
    assert.throws(() => model.nodeRadius(value, m));
  }
  assert.throws(() => model.nodeRadius(1, { ...m, display: { ...m.display, min_node_radius_px: null } }));
});

class Node {
  constructor(tag, ns = null) {
    this.tag = tag; this.namespaceURI = ns; this.children = []; this.attributes = {};
    this.listeners = {}; this.value = ""; this.hidden = false;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
}

function harness(fetch) {
  const ids = new Map();
  const get = (id) => {
    if (!ids.has(id)) ids.set(id, new Node("select"));
    return ids.get(id);
  };
  get("income-scale").value = "neighborhood";
  get("income-scale").options = ["block_group", "tract", "neighborhood", "community_district", "borough"]
    .map((value) => ({ value, disabled: false }));
  get("income-dataset").value = "household";
  const bounds = { isValid: () => true, pad: () => bounds, extend() { return this; } };
  const groups = [];
  const makeGroup = () => {
    const group = {
      layers: [], clearLayers() { this.layers = []; }, getBounds: () => bounds,
      addLayer(layer) { this.layers.push(layer); }, hasLayer(layer) { return this.layers.includes(layer); },
      removeLayer(layer) { this.layers = this.layers.filter((l) => l !== layer); },
      addTo(parent) { if (parent.addLayer) parent.addLayer(this); else parent.active = this; return this; },
    };
    groups.push(group);
    return group;
  };
  const line = (kind, points, options) => ({
    kind, points, options, bindTooltip(tooltip) { this.tooltip = tooltip; return this; },
    addTo(parent) { parent.addLayer(this); return this; },
  });
  const map = {
    active: null, closePopup() {}, removeLayer() { this.active = null; },
    setMinZoom() {}, setMaxBounds() {}, invalidateSize() {}, fitBounds() {},
    project: () => ({ x: 100, y: 100 }), unproject: (p) => p,
  };
  const context = {
    IncomeModel: income, TransportModel: transport, OriginDestinationModel: model, AbortController, console, map, fetch,
    document: {
      body: { dataset: { mode: "income" } }, getElementById: get, querySelector: () => get("map-shell"),
      querySelectorAll: () => [], createElement: (tag) => new Node(tag),
      createElementNS: (ns, tag) => new Node(tag, ns),
    },
    L: {
      featureGroup: makeGroup, canvas: () => ({}), latLngBounds: () => bounds,
      latLng: (lat, lng) => ({ lat, lng }), point: (x, y) => ({ x, y }),
      polyline: (points, options) => line("link", points, options),
      circleMarker: (point, options) => line("node", point, options),
      geoJSON(payload, options) {
        const layers = payload.features.map((feature) => {
          const layer = {
            feature, kind: "area", options, handlers: {}, bindTooltip(label) { this.tooltip = label; },
            bindPopup(render) { this.render = render; }, getPopup: () => ({ options: {} }),
            getBounds: () => bounds, openPopup() {}, setStyle(style) { this.style = style; },
            on(event, handler) { this.handlers[event] = handler; },
          };
          options.onEachFeature?.(feature, layer);
          return layer;
        });
        return { addTo(parent) { layers.forEach((layer) => parent.addLayer(layer)); } };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(read("income.js"), context);
  vm.runInContext(read("origin-destination.js"), context);
  return { context, get, map, group: groups[0], overlay: groups[1] };
}
const settle = () => new Promise(setImmediate);
const respond = async (url) => ({
  ok: true, json: async () => url.includes("od-boundaries-neighborhood") ? ntaBoundaries
    : url.includes("od-boundaries-tract") ? tractBoundaries
    : url.includes("origin-destination-nta") ? ntaData : url.includes("origin-destination") ? data : neighborhood,
});

test("native destination boundaries cover every node and reject wrong scale, omissions, duplicates and invalid geometry", () => {
  for (const [payload, snapshot, scale] of [
    [tractBoundaries, data, "tract"], [ntaBoundaries, ntaData, "neighborhood"],
  ]) {
    const boundaries = model.normalizeBoundaries(payload, snapshot, scale);
    assert.deepEqual(Object.keys(boundaries).sort(), Object.keys(snapshot.nodes).sort());
    for (const edit of [
      (d) => { d.metadata.scale = "wrong"; },
      (d) => { d.features.pop(); },
      (d) => { d.features[0] = d.features[1]; },
      (d) => { d.features[0].geometry = null; },
    ]) {
      const copy = structuredClone(payload);
      edit(copy);
      assert.throws(() => model.normalizeBoundaries(copy, snapshot, scale));
    }
  }
});

test("NTA all-origins toggle draws every pair without moving view and clears on selection, Home and scale changes", async () => {
  const { context, get, group, overlay } = harness(respond);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(get("od-show-all-control").hidden, true);
  assert.equal(get("od-show-all").disabled, true);
  assert.throws(() => context.showAllOriginDestinations());
  get("income-scale").value = "neighborhood";
  await get("income-scale").listeners.change();
  assert.equal(get("od-show-all-control").hidden, false);
  assert.equal(get("od-show-all").disabled, false);
  let cameraCalls = 0;
  context.map.fitBounds = () => { cameraCalls++; };
  get("od-show-all").checked = true;
  get("od-show-all").listeners.change({ target: get("od-show-all") });
  assert.equal(cameraCalls, 0);
  assert.equal(overlay.layers.filter((l) => l.kind === "link").length, 830);
  assert.equal(new Set(overlay.layers.filter((l) => l.kind === "link").map((l) => l.options.color)).size, 4);
  assert.equal(overlay.layers.filter((l) => l.kind === "link" && l.points.length === 33).length, 4);
  assert.equal(overlay.layers.filter((l) => l.kind === "node" && l.options.fillColor === "#c75200").length, 4);
  const destinations = overlay.layers.filter((l) => l.kind === "node" && l.options.fillColor !== "#c75200");
  assert.equal(destinations.length, 826);
  assert.ok(destinations.every((l) => l.options.fillColor === "#375a9e"));
  const expectedAreas = [...new Set(ntaData.features.flatMap((f) => f.properties.flows.map((flow) => flow.destination)))].sort();
  const outlines = overlay.layers.filter((l) => l.kind === "area");
  assert.deepEqual(outlines.map((l) => l.feature.properties.geoid).sort(), expectedAreas);
  assert.ok(outlines.every((l) => l.options.style.color === "#7542a6" &&
    l.options.style.fill === false && l.options.interactive === false));
  assert.equal(get("income-block-group").value, "");
  assert.equal(get("od-clear").disabled, false);
  context.openIncomeArea("MN0801-RI");
  assert.equal(cameraCalls, 0);
  assert.equal(get("od-show-all").checked, false);
  assert.equal(overlay.layers.filter((l) => l.kind === "link").length, 177);
  assert.ok(overlay.layers.filter((l) => l.kind === "node" && l.options.fillColor !== "#c75200")
    .every((l) => l.options.fillColor === "#375a9e"));
  context.showAllOriginDestinations();
  get("od-show-all").checked = false;
  get("od-show-all").listeners.change({ target: get("od-show-all") });
  assert.equal(cameraCalls, 0);
  assert.equal(overlay.layers.length, 0);
  assert.equal(group.layers.length, 4);
  context.showAllOriginDestinations();
  context.fitIncomeMap();
  assert.equal(cameraCalls, 1);
  assert.equal(get("od-show-all").checked, false);
  assert.equal(overlay.layers.length, 0);
  context.showAllOriginDestinations();
  get("income-scale").value = "tract";
  await get("income-scale").listeners.change();
  assert.equal(get("od-show-all-control").hidden, true);
  assert.equal(get("od-show-all").checked, false);
  assert.equal(get("od-show-all").disabled, true);
  assert.equal(overlay.layers.length, 0);
  assert.equal(group.layers.length, 30);
});

test("boundary fetch failures show Data error without partial origins and Retry restores the complete view", async () => {
  let failure = true;
  const { context, get, group, overlay } = harness(async (url) =>
    failure && url.includes("od-boundaries") ? { ok: false, status: 503 } : respond(url));
  context.console = { error() {} };
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(group.layers.length, 0);
  assert.equal(overlay.layers.length, 0);
  assert.ok(get("income-state").textContent.includes("HTTP 503"));
  assert.equal(get("income-retry").hidden, false);
  failure = false;
  await context.loadIncome();
  assert.equal(group.layers.length, 30);
  context.openIncomeArea(data.features[0].properties.geoid);
  assert.equal(overlay.layers.filter((l) => l.kind === "area").length, data.features[0].properties.flows.length);
});

test("minimum job-link slider filters inclusive pair counts, nodes, outlines and loops without camera changes", async () => {
  const { context, get, overlay } = harness(respond);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  let cameraCalls = 0;
  context.map.fitBounds = () => { cameraCalls++; };
  const slider = get("od-threshold");
  assert.equal(slider.disabled, false);
  assert.equal(slider.max, String(data.metadata.max_pair_jobs));
  const change = (minimum) => {
    slider.value = String(minimum);
    slider.listeners.input({ target: slider });
  };
  const verify = (origins, minimum) => {
    const expected = origins.flatMap((p) => p.flows.filter((f) => f.jobs >= minimum));
    const links = overlay.layers.filter((l) => l.kind === "link");
    assert.equal(links.length, expected.length);
    assert.deepEqual(overlay.layers.filter((l) => l.kind === "area").map((l) => l.feature.properties.geoid).sort(),
      [...new Set(expected.map((f) => f.destination))].sort());
    const self = origins.reduce((sum, p) => sum + p.flows.filter((f) => f.destination === p.geoid && f.jobs >= minimum).length, 0);
    assert.equal(links.filter((l) => l.points.length === 33).length, self);
    assert.equal(overlay.layers.filter((l) => l.kind === "node" && l.options.fillColor === "#375a9e").length,
      expected.length - self);
    assert.equal(overlay.layers.filter((l) => l.kind === "node" && l.options.fillColor === "#c75200").length, origins.length);
    const m = origins[0].scale === "tract" ? data.metadata : ntaData.metadata;
    assert.deepEqual(links.map((l) => l.options.weight).sort((a,b) => a-b),
      expected.map((f) => model.linkWidth(f.jobs, m)).sort((a,b) => a-b));
  };
  change(10);
  assert.equal(overlay.layers.length, 0);
  const p = data.features[0].properties;
  context.openIncomeArea(p.geoid);
  verify([p], 10);
  assert.ok(get("income-state").textContent.includes("hiding"));
  change(data.metadata.max_pair_jobs);
  verify([p], data.metadata.max_pair_jobs);
  change(1);
  verify([p], 1);
  assert.equal(cameraCalls, 0);
  get("income-scale").value = "neighborhood";
  await get("income-scale").listeners.change();
  cameraCalls = 0;
  assert.equal(slider.value, "1");
  assert.equal(slider.max, String(ntaData.metadata.max_pair_jobs));
  context.showAllOriginDestinations();
  change(100);
  verify(ntaData.features.map((f) => f.properties), 100);
  assert.equal(get("od-show-all").checked, true);
  const ri = ntaData.features.find((f) => f.properties.geoid === "MN0801-RI").properties;
  context.openIncomeArea(ri.geoid);
  verify([ri], 100);
  change(ntaData.metadata.max_pair_jobs);
  verify([ri], ntaData.metadata.max_pair_jobs);
  assert.ok(get("income-state").textContent.includes("showing 0"));
  assert.equal(cameraCalls, 0);
  for (const invalid of [0, -1, 1.5, NaN]) assert.throws(() => model.visibleFlows(p.flows, invalid));
});

test("OD loads lazily with origins only, selection draws all links/nodes and preserves self loops", async () => {
  const calls = [];
  const { context, get, group, overlay } = harness(async (url) => { calls.push(url); return respond(url); });
  await context.loadIncome();
  assert.ok(calls.every((url) => !url.includes("origin-destination")));
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(get("income-scale").value, "tract");
  assert.equal(get("income-scale").disabled, false);
  assert.equal(group.layers.length, 30);
  assert.equal(overlay.layers.length, 0);
  assert.equal(get("income-block-group").children.length, 31);
  assert.equal(get("data-source-eyebrow").textContent, "DATA / LODES 2023");
  assert.equal(get("nhgis-citation").hidden, true);
  const p = data.features.find((f) => f.properties.flows.some((flow) => flow.destination === f.properties.geoid)).properties;
  context.openIncomeArea(p.geoid);
  const links = overlay.layers.filter((layer) => layer.kind === "link");
  const nodes = overlay.layers.filter((layer) => layer.kind === "node");
  assert.equal(links.length, p.flows.length);
  assert.equal(nodes.length, p.flows.filter((flow) => flow.destination !== p.geoid).length + 1);
  assert.deepEqual(overlay.layers.filter((l) => l.kind === "area").map((l) => l.feature.properties.geoid).sort(),
    p.flows.map((flow) => flow.destination).sort());
  assert.equal(links.filter((layer) => layer.points.length === 33).length, 1);
  for (const flow of p.flows) {
    assert.ok(links.some((l) => l.options.weight === model.linkWidth(flow.jobs, data.metadata)));
    if (flow.destination !== p.geoid) {
      assert.ok(nodes.some((n) => n.options.radius === model.nodeRadius(flow.jobs, data.metadata)));
    }
  }
  assert.equal(get("income-block-group").value, p.geoid);
  assert.equal(get("od-clear").disabled, false);
  assert.equal(group.layers.length, 31);
  context.fitIncomeMap();
  assert.equal(overlay.layers.length, 0);
  assert.equal(group.layers.length, 30);
  assert.equal(get("income-block-group").value, "");
  const second = group.layers[1];
  second.handlers.click();
  assert.equal(get("income-block-group").value, second.feature.properties.geoid);
  get("income-block-group").value = "";
  get("income-block-group").listeners.change();
  assert.equal(overlay.layers.length, 0);
});

test("selection replaces prior connections, clearing and dataset switches remove overlays and restore household scale", async () => {
  const { context, get, group, overlay } = harness(respond);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  context.openIncomeArea(data.features[0].properties.geoid);
  context.openIncomeArea(data.features[1].properties.geoid);
  assert.equal(overlay.layers.filter((l) => l.kind === "link").length, data.features[1].properties.flows.length);
  get("od-clear").listeners.click();
  assert.equal(overlay.layers.length, 0);
  context.openIncomeArea(data.features[0].properties.geoid);
  get("income-dataset").value = "household";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(overlay.layers.length, 0);
  assert.equal(group.layers.length, 263);
  assert.equal(get("income-scale").value, "neighborhood");
  assert.equal(get("income-scale").disabled, false);
  assert.equal(get("od-controls").hidden, true);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(group.layers.length, 30);
  assert.equal(overlay.layers.length, 0);
});

test("dropdown and polygon selections preserve the map view; Home still resets it", async () => {
  const { context, get, group } = harness(respond);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  const cameraCalls = [];
  for (const method of ["fitBounds", "setView", "panTo", "panBy", "flyTo", "flyToBounds", "setZoom", "setMinZoom", "setMaxBounds"]) {
    context.map[method] = (...args) => { cameraCalls.push({ method, args }); };
  }
  get("income-block-group").value = data.features[0].properties.geoid;
  get("income-block-group").listeners.change();
  group.layers[1].handlers.click();
  context.openIncomeArea(data.features[2].properties.geoid);
  assert.deepEqual(cameraCalls, []);
  context.fitIncomeMap();
  assert.ok(cameraCalls.some((call) => call.method === "fitBounds"));
});

test("switching between tract-only datasets does not overwrite the saved household scale", async () => {
  const { context, get } = harness(respond);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  // Avoid a transportation fetch while exercising the same shared change handler.
  context.fetch = async () => ({ ok: false, status: 503 });
  context.console = { error() {} };
  get("income-dataset").value = "transport";
  get("income-dataset").listeners.change();
  await settle();
  get("income-dataset").value = "household";
  context.fetch = respond;
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(get("income-scale").value, "neighborhood");
});

  test("NTA snapshot partitions all tracts, keeps RI separate and exactly conserves every tract pair", () => {
    assert.equal(model.normalize(ntaData, "neighborhood"), ntaData);
    assert.throws(() => model.normalize(ntaData));
    assert.throws(() => model.normalize(data, "neighborhood"));
    assert.equal(ntaData.features.length, 4);
    assert.equal(Object.keys(ntaData.nodes).length, 263);
    assert.equal(ntaData.features.reduce((sum, f) => sum + f.properties.total, 0), 42310);
    assert.equal(ntaData.features.reduce((sum, f) => sum + f.properties.flows.length, 0), 830);
    assert.equal(ntaData.metadata.same_area_jobs, 1095);
    assert.equal(ntaData.metadata.max_pair_jobs, 4332);
    const mapping = new Map(Object.entries(ntaData.nodes).flatMap(([code, node]) => node.members.map((id) => [id, code])));
    assert.equal(mapping.size, 2327);
    assert.deepEqual(ntaData.nodes["MN0801-RI"].members, ["36061023802", "36061023803", "36061023804"]);
    assert.equal(ntaData.nodes.MN0801.name, "Upper East Side-Lenox Hill");
    assert.ok(ntaData.nodes.MN0801.members.every((id) => !ntaData.nodes["MN0801-RI"].members.includes(id)));
    const expected = new Map();
    for (const { properties: p } of data.features) {
      for (const flow of p.flows) {
        const key = `${mapping.get(p.geoid)}:${mapping.get(flow.destination)}`;
        expected.set(key, (expected.get(key) ?? 0) + flow.jobs);
      }
    }
    for (const { properties: p } of ntaData.features) {
      assert.equal(p.resident_primary_jobs, data.features.filter((f) => p.members.includes(f.properties.geoid))
        .reduce((sum, f) => sum + f.properties.resident_primary_jobs, 0));
      for (const flow of p.flows) assert.equal(flow.jobs, expected.get(`${p.geoid}:${flow.destination}`));
    }
  });

  test("invalid NTA membership, mixed geography, wrong split and mismatched origin members fail", () => {
    for (const edit of [
      (d) => { d.metadata.scale = "tract"; },
      (d) => { d.metadata.member_count++; },
      (d) => { d.metadata.node_count++; },
      (d) => { d.metadata.same_area_jobs++; },
      (d) => { d.nodes["MN0801-RI"].members.push(d.nodes.MN0801.members[0]); },
      (d) => { d.nodes.MN0801.members.push(d.nodes["MN0801-RI"].members[0]); },
      (d) => { d.nodes["MN0801-RI"].members.pop(); },
      (d) => { d.metadata.custom_split.source_nta = "MN0000"; },
      (d) => { d.features[0].properties.members.pop(); },
      (d) => { d.features[0].properties.flows[0].destination = "36061023802"; },
    ]) {
      const copy = structuredClone(ntaData);
      edit(copy);
      assert.throws(() => model.normalize(copy, "neighborhood"));
    }
  });

  test("OD NTA scale is selectable, loads four polygons only and preserves camera on every selection", async () => {
    const calls = [];
    const { context, get, group, overlay } = harness(async (url) => { calls.push(url); return respond(url); });
    get("income-dataset").value = "od";
    get("income-dataset").listeners.change();
    await settle();
    const options = get("income-scale").options;
    assert.deepEqual(options.filter((o) => !o.disabled).map((o) => o.value), ["tract", "neighborhood"]);
    get("income-scale").value = "neighborhood";
    await get("income-scale").listeners.change();
    assert.equal(group.layers.length, 4);
    assert.equal(overlay.layers.length, 0);
    assert.equal(get("income-block-group").children.length, 5);
    assert.ok(get("income-state").textContent.includes("NTA areas"));
    let cameraCalls = 0;
    context.map.fitBounds = () => { cameraCalls++; };
    context.openIncomeArea("MN0801-RI");
    context.openIncomeArea("QN0201");
    assert.equal(cameraCalls, 0);
    const p = ntaData.features.find((f) => f.properties.geoid === "QN0201").properties;
    assert.equal(overlay.layers.filter((l) => l.kind === "link").length, p.flows.length);
    assert.ok(get("od-selection").children.some((n) => n.textContent?.includes("NYC workplace NTA areas")));
    context.fitIncomeMap();
    assert.equal(cameraCalls, 1);
    assert.equal(overlay.layers.length, 0);
    get("income-scale").value = "tract";
    await get("income-scale").listeners.change();
    assert.equal(group.layers.length, 30);
    assert.equal(overlay.layers.length, 0);
    get("income-scale").value = "neighborhood";
    await get("income-scale").listeners.change();
    assert.equal(group.layers.length, 4);
    assert.equal(calls.filter((url) => url.includes("origin-destination-nta")).length, 1);
    get("income-dataset").value = "household";
    get("income-dataset").listeners.change();
    await settle();
    assert.equal(group.layers.length, 263);
    assert.equal(get("income-scale").value, "neighborhood");
    assert.ok(options.every((o) => !o.disabled));
    get("income-dataset").value = "od";
    get("income-dataset").listeners.change();
    await settle();
    assert.equal(get("income-scale").value, "neighborhood");
    assert.equal(group.layers.length, 4);
  });

  test("a stale NTA response cannot replace a newer tract scale selection", async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const { get, group } = harness(async (url) => {
      if (url.includes("origin-destination-nta")) await pending;
      return respond(url);
    });
    get("income-dataset").value = "od";
    get("income-dataset").listeners.change();
    await settle();
    get("income-scale").value = "neighborhood";
    const loading = get("income-scale").listeners.change();
    get("income-scale").value = "tract";
    await get("income-scale").listeners.change();
    release();
    await loading;
    assert.equal(group.layers.length, 30);
    assert.equal(get("income-scale").value, "tract");
  });
test("late OD loads cannot replace another dataset and failed loads explicitly clear and retry", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let failure = false;
  const { context, get, group, overlay } = harness(async (url) => {
    if (url.includes("origin-destination")) await pending;
    return failure ? { ok: false, status: 503 } : respond(url);
  });
  const errors = [];
  context.console = { error: (...args) => errors.push(args) };
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  get("income-dataset").value = "household";
  get("income-dataset").listeners.change();
  await settle();
  release();
  await settle();
  assert.equal(group.layers.length, 263);
  assert.equal(overlay.layers.length, 0);
  failure = true;
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(group.layers.length, 0);
  assert.equal(get("income-retry").hidden, false);
  assert.ok(get("income-state").textContent.includes("HTTP 503"));
  assert.equal(errors.length, 1);
  failure = false;
  await get("income-retry").listeners.click();
  assert.equal(group.layers.length, 30);
  assert.equal(overlay.layers.length, 0);
});
