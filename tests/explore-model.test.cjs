"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const vm = require("node:vm");
const model = require("../explore-model.js");
const root = path.join(__dirname, "..");
const assets = path.join(root, "assets/explore_lite8");
const catalog = JSON.parse(fs.readFileSync(path.join(assets, "index.json"), "utf8"));

test("catalog contains seven reconciled source layers and user-approved industrial classes", () => {
  assert.equal(model.validateIndex(catalog), catalog);
  const expected = { vacant: 24380, historic: 31684, industrial: 15363, ownership: 856906, parking: 20429, parks: 2061, waterfront: 199 };
  assert.deepEqual(Object.fromEntries(catalog.layers.map((layer) => [layer.id, layer.features])), expected);
  const industry = catalog.layers.find((layer) => layer.id === "industrial");
  assert.deepEqual(industry.categories.map((cat) => [cat.value, cat.label, cat.count]), [
    ["06", "Industrial", 9293], ["07", "Transportation", 6070],
  ]);
  const historic = catalog.layers.find((layer) => layer.id === "historic");
  assert.equal(historic.collapsed, true);
  assert.equal(historic.visible, false);
  assert.equal(catalog.layers.find((layer) => layer.id === "ownership").visible, false);
  assert.equal(historic.group, "historic");
  assert.equal(catalog.layers.find((layer) => layer.id === "ownership").group, "ownership");
  assert.equal(industry.group, "industrial");
  for (const layer of catalog.layers) {
    assert.equal(new Set(layer.categories.map((cat) => cat.color)).size, layer.categories.length);
  }
});

test("invalid category totals and unsafe tile paths are rejected explicitly", () => {
  const bad = structuredClone(catalog);
  bad.layers[0].categories[0].count++;
  assert.throws(() => model.validateIndex(bad));
  const unsafe = structuredClone(catalog);
  unsafe.groups.ownership.tiles["../escape"] = Object.values(unsafe.groups.ownership.tiles)[0];
  assert.throws(() => model.validateIndex(unsafe));
});

test("XYZ viewport keys include the Roosevelt Island tile and clamp Mercator bounds", () => {
  assert.deepEqual(model.tilesForBounds({ west: -73.95, east: -73.95, south: 40.76, north: 40.76 }, 14), ["4826_6157"]);
  const keys = model.tilesForBounds({ west: 180, east: 180, south: 90, north: 90 }, 14);
  assert.deepEqual(keys, ["16383_0"]);
});

test("isolated layer tiles deduplicate features and filter category membership", () => {
  const definition = catalog.layers.find((layer) => layer.id === "industrial");
  const samples = Object.keys(catalog.groups.industrial.tiles).slice(0, 4).map((key) =>
    JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(assets, `industrial/${key}.json.gz`)))));
  const all = model.visibleFeatures([...samples, ...samples], definition, new Set(["c0", "c1"]));
  assert.equal(new Set(all.map((feature) => feature.id)).size, all.length);
  for (const feature of all) assert.ok(["06", "07"].includes(feature.properties.attributes.LandUse));
  const industrial = model.visibleFeatures(samples, definition, new Set(["c0"]));
  assert.ok(industrial.every((feature) => feature.properties.attributes.LandUse === "06"));
  assert.deepEqual(model.visibleFeatures(samples, definition, new Set()), []);
  assert.throws(() => model.visibleFeatures([{ type: "FeatureCollection", features: [{}] }], definition, new Set()));
});

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; this.style = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { this.events[name] = callback; }
}
test("reference-style disclosure and layer/category master controls preserve independent state", async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Node("div"));
    return elements.get(id);
  };
  const context = {
    ExploreModel: model, AbortController, setTimeout, clearTimeout, console,
    fetch: () => new Promise(() => {}),
    document: { createElement: (tag) => new Node(tag), getElementById: element, body: { dataset: { mode: "siting" } } },
    L: { featureGroup: () => ({}), canvas: () => ({}) }, map: { on() {} },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "explore.js"), "utf8"), context);
  context.testCatalog = catalog;
  vm.runInContext("exploreIndex = testCatalog; renderExploreControls();", context);
  const state = vm.runInContext("exploreLayers.get('industrial')", context);
  state.inputs.get("c0").checked = false;
  state.inputs.get("c0").events.change();
  assert.deepEqual([...state.selected], ["c1"]);
  assert.equal(state.all.indeterminate, true);
  state.master.checked = false;
  state.master.events.change();
  assert.equal(state.enabled, false);
  state.master.checked = true;
  state.master.events.change();
  assert.deepEqual([...state.selected], ["c1"]);
  state.all.checked = false;
  state.all.events.change();
  assert.equal(state.selected.size, 0);
  assert.equal(state.enabled, false);
  state.all.checked = true;
  state.all.events.change();
  assert.equal(state.selected.size, 2);
  assert.equal(state.enabled, true);
  const historic = element("explore-layers").children[1];
  const toggle = historic.children[0].children[0];
  assert.equal(historic.children[1].hidden, true);
  toggle.events.click();
  assert.equal(historic.children[1].hidden, false);
  assert.equal(toggle.attributes["aria-expanded"], "true");
});
