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

test("link widths increase linearly with actual counts using one fixed cross-origin scale", () => {
  const m = data.metadata;
  for (let count = 1; count <= m.max_pair_jobs; count++) {
    const width = model.linkWidth(count, m);
    assert.ok(width >= m.display.min_link_width_px && width <= m.display.max_link_width_px);
    assert.equal(width, m.display.min_link_width_px +
      count / m.max_pair_jobs * (m.display.max_link_width_px - m.display.min_link_width_px));
    if (count > 1) assert.ok(width > model.linkWidth(count - 1, m));
  }
  assert.equal(model.linkWidth(m.max_pair_jobs, m), m.display.max_link_width_px);
  for (const value of [null, 0, -1, 0.5, "1", m.max_pair_jobs + 1]) assert.throws(() => model.linkWidth(value, m));
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
            feature, handlers: {}, bindTooltip(label) { this.tooltip = label; },
            bindPopup(render) { this.render = render; }, getPopup: () => ({ options: {} }),
            getBounds: () => bounds, openPopup() {}, setStyle(style) { this.style = style; },
            on(event, handler) { this.handlers[event] = handler; },
          };
          options.onEachFeature(feature, layer);
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
const respond = async (url) => ({ ok: true, json: async () => url.includes("origin-destination") ? data : neighborhood });

test("OD loads lazily with origins only, selection draws all links/nodes and preserves self loops", async () => {
  const calls = [];
  const { context, get, group, overlay } = harness(async (url) => { calls.push(url); return respond(url); });
  await context.loadIncome();
  assert.ok(calls.every((url) => !url.includes("origin-destination")));
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(get("income-scale").value, "tract");
  assert.equal(get("income-scale").disabled, true);
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
  assert.equal(links.filter((layer) => layer.points.length === 33).length, 1);
  for (const flow of p.flows) {
    assert.ok(links.some((l) => l.options.weight === model.linkWidth(flow.jobs, data.metadata)));
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
