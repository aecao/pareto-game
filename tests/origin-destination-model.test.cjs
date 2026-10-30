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
const incoming = JSON.parse(read("assets/income/destination-origin.json"));
const incomingNta = JSON.parse(read("assets/income/destination-origin-nta.json"));
const jobsNta = JSON.parse(read("assets/jobs_industry/neighborhood.json"));
const jobsTract = JSON.parse(read("assets/jobs_industry/tract.json"));
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
  get("jobs-classification").value = "broad";
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
    handlers: {}, on(event, handler) { this.handlers[event] = handler; return this; },
    addTo(parent) { parent.addLayer(this); return this; },
  });
  const map = {
    panes: {}, createPane(name) { return this.panes[name] = { style: {} }; },
    getPane(name) { return this.panes[name]; },
    active: null, closePopup() {}, removeLayer() { this.active = null; },
    setMinZoom() {}, setMaxBounds() {}, invalidateSize() {}, fitBounds() {},
    project: () => ({ x: 100, y: 100 }), unproject: (p) => p,
  };
  const context = {
    JobsIndustryModel: require("../jobs-industry-model.js"),
    JobsIndustryLayer: class {
      constructor(data) { this.data = data; }
      addTo(parent) { parent.addLayer(this); return this; }
    },
    IncomeModel: income, TransportModel: transport, OriginDestinationModel: model, AbortController, console, map, fetch,
    document: {
      body: { dataset: { mode: "income" } }, getElementById: get, querySelector: () => get("map-shell"),
      querySelectorAll: () => [], createElement: (tag) => new Node(tag),
      createElementNS: (ns, tag) => new Node(tag, ns),
    },
    L: {
      featureGroup: makeGroup, canvas: (options) => ({ options, kind: "canvas" }),
      svg: (options) => ({ options, kind: "svg" }), latLngBounds: () => bounds,
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
    : url.includes("jobs_industry/categories-neighborhood") ? JSON.parse(read("assets/jobs_industry/categories-neighborhood.json"))
    : url.includes("jobs_industry/categories-tract") ? JSON.parse(read("assets/jobs_industry/categories-tract.json"))
    : url.includes("jobs_industry/neighborhood") ? jobsNta
    : url.includes("jobs_industry/tract") ? jobsTract
    : url.includes("od-boundaries-tract") ? tractBoundaries
    : url.includes("destination-origin-nta") ? incomingNta
    : url.includes("destination-origin") ? incoming
    : url.includes("origin-destination-nta") ? ntaData : url.includes("origin-destination") ? data : neighborhood,
});

test("jobs data loads lazily, limits scales, restores separate memories and clears on dataset switches", async () => {
  const calls = [];
  const { context, get, group } = harness(async url => { calls.push(url); return respond(url); });
  await context.loadIncome();
  assert.ok(calls.every(url => !url.includes("jobs_industry")));
  get("income-dataset").value = "jobs";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(get("jobs-industry-controls").hidden, false);
  assert.equal(get("od-controls").hidden, true);
  assert.equal(get("nhgis-citation").hidden, true);
  assert.equal(group.layers.filter(l => l.data?.metadata.dataset === "jobs_industry").length, 1);
  assert.equal(group.layers.filter(l => l.feature).length, 263);
  assert.deepEqual(get("income-scale").options.filter(o => !o.disabled).map(o => o.value), ["tract", "neighborhood"]);
  get("jobs-classification").value = "sectors";
  get("income-scale").value = "tract";
  await get("income-scale").listeners.change();
  assert.equal(group.layers.filter(l => l.feature).length, 2327);
  assert.equal(get("jobs-classification").value, "sectors");
  assert.equal(get("jobs-industry-legend").children.length, 20);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(group.layers.length, 30);
  get("income-dataset").value = "jobs";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(get("income-scale").value, "tract");
  assert.equal(get("jobs-classification").value, "sectors");
  assert.equal(calls.filter(url => url.includes("jobs_industry/tract")).length, 1);
});

test("category-only failures or mismatched snapshots clear jobs, disable classification and recover through Retry", async () => {
  for (const invalid of ["http", "schema"]) {
    let fail = true;
    const { context, get, group } = harness(async url => {
      if (fail && url.includes("jobs_industry/categories-")) {
        return invalid === "http" ? { ok: false, status: 503 } : {
          ok: true, json: async () => ({ ...JSON.parse(read("assets/jobs_industry/categories-neighborhood.json")),
            areas: {} }),
        };
      }
      return respond(url);
    });
    const errors = [];
    context.console = { error: (...args) => errors.push(args) };
    get("income-dataset").value = "jobs";
    get("income-dataset").listeners.change();
    await settle();
    assert.equal(group.layers.length, 0);
    assert.equal(get("jobs-classification").disabled, true);
    assert.equal(get("income-retry").hidden, false);
    assert.equal(errors.length, 1);
    assert.match(get("income-state").textContent, invalid === "http" ? /HTTP 503/ : /classification snapshot/);
    fail = false;
    await get("income-retry").listeners.click();
    assert.equal(get("jobs-classification").disabled, false);
    assert.equal(group.layers.filter(l => l.feature).length, 263);
  }
});

test("late jobs response cannot replace newer dataset and missing assets show explicit Retry", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { context, get, group } = harness(async url => {
    if (url.includes("jobs_industry")) await pending;
    return respond(url);
  });
  get("income-dataset").value = "jobs";
  get("income-dataset").listeners.change();
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  release();
  await settle();
  assert.equal(group.layers.length, 30);
  const failed = harness(async () => ({ ok: false, status: 503 }));
  failed.context.console = { error() {} };
  failed.get("income-dataset").value = "jobs";
  failed.get("income-dataset").listeners.change();
  await settle();
  assert.equal(failed.group.layers.length, 0);
  assert.ok(failed.get("income-state").textContent.includes("HTTP 503"));
  assert.equal(failed.get("income-retry").hidden, false);
});

test("incoming workplace snapshots reconcile every tract pair to NTA and preserve direction and scope", () => {
  assert.equal(model.normalize(incoming, "tract", "do"), incoming);
  assert.equal(model.normalize(incomingNta, "neighborhood", "do"), incomingNta);
  assert.throws(() => model.normalize(incoming));
  assert.throws(() => model.normalize(data, "tract", "do"));
  assert.equal(incoming.features.length, 91);
  assert.equal(incomingNta.features.length, 10);
  const membership = new Map(Object.entries(incomingNta.nodes).flatMap(([code, n]) => n.members.map(id => [id, code])));
  const expected = new Map();
  for (const f of incoming.features) for (const flow of f.properties.flows) {
    const key = `${membership.get(f.properties.geoid)}:${membership.get(flow.destination)}`;
    expected.set(key, (expected.get(key) ?? 0) + flow.jobs);
  }
  assert.equal(expected.size, 2411);
  assert.equal(incoming.features.reduce((n,f) => n + f.properties.flows.length, 0), 125023);
  for (const f of incomingNta.features) for (const flow of f.properties.flows) {
    assert.equal(flow.jobs, expected.get(`${f.properties.geoid}:${flow.destination}`));
  }
  for (const [snapshot, scale] of [[incoming, "tract"], [incomingNta, "neighborhood"]]) {
    assert.equal(snapshot.features.reduce((n,f) => n + f.properties.total, 0), 946971);
    for (const edit of [
      d => { d.metadata.residence_scope = "all"; },
      d => { d.metadata.direction = "od"; },
      d => { d.features[0].properties.total++; },
      d => { d.features[0].properties.flows[0].jobs++; },
    ]) {
      const copy = structuredClone(snapshot);
      edit(copy);
      assert.throws(() => model.normalize(copy, scale, "do"));
    }
  }
});

test("destination-origin selection reverses labels, draws residence areas and loops, and retains independent scale/cache", async () => {
  const calls = [];
  const { context, get, group, overlay } = harness(async url => { calls.push(url); return respond(url); });
  get("income-dataset").value = "do";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(group.layers.length, 10);
  assert.equal(get("od-show-all-control").hidden, true);
  assert.equal(get("od-show-all").disabled, true);
  assert.throws(() => context.showAllOriginDestinations());
  let camera = 0;
  context.map.fitBounds = () => { camera++; };
  const ri = incomingNta.features.find(f => f.properties.geoid === "MN0801-RI").properties;
  context.openIncomeArea(ri.geoid);
  assert.equal(overlay.layers.filter(l => l.kind === "link").length, 199);
  assert.equal(overlay.layers.filter(l => l.kind === "link" && l.points.length === 33).length, 1);
  assert.equal(overlay.layers.filter(l => l.kind === "area").length, 199);
  assert.ok(get("od-selection").children.some(n => n.textContent?.includes("incoming primary-job links")));
  const originNode = overlay.layers.find(l => l.kind === "node" && l.options.fillColor === "#c75200");
  assert.ok(originNode.tooltip.textContent.startsWith("Workplace destination:"));
  const residence = overlay.layers.find(l => l.kind === "node" && l.options.fillColor === "#375a9e");
  assert.ok(residence.tooltip.textContent.includes("to Roosevelt Island"));
  get("od-threshold-number").value = "100";
  get("od-threshold-number").listeners.change({ target: get("od-threshold-number") });
  assert.equal(overlay.layers.filter(l => l.kind === "link").length, ri.flows.filter(f => f.jobs >= 100).length);
  context.openIncomeArea("MN0502");
  assert.equal(camera, 0);
  get("income-scale").value = "tract";
  await get("income-scale").listeners.change();
  assert.equal(group.layers.length, 91);
  camera = 0;
  context.openIncomeArea(incoming.features[0].properties.geoid);
  assert.equal(camera, 0);
  get("income-dataset").value = "od";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(group.layers.length, 30);
  assert.equal(overlay.layers.length, 0);
  get("income-dataset").value = "do";
  get("income-dataset").listeners.change();
  await settle();
  assert.equal(group.layers.length, 91);
  assert.equal(calls.filter(url => url.includes("destination-origin.json")).length, 1);
});

test("selectable-area links use a brighter upper pane in both directions and scales, with nodes above", async () => {
  const { context, get, map, overlay } = harness(respond);
  for (const [dataset, scale, snapshot] of [
    ["od", "tract", data], ["od", "neighborhood", ntaData],
    ["do", "neighborhood", incomingNta], ["do", "tract", incoming],
  ]) {
    get("income-dataset").value = dataset;
    get("income-dataset").listeners.change();
    await settle();
    get("income-scale").value = scale;
    await get("income-scale").listeners.change();
    const p = snapshot.features[0].properties;
    context.openIncomeArea(p.geoid);
    const selectable = new Set(snapshot.features.map(f => f.properties.geoid));
    const expected = p.flows.filter(f => selectable.has(f.destination));
    const highlighted = overlay.layers.filter(l => l.kind === "link" && l.options.color === "#e000ff");
    assert.equal(highlighted.length, expected.length);
    assert.ok(highlighted.length > 0);
    assert.ok(highlighted.every(l => l.options.opacity > 0.2 && l.options.opacity <= 0.95 &&
      l.options.renderer.options.pane === "od-key-connections"));
    assert.ok(overlay.layers.filter(l => l.kind === "link" && l.options.color !== "#e000ff")
      .every(l => l.options.opacity > 0.08 && l.options.opacity <= 0.55 && l.options.renderer.options.pane === "od-connections"));
    assert.ok(overlay.layers.filter(l => l.kind === "link")
      .every(l => l.options.interactive === false && l.tooltip === undefined));
    assert.ok(overlay.layers.filter(l => l.kind === "node")
      .every(l => l.options.renderer.options.pane === "od-nodes" && l.options.renderer.kind === "svg"));
    assert.equal(map.panes["od-connections"].style.pointerEvents, "none");
    assert.equal(map.panes["od-key-connections"].style.pointerEvents, "none");
    assert.equal(Number(map.panes["od-key-connections"].style.zIndex), 410);
    assert.ok(Number(map.panes["od-nodes"].style.zIndex) > 410);
    get("od-threshold-number").value = String(snapshot.metadata.max_pair_jobs);
    get("od-threshold-number").listeners.change({ target: get("od-threshold-number") });
    assert.equal(overlay.layers.filter(l => l.kind === "link" && l.options.color === "#e000ff").length,
      expected.filter(f => f.jobs >= snapshot.metadata.max_pair_jobs).length);
    context.clearOriginDestination();
    assert.equal(overlay.layers.length, 0);
  }
});

test("connection opacity grows with count on fixed scale and key links remain brighter", () => {
  for (const snapshot of [data, ntaData, incoming, incomingNta]) {
    const m = snapshot.metadata;
    for (let jobs = 1; jobs <= m.max_pair_jobs; jobs++) {
      const ordinary = model.linkOpacity(jobs, m);
      const key = model.linkOpacity(jobs, m, true);
      assert.ok(key > ordinary && key <= 0.95 && ordinary > 0);
      if (jobs > 1) {
        assert.ok(ordinary > model.linkOpacity(jobs - 1, m));
        assert.ok(key > model.linkOpacity(jobs - 1, m, true));
      }
    }
    assert.ok(Math.abs(model.linkOpacity(m.max_pair_jobs, m) - 0.55) < 1e-12);
    assert.ok(Math.abs(model.linkOpacity(m.max_pair_jobs, m, true) - 0.95) < 1e-12);
    for (const value of [0, -1, 0.5, NaN, m.max_pair_jobs + 1]) {
      assert.throws(() => model.linkOpacity(value, m));
    }
  }
});

test("Data reuses one polygon canvas across reloads while selectable SVG nodes change commute selection", async () => {
  const { context, get, group, overlay, map } = harness(respond);
  const renderers = [];
  for (const [dataset, scale, snapshot] of [
    ["od", "tract", data], ["od", "neighborhood", ntaData],
    ["do", "neighborhood", incomingNta], ["do", "tract", incoming],
  ]) {
    get("income-dataset").value = dataset;
    get("income-dataset").listeners.change();
    await settle();
    get("income-scale").value = scale;
    await get("income-scale").listeners.change();
    renderers.push(group.layers.find(l => l.kind === "area").options.renderer);
    const selectable = new Set(snapshot.features.map(f => f.properties.geoid));
    const source = snapshot.features.find(f => f.properties.flows.some(flow =>
      flow.destination !== f.properties.geoid && selectable.has(flow.destination)));
    context.openIncomeArea(source.properties.geoid);
    const destination = source.properties.flows.find(flow =>
      flow.destination !== source.properties.geoid && selectable.has(flow.destination));
    const marker = overlay.layers.find(l => l.kind === "node" && l.handlers.click &&
      l.points[0] === snapshot.nodes[destination.destination].center[1] &&
      l.points[1] === snapshot.nodes[destination.destination].center[0]);
    assert.ok(marker, "selectable endpoint has a direct click handler, without a canvas hit-testing surface");
    const before = overlay.layers.length;
    marker.handlers.click();
    assert.equal(get("income-block-group").value, destination.destination);
    assert.ok(overlay.layers.length > 0 && before > 0);
    const otherMarker = overlay.layers.find(l => l.kind === "node" && !l.handlers.click &&
      l.options.fillColor === "#375a9e");
    assert.ok(otherMarker?.tooltip, "nonselectable linked nodes still show tooltips");
  }
  assert.ok(renderers.every(renderer => renderer === renderers[0]), "reloads must not stack empty hit-testing canvases");
  assert.equal(map.panes["od-connections"].style.pointerEvents, "none");
  assert.equal(map.panes["od-key-connections"].style.pointerEvents, "none");
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
  assert.equal(new Set(overlay.layers.filter((l) => l.kind === "link").map((l) => l.options.color)).size, 5);
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
  assert.equal(slider.max, "1000");
  assert.equal(get("od-threshold-number").max, String(data.metadata.max_pair_jobs));
  const change = (minimum) => {
    slider.value = String(model.thresholdPosition(minimum, Number(get("od-threshold-number").max)));
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
  assert.equal(slider.value, "0");
  assert.equal(slider.max, "1000");
  assert.equal(get("od-threshold-number").value, "1");
  assert.equal(get("od-threshold-number").max, String(ntaData.metadata.max_pair_jobs));
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

test("logarithmic threshold is monotonic, precise at low counts and exact for numeric entry", async () => {
  for (const maximum of [1, 185, 434, 4332, 8171]) {
    assert.equal(model.thresholdFromPosition(0, maximum), 1);
    assert.equal(model.thresholdFromPosition(1000, maximum), maximum);
    for (let value = 1; value <= maximum; value++) {
      assert.equal(model.thresholdFromPosition(model.thresholdPosition(value, maximum), maximum), value);
    }
    let previous = 1;
    for (let position = 0; position <= 1000; position++) {
      const current = model.thresholdFromPosition(position, maximum);
      assert.ok(current >= previous);
      previous = current;
    }
  }
  assert.ok(model.thresholdFromPosition(500, 8171) < 100);
  const { context, get, overlay } = harness(respond);
  get("income-dataset").value = "do";
  get("income-dataset").listeners.change();
  await settle();
  context.openIncomeArea("MN0502");
  let camera = 0;
  context.map.fitBounds = () => { camera++; };
  const number = get("od-threshold-number");
  number.value = "460";
  number.listeners.change({ target: number });
  assert.equal(get("od-threshold-value").textContent, "460");
  assert.equal(Number(get("od-threshold").value), model.thresholdPosition(460, 8171));
  const count = overlay.layers.filter(l => l.kind === "link").length;
  assert.equal(count, incomingNta.features.find(f => f.properties.geoid === "MN0502").properties.flows.filter(f => f.jobs >= 460).length);
  for (const invalid of ["", "0", "-1", "1.5", "8172", "abc"]) {
    number.value = invalid;
    number.listeners.change({ target: number });
    assert.equal(number.attributes["aria-invalid"], "true");
    assert.ok(get("od-threshold-error").textContent.includes("still uses 460"));
    assert.equal(overlay.layers.filter(l => l.kind === "link").length, count);
  }
  get("od-threshold").value = "0";
  get("od-threshold").listeners.input({ target: get("od-threshold") });
  assert.equal(number.value, "1");
  assert.equal(number.attributes["aria-invalid"], "false");
  assert.equal(get("od-threshold-error").textContent, "");
  assert.equal(camera, 0);
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
