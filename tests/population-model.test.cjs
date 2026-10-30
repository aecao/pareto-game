"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const model = require("../population-model.js");
const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
const fixtures = Object.fromEntries(["block_group", "tract", "neighborhood"].map(scale => [scale, {
  counts: read(`assets/population/${scale}.json`),
  geometry: read(scale === "block_group" ? "assets/income/block-groups.json" : `assets/income/geographies/${scale}.json`),
}]));

test("population partitions preserve 8,483,844 residents, land area, water-only areas and RI split at all scales", () => {
  for (const [scale, { counts, geometry }] of Object.entries(fixtures)) {
    const data = model.normalize(counts, geometry, scale);
    assert.equal(data.features.length, { block_group: 6807, tract: 2327, neighborhood: 263 }[scale]);
    assert.equal(data.features.reduce((n, f) => n + f.properties.total, 0), 8483844);
    assert.equal(data.features.filter(f => f.properties.total === 0).length,
      { block_group: 411, tract: 84, neighborhood: 48 }[scale]);
    assert.equal(data.features.filter(f => f.properties.density === null).length,
      { block_group: 220, tract: 3, neighborhood: 1 }[scale]);
    for (const f of data.features) {
      const p = f.properties;
      assert.equal(p.dataset, "population");
      assert.equal(p.scale, scale);
      assert.ok(p.density === null || Math.abs(p.density * p.land_sq_miles - p.total) < 1e-8);
      assert.equal(f.geometry, geometry.features.find(g => g.properties.geoid === p.geoid).geometry);
    }
    if (scale === "neighborhood") {
      const ri = data.features.find(f => f.properties.geoid === "MN0801-RI");
      const tract = model.normalize(fixtures.tract.counts, fixtures.tract.geometry, "tract");
      const members = tract.features.filter(f => ["36061023802", "36061023803", "36061023804"].includes(f.properties.geoid));
      assert.equal(ri.properties.total, members.reduce((n, f) => n + f.properties.total, 0));
      assert.equal(ri.properties.custom_neighborhood, true);
    }
  }
});

test("fixed density colors grow darker at exact inclusive thresholds; no land is distinct from zero people", () => {
  const m = fixtures.tract.counts.metadata;
  assert.equal(model.color(null, m), "#bdbdbd");
  assert.equal(model.color(0, m), m.colors[0]);
  m.breaks.forEach((v, i) => {
    assert.equal(model.color(v - 0.001, m), m.colors[i]);
    assert.equal(model.color(v, m), m.colors[i + 1]);
  });
  assert.equal(model.color(1e9, m), m.colors.at(-1));
  for (const bad of [NaN, Infinity, -1, "10", undefined]) assert.throws(() => model.color(bad, m));
});

test("invalid population counts, geographic coverage, density denominator, MOEs and metadata fail explicitly", () => {
  const { counts, geometry } = fixtures.neighborhood;
  for (const edit of [
    d => { d.metadata.period = "2019-2023"; },
    d => { d.metadata.table = "B19001"; },
    d => { d.metadata.moe_method = "sum"; },
    d => { d.metadata.total_population++; },
    d => { d.metadata.colors.pop(); },
    d => { d.metadata.breaks.reverse(); },
    d => { delete d.areas[Object.keys(d.areas)[0]]; },
    d => { d.areas[Object.keys(d.areas)[0]].total = -1; },
    d => { d.areas[Object.keys(d.areas)[0]].total_moe = 0.5; },
    d => { d.areas[Object.keys(d.areas)[0]].density++; },
    d => { d.areas[Object.keys(d.areas)[0]].land_sqft = 0; },
    d => { d.areas[Object.keys(d.areas)[0]].land_sq_miles = -1; },
    d => { d.areas[Object.keys(d.areas)[0]].member_count = 0; },
  ]) {
    const copy = structuredClone(counts);
    edit(copy);
    assert.throws(() => model.normalize(copy, geometry, "neighborhood"));
  }
  const water = Object.values(counts.areas).find(v => v.density === null);
  assert.equal(water.total, 0);
  const badGeometry = structuredClone(geometry);
  badGeometry.features[0].geometry = null;
  assert.throws(() => model.normalize(counts, badGeometry, "neighborhood"));
  assert.throws(() => model.normalize(counts, fixtures.tract.geometry, "neighborhood"));
  assert.throws(() => model.normalize(counts, geometry, "borough"));
});
