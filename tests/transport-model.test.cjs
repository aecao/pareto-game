"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../transport-model.js");
const income = require("../income-model.js");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const source = JSON.parse(read("assets/income/transport-tracts.json"));
const geography = JSON.parse(read("assets/income/geographies/tract.json"));
const data = model.normalize(source, income.normalizeAreas(geography, "tract"));

test("all NYC tracts retain reconciled B08119 and separate B08301 universes", () => {
  assert.equal(data.features.length, 2327);
  assert.equal(data.features.reduce((sum, f) => sum + f.properties.total, 0), 3926603);
  assert.equal(data.features.reduce((sum, f) => sum + f.properties.pie_total, 0), 3926797);
  assert.equal(data.features.filter((f) => f.properties.total === 0).length, 90);
  data.features.forEach((f, i) => assert.equal(f.geometry, geography.features[i].geometry));
  assert.equal(geography.features[0].properties.dataset, undefined);
});

test("wrong tables, universes, keys, bands, categories and invalid counts fail explicitly", () => {
  const key = geography.features[0].properties.geoid;
  for (const edit of [
    (p) => { p.metadata.tables[0] = "B08301"; },
    (p) => { p.metadata.universe = "Households"; },
    (p) => { p.metadata.pie_universe = "Workers with earnings"; },
    (p) => { p.metadata.pie_moe_method = "sum"; },
    (p) => { p.earnings_labels.reverse(); },
    (p) => { p.modes.reverse(); },
    (p) => { p.pie_labels.pop(); },
    (p) => { p.tracts[key].total++; },
    (p) => { p.tracts[key].series[0].estimates[0]++; },
    (p) => { p.tracts[key].pie_total++; },
    (p) => { p.tracts[key].earnings_totals[0]++; },
    (p) => { delete p.tracts[key]; },
    (p) => { p.tracts.wrong = p.tracts[key]; delete p.tracts[key]; },
  ]) {
    const copy = structuredClone(source);
    edit(copy);
    assert.throws(() => model.normalize(copy, geography));
  }
  for (const value of [null, undefined, "1", -1, 0.1, NaN]) {
    for (const edit of [
      (p) => { p.tracts[key].series[0].moes[0] = value; },
      (p) => { p.tracts[key].total_moe = value; },
      (p) => { p.tracts[key].pie[0].moe = value; },
      (p) => { p.tracts[key].earnings_moes[0] = value; },
    ]) {
      const copy = structuredClone(source);
      edit(copy);
      assert.throws(() => model.normalize(copy, geography));
    }
  }
});

test("every stacked band has exact cumulative baselines and source-proportional thickness", () => {
  for (const { properties: p } of data.features) {
    const layout = model.stackedLayout(p);
    const totals = Array(8).fill(0);
    layout.series.forEach((series, mode) => {
      series.points.forEach((point, i) => {
        assert.equal(point.lower, totals[i]);
        totals[i] += p.series[mode].estimates[i];
        assert.equal(point.upper, totals[i]);
        assert.equal(point.y, 235 - totals[i] / layout.ceiling * 195);
        assert.ok(point.y >= 40 && point.y <= 235);
      });
      assert.ok(series.path.endsWith(" Z"));
    });
    assert.deepEqual(totals, p.earnings_totals);
    assert.equal(layout.xs[0], 64);
    assert.equal(layout.xs.at(-1), 714);
    assert.equal(layout.ticks[0], 0);
    assert.equal(layout.ticks.at(-1), layout.ceiling);
  }
});

test("pie shares reconcile, zeros have no wedge, and a single mode renders a complete circle", () => {
  for (const { properties: p } of data.features) {
    const slices = model.pieLayout(p.pie);
    assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.share, 0) - (p.pie_total ? 1 : 0)) < 1e-12);
    slices.forEach((slice, i) => {
      assert.equal(slice.share, p.pie_total ? p.pie[i].estimate / p.pie_total : 0);
      assert.equal(slice.path === "", p.pie[i].estimate === 0);
    });
  }
  assert.equal(model.pieLayout([{ estimate: 5 }])[0].path.match(/A100,100/g).length, 2);
  assert.throws(() => model.pieLayout([{ estimate: null }]));
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
const descendants = (node, tag) =>
  [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => descendants(child, tag))];

function harness(fetch) {
  const ids = new Map();
  const get = (id) => {
    if (!ids.has(id)) ids.set(id, new Node("select"));
    return ids.get(id);
  };
  get("income-scale").value = "neighborhood";
  get("income-dataset").value = "household";
  const notes = [new Node("p")];
  const bounds = { isValid: () => true, pad: () => bounds };
  const group = {
    layers: [], clearLayers() { this.layers = []; }, getBounds: () => bounds,
    addTo(map) { map.active = group; },
  };
  const map = {
    active: null, closePopup() {}, removeLayer() { this.active = null; },
    setMinZoom() {}, setMaxBounds() {}, invalidateSize() {}, fitBounds() {}, getSize: () => ({ x: 1200, y: 800 }),
  };
  const context = {
    IncomeModel: income, TransportModel: model, AbortController, console, map, fetch,
    document: {
      body: { dataset: { mode: "income" } }, getElementById: get,
      querySelector: () => get("map-shell"), querySelectorAll: () => notes,
      createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag, ns),
    },
    L: {
      featureGroup: () => group, canvas: () => ({}),
      geoJSON(payload, options) {
        const layers = payload.features.map((feature) => {
          const layer = {
            bindTooltip(label) { this.tooltip = label; },
            bindPopup(render) { this.render = render; }, getPopup: () => ({ options: {} }),
            getBounds: () => bounds, openPopup() { this.content = this.render(); }, on() {},
          };
          options.onEachFeature(feature, layer);
          return layer;
        });
        return { addTo() { group.layers = layers; } };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(read("income.js"), context);
  vm.runInContext(read("transport.js"), context);
  return { context, get, notes, group, map };
}

test("tract popup renders six stacked series beside the B08301 pie, exact uncertainty tables and no RI overlay", () => {
  const { context } = harness();
  for (const feature of [
    data.features.find((f) => f.properties.total > 0),
    data.features.find((f) => f.properties.total === 0 && f.properties.pie_total === 0),
  ]) {
    const popup = context.transportPopup(feature);
    assert.equal(descendants(popup, "svg").length, 2);
    assert.equal(descendants(popup, "path").filter((n) => n.attributes.class === "transport-stack").length, 6);
    assert.equal(descendants(popup, "circle").filter((n) => n.attributes.tabindex === "0").length, 48);
    assert.equal(descendants(popup, "tbody")[0].children.length, 62);
    assert.equal(descendants(popup, "tbody")[1].children.length, 10);
    assert.equal(descendants(popup, "details").length, 1);
    assert.ok(!descendants(popup, "p").some((n) => /Roosevelt/.test(n.textContent)));
    feature.properties.series.forEach((series, mode) => series.moes.forEach((moe, i) => {
      const dot = descendants(popup, "circle").filter((n) => n.attributes.tabindex === "0")[mode * 8 + i];
      assert.ok(dot.attributes["aria-label"].includes(`+/- ${moe.toLocaleString("en-US")}`));
    }));
    if (!feature.properties.total) {
      assert.ok(descendants(popup, "p").some((n) => n.textContent.includes("No estimated workers")));
      assert.equal(context.incomeMapStyle(feature).fillColor, "#bdbdbd");
      assert.ok(descendants(popup, "td").some((n) => n.textContent === "Unavailable"));
    }
  }
});

test("switching datasets locks tracts, restores household scale, caches separately and preserves Home", async () => {
  const calls = [];
  const neighborhood = JSON.parse(read("assets/income/geographies/neighborhood.json"));
  const { context, get, notes, group, map } = harness(async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.includes("transport-tracts") ? source : url.includes("tract.json") ? geography : neighborhood };
  });
  await context.loadIncome();
  assert.equal(group.layers.length, 263);
  get("income-dataset").value = "transport";
  get("income-dataset").listeners.change();
  await new Promise(setImmediate);
  assert.equal(get("income-scale").value, "tract");
  assert.equal(get("income-scale").disabled, true);
  assert.equal(notes[0].hidden, true);
  assert.equal(group.layers.length, 2327);
  assert.equal(get("income-block-group").disabled, false);
  assert.equal(get("income-block-group").children.length, 2328);
  assert.ok(group.layers[0].tooltip.includes("workers with earnings"));
  assert.ok(get("map-shell").attributes["aria-label"].includes("transportation"));
  context.fitIncomeMap();
  assert.equal(map.active, group);
  get("income-dataset").value = "household";
  get("income-dataset").listeners.change();
  await new Promise(setImmediate);
  assert.equal(get("income-scale").value, "neighborhood");
  assert.equal(get("income-scale").disabled, false);
  assert.equal(notes[0].hidden, false);
  assert.equal(group.layers.length, 263);
  get("income-dataset").value = "transport";
  get("income-dataset").listeners.change();
  await new Promise(setImmediate);
  assert.equal(group.layers.length, 2327);
  assert.equal(calls.length, 3);
});

test("stale transportation requests cannot replace household selection or re-add a layer in another mode", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const neighborhood = JSON.parse(read("assets/income/geographies/neighborhood.json"));
  const { context, get, group, map } = harness(async (url) => {
    if (url.includes("transport-tracts")) await pending;
    return { ok: true, json: async () => url.includes("transport-tracts") ? source : url.includes("tract.json") ? geography : neighborhood };
  });
  get("income-dataset").value = "transport";
  get("income-dataset").listeners.change();
  get("income-dataset").value = "household";
  get("income-dataset").listeners.change();
  await new Promise(setImmediate);
  release();
  await new Promise(setImmediate);
  assert.equal(group.layers.length, 263);
  assert.equal(get("income-scale").value, "neighborhood");
  get("income-dataset").value = "transport";
  context.document.body.dataset.mode = "exploration";
  get("income-dataset").listeners.change();
  map.active = null;
  await new Promise(setImmediate);
  assert.equal(group.layers.length, 2327);
  assert.equal(map.active, null);
});

test("failed loads clear map and selection with explicit error and Retry, then recover", async () => {
  let failure = true;
  const errors = [];
  const { context, get, group } = harness(async (url) => ({
    ok: !failure, status: 503,
    json: async () => url.includes("transport-tracts") ? source : geography,
  }));
  context.console = { error: (...args) => errors.push(args) };
  get("income-dataset").value = "transport";
  get("income-dataset").listeners.change();
  await new Promise(setImmediate);
  assert.equal(group.layers.length, 0);
  assert.equal(get("income-block-group").disabled, true);
  assert.equal(get("income-retry").hidden, false);
  assert.ok(get("income-state").textContent.includes("HTTP 503"));
  assert.equal(errors.length, 1);
  failure = false;
  await get("income-retry").listeners.click();
  assert.equal(group.layers.length, 2327);
  assert.equal(get("income-retry").hidden, true);
});
