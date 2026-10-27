"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../income-model.js");
const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "../assets/income/block-groups.json"), "utf8"));
const changed = (edit) => { const copy = structuredClone(payload); edit(copy.features[0].properties, copy); return copy; };

test("NHGIS snapshot validates every NYC block group without district boundaries", () => {
  assert.equal(model.normalize(payload), payload);
  assert.equal(payload.features.length, 6807);
  assert.equal(payload.features.filter((f) => f.properties.total === 0).length, 442);
  assert.equal(payload.districts, undefined);
  for (const [borough, count] of Object.entries({ Bronx: 1182, Brooklyn: 2156, Manhattan: 1292, Queens: 1803, "Staten Island": 374 })) {
    assert.equal(payload.features.filter((f) => f.properties.borough === borough).length, count);
  }
});

test("missing, fractional, negative and string counts and MOEs are rejected, never imputed", () => {
  const small = { ...payload, features: [payload.features[0]], metadata: { ...payload.metadata, feature_count: 1 } };
  for (const value of [null, undefined, -1, 0.1, "1", NaN]) {
    for (const field of ["estimate", "moe"]) {
      const copy = structuredClone(small);
      copy.features[0].properties.bins[0][field] = value;
      assert.throws(() => model.normalize(copy));
    }
    const copy = structuredClone(small);
    copy.features[0].properties.total_moe = value;
    assert.throws(() => model.normalize(copy));
  }
});

test("zero totals must reconcile, and extra/misordered bands cannot pass", () => {
  assert.throws(() => model.normalize(changed((p) => { p.total = 0; p.bins[0].estimate = 1; })));
  assert.throws(() => model.normalize(changed((p) => { p.bins.reverse(); })));
  assert.throws(() => model.normalize(changed((p) => { p.bins.push(p.bins[0]); })));
  assert.throws(() => model.normalize(changed((p) => { p.total++; })));
});

test("bad geometry, keys, geography and the wrong income universe are rejected", () => {
  for (const edit of [
    (p, d) => { d.features[0].geometry = null; },
    (p) => { p.geoid = ""; },
    (p, d) => { d.features[1].properties.geoid = p.geoid; },
    (p) => { p.districts = ["999"]; },
    (p) => { p.geoid = "36005000100"; },
    (p) => { p.borough = "Queens"; },
    (p) => { p.block_group = "7"; },
    (p, d) => { d.metadata.table = "B06010"; },
    (p, d) => { d.metadata.universe = "People"; },
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

test("filled-line layout uses dollar spacing and preserves every source count without smoothing", () => {
  const bins = payload.features.find((f) => f.properties.total > 0).properties.bins;
  const layout = model.areaLayout(bins);
  assert.equal(layout.points.length, 16);
  assert.equal(layout.points[0].income, 0);
  assert.equal(layout.points[1].income, 12500);
  assert.equal(layout.points[12].income, 112500);
  assert.equal(layout.points.at(-1).income, 200000);
  assert.ok(layout.points.every((point, i) => point.y === 242 - bins[i].estimate / layout.ceiling * 205));
  assert.ok(layout.points.every((point, i) => i === 0 || point.x > layout.points[i - 1].x));
  assert.equal(layout.line.split(" L").length, 16);
  assert.ok(layout.area.endsWith(" L764,242 L76,242 Z"));
  const zero = model.areaLayout(bins.map((bin) => ({ ...bin, estimate: 0 })));
  assert.ok(zero.points.every((point) => point.y === 242));
});

const aggregatePayloads = Object.fromEntries(
  ["tract", "neighborhood", "community_district", "borough"].map((scale) => [
    scale, JSON.parse(fs.readFileSync(path.join(__dirname, `../assets/income/geographies/${scale}.json`), "utf8")),
  ]),
);

test("all five scale options are available and aggregate snapshots retain every source household", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const select = html.match(/<select id="income-scale">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map((match) => match[1]), Object.keys(model.scales));
  const original = new Map(payload.features.map((f) => [f.properties.geoid, f.properties]));
  const expectedCounts = { tract: 2327, neighborhood: 262, community_district: 71, borough: 5 };
  for (const [scale, data] of Object.entries(aggregatePayloads)) {
    assert.equal(model.normalizeAreas(data, scale), data);
    assert.equal(data.features.length, expectedCounts[scale]);
    assert.equal(data.metadata.member_count, 6807);
    assert.equal(data.features.reduce((sum, f) => sum + f.properties.total, 0), 3334088);
    for (const { properties: p } of data.features) {
      const members = p.members.map((id) => original.get(id));
      assert.equal(p.total, members.reduce((sum, member) => sum + member.total, 0));
      assert.equal(p.total_moe, Math.ceil(Math.sqrt(members.reduce((sum, member) => sum + member.total_moe ** 2, 0))));
      p.bins.forEach((bin, i) => {
        assert.equal(bin.estimate, members.reduce((sum, member) => sum + member.bins[i].estimate, 0));
        assert.equal(bin.moe, Math.ceil(Math.sqrt(members.reduce((sum, member) => sum + member.bins[i].moe ** 2, 0))));
      });
    }
  }
});

test("invalid aggregate membership, scale, counts, MOE method and geometry fail explicitly", () => {
  const original = aggregatePayloads.borough;
  for (const edit of [
    (d) => { d.metadata.scale = "tract"; },
    (d) => { d.metadata.moe_method = "sum"; },
    (d) => { d.metadata.member_count++; },
    (d) => { d.features[0].properties.total++; },
    (d) => { d.features[0].properties.total_moe = -1; },
    (d) => { d.features[0].properties.geoid = 5; },
    (d) => { d.features[0].properties.bins[0].moe = null; },
    (d) => { d.features[0].geometry = null; },
    (d) => { d.features[0].properties.members.push(d.features[0].properties.members[0]); d.features[0].properties.member_count++; },
    (d) => { d.features[0].properties.members[0] = d.features[1].properties.members[0]; },
  ]) {
    const copy = structuredClone(original);
    edit(copy);
    assert.throws(() => model.normalizeAreas(copy, "borough"));
  }
  assert.throws(() => model.normalizeAreas(original, "unknown"));
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
test("popup renders a filled line, dollar ticks and source-range details with exact MOEs", () => {
  const context = {
    IncomeModel: model, L: { featureGroup: () => ({}) },
    document: { createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag, ns),
      getElementById: () => new Node("select") },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../income.js"), "utf8"), context);
  let greyCount = 0;
  for (const feature of payload.features) {
    const style = context.incomeMapStyle(feature);
    if (feature.properties.total === 0) {
      greyCount++;
      assert.equal(style.fillColor, "#bdbdbd");
      assert.equal(style.color, "#777");
    } else {
      assert.equal(style.fillColor, "#dfe8ff");
      assert.equal(style.color, "#0035ff");
    }
  }
  assert.equal(greyCount, 442);
  for (const feature of [payload.features.find((f) => f.properties.total > 0), payload.features.find((f) => f.properties.total === 0)]) {
    const popup = context.incomePopup(feature);
    if (feature.properties.total === 0) {
      assert.ok(descendants(popup, "p").some((node) => node.textContent.includes("No estimated households")));
    }
    const points = descendants(popup, "circle");
    assert.equal(points.length, 16);
    assert.equal(descendants(popup, "rect").length, 0);
    assert.equal(descendants(popup, "path").length, 2);
    feature.properties.bins.forEach((bin, i) => {
      if (bin.estimate === 0) assert.equal(points[i].attributes.cy, "242");
      assert.ok(points[i].attributes["aria-label"].includes(bin.moe.toLocaleString("en-US")));
      assert.ok(points[i].attributes["aria-label"].endsWith("households"));
      assert.ok(points[i].attributes["aria-label"].includes(bin.label));
    });
    assert.equal(descendants(popup, "tbody")[0].children.length, 16);
    assert.ok(descendants(popup, "text").some((node) => node.textContent === "0"));
    assert.ok(descendants(popup, "text").some((node) => node.textContent === "$0"));
    assert.ok(descendants(popup, "text").some((node) => node.textContent === "$200k+"));
    assert.ok(descendants(popup, "text").some((node) => node.textContent === "Number of households"));
    assert.ok(descendants(popup, "text").every((node) => !node.textContent?.includes(" to ")));
    assert.equal(descendants(popup, "details").length, 1);
    assert.equal(descendants(popup, "details")[0].attributes.open, undefined);
    assert.ok(descendants(popup, "p").some((node) => node.textContent.includes("not exact-dollar measurements")));
  }
  for (const scale of Object.keys(aggregatePayloads)) {
    const popup = context.incomePopup(aggregatePayloads[scale].features[0]);
    assert.equal(descendants(popup, "circle").length, 16);
    assert.ok(descendants(popup, "p").some((node) => node.textContent.includes("Approximate margins of error")));
    assert.ok(descendants(popup, "caption")[0].textContent.includes("approximate"));
    if (scale === "community_district") {
      assert.ok(descendants(popup, "p").some((node) => node.textContent.includes("not its exact legal boundary")));
    }
  }
});
