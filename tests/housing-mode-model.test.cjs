"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const model = require("../housing-mode-model.js");
const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets/housing_mode/lots.json"), "utf8"));

test("housing by mode decodes all 24,919 pilot residential lots and preserves 167,508 units", () => {
  const data = model.normalize(payload);
  assert.equal(data.features.length, 24919);
  assert.equal(data.features.reduce((n, f) => n + f.properties.units, 0), 167508);
  assert.equal(new Set(data.features.map(f => f.properties.bbl)).size, 24919);
  assert.ok(data.features.every(f => !f.properties.bbl.startsWith("101373")), "Roosevelt Island is excluded");
  const groups = { renter: 0, mixed: 0, owner: 0 };
  for (const f of data.features) {
    const p = f.properties;
    groups[p.tenure_group]++;
    assert.equal(p.dataset, "housing_mode");
    assert.ok(["01", "02", "03", "04"].includes(p.land_use));
    assert.ok(p.owner_share >= 0 && p.owner_share <= 1);
    assert.equal(p.owner_share, p.acs_owner / (p.acs_owner + p.acs_renter));
    for (const polygon of f.geometry.coordinates) {
      for (const ring of polygon) {
        assert.deepEqual(ring[0], ring.at(-1));
        for (const [x, y] of ring) assert.ok(x > -74 && x < -73.8 && y > 40.7 && y < 40.8);
      }
    }
  }
  assert.deepEqual(groups, { renter: 14985, mixed: 3087, owner: 6847 });
  assert.equal(data.features.filter(f => f.properties.condo).length, 385);
});

test("tenure and unit breaks are exact and colors darken with units", () => {
  const m = payload.metadata;
  assert.equal(model.tenureGroup(0.3999, m.owner_share_breaks), "renter");
  assert.equal(model.tenureGroup(0.4, m.owner_share_breaks), "mixed");
  assert.equal(model.tenureGroup(0.6, m.owner_share_breaks), "mixed");
  assert.equal(model.tenureGroup(0.6001, m.owner_share_breaks), "owner");
  assert.deepEqual([1, 2, 3, 9, 10, 49, 50, 3000].map(u => model.unitClass(u, m.unit_breaks)), [0, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(model.color({ tenure_group: "owner", unit_class: 4 }, m), m.colors.owner[4]);
  for (const bad of [0, 1.5, -1, NaN]) assert.throws(() => model.unitClass(bad, m.unit_breaks));
  for (const bad of [-0.1, 1.1, NaN]) assert.throws(() => model.tenureGroup(bad, m.owner_share_breaks));
  assert.throws(() => model.color({ tenure_group: "public", unit_class: 0 }, m));
});

test("ring decoding round-trips deltas and rejects open or malformed rings", () => {
  assert.deepEqual(model.decodeRing([10, 20, 5, 0, 0, 5, -5, -5], 10), [[1, 2], [1.5, 2], [1.5, 2.5], [1, 2]]);
  assert.throws(() => model.decodeRing([10, 20, 5, 0, 0, 5, -5, -4], 10));
  assert.throws(() => model.decodeRing([10, 20, 5, 0], 10));
  assert.throws(() => model.decodeRing([10, 20, 5.5, 0, 0, 5, -5.5, -5], 10));
});

test("invalid housing payloads fail explicitly", () => {
  for (const edit of [
    d => { d.metadata.table = "B25003"; },
    d => { d.metadata.pluto_version = "25v1"; },
    d => { d.metadata.total_units++; },
    d => { d.metadata.colors.owner.pop(); },
    d => { d.metadata.owner_share_breaks.reverse(); },
    d => { d.lots[0][0] = 4000010001; },
    d => { d.lots[1][0] = d.lots[0][0]; },
    d => { d.lots[0][3] = "05"; },
    d => { d.lots[0][4] = 0; },
    d => { d.lots[0][8] = d.cells.length; },
    d => { d.cells[0][3] = 0; d.cells[0][4] = 0; },
    d => { d.cells[0][2] = "borough"; },
    d => { d.lots.pop(); },
  ]) {
    const copy = structuredClone(payload);
    edit(copy);
    assert.throws(() => model.normalize(copy));
  }
});
