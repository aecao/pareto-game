"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../income-model.js");
const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "../assets/income/tracts.json"), "utf8"));
const changed = (edit) => { const copy = structuredClone(payload); edit(copy.features[0].properties, copy); return copy; };

test("official snapshot validates all 183 unique tracts and district memberships", () => {
  assert.equal(model.normalize(payload), payload);
  assert.equal(payload.features.length, 183);
  assert.equal(payload.features.filter((f) => f.properties.partial_overlap).length, 42);
  assert.equal(payload.features.filter((f) => f.properties.total === 0).length, 9);
  for (const [code, count] of Object.entries({ 106: 28, 108: 42, 401: 66, 402: 50 })) {
    assert.equal(payload.features.filter((f) => f.properties.districts.includes(code)).length, count);
  }
});

test("missing, fractional, negative and string counts and MOEs are rejected, never imputed", () => {
  for (const value of [null, undefined, -1, 0.1, "1", NaN]) {
    assert.throws(() => model.normalize(changed((p) => { p.bins[0].estimate = value; })));
    assert.throws(() => model.normalize(changed((p) => { p.bins[0].moe = value; })));
    assert.throws(() => model.normalize(changed((p) => { p.total_moe = value; })));
  }
});

test("zero totals must reconcile, and extra/misordered bands cannot pass", () => {
  assert.throws(() => model.normalize(changed((p) => { p.total = 0; p.bins[0].estimate = 1; })));
  assert.throws(() => model.normalize(changed((p) => { p.bins.reverse(); })));
  assert.throws(() => model.normalize(changed((p) => { p.bins.push(p.bins[0]); })));
  assert.throws(() => model.normalize(changed((p) => { p.with_income++; })));
});

test("bad geometry, keys, policy, district membership and outlines are rejected", () => {
  for (const edit of [
    (p, d) => { d.features[0].geometry = null; },
    (p) => { p.geoid = ""; },
    (p, d) => { d.features[1].properties.geoid = p.geoid; },
    (p) => { p.districts = ["999"]; },
    (p) => { p.district_shares["106"] = 2; },
    (p) => { p.partial_overlap = !p.partial_overlap; },
    (p, d) => { d.metadata.area_threshold = 0; },
    (p, d) => { d.districts.features.pop(); },
  ]) assert.throws(() => model.normalize(changed(edit)));
});

test("bar heights are exactly proportional and zero estimates have zero height", () => {
  for (const feature of payload.features) {
    const bins = feature.properties.bins;
    const layout = model.chartLayout(bins);
    assert.equal(layout.ticks[0], 0);
    assert.equal(layout.ticks.at(-1), layout.ceiling);
    bins.forEach((bin, i) => assert.equal(layout.heights[i], bin.estimate / layout.ceiling * 180));
    assert.ok(layout.heights.every((height) => height >= 0 && height <= 180));
  }
});

class Node {
  constructor(tag, ns = null) { this.tag = tag; this.namespaceURI = ns; this.children = []; this.attributes = {}; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener() {}
}
function descendants(node, tag) {
  return [...(node.tag === tag ? [node] : []), ...node.children.flatMap((child) => descendants(child, tag))];
}
test("popup renders nine bars, complete band labels, real numeric y ticks and exact MOE table", () => {
  const context = {
    IncomeModel: model, L: { featureGroup: () => ({}) },
    document: { createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag, ns),
      getElementById: () => new Node("select") },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../income.js"), "utf8"), context);
  for (const feature of [payload.features[0], payload.features.find((f) => f.properties.total === 0)]) {
    const popup = context.incomePopup(feature);
    const bars = descendants(popup, "rect");
    assert.equal(bars.length, 9);
    feature.properties.bins.forEach((bin, i) => {
      if (bin.estimate === 0) assert.equal(bars[i].attributes.height, "0");
      assert.ok(bars[i].attributes["aria-label"].includes(bin.moe.toLocaleString("en-US")));
    });
    assert.equal(descendants(popup, "tbody")[0].children.length, 9);
    assert.ok(descendants(popup, "text").some((node) => node.textContent === "0"));
    assert.ok(descendants(popup, "tspan").some((node) => node.textContent === "or loss"));
    assert.ok(descendants(popup, "tspan").some((node) => node.textContent === "or more"));
  }
});
