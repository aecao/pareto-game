"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const model = require("../public-housing-model.js");
const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets/public_housing/properties.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(payload));

test("public housing decodes 17,530 citywide properties and reconciles units", () => {
  const data = model.normalize(payload);
  assert.equal(data.features.length, 17530);
  assert.equal(new Set(data.features.map(f => f.properties.bbl)).size, 17530);
  assert.equal(data.features.reduce((n, f) => n + (f.properties.units ?? 0), 0), 1115579);
  assert.equal(data.features.filter(f => f.properties.units === null).length, 233);
  assert.ok(data.features.every(f => !f.properties.bbl.startsWith("101373")), "Roosevelt Island is excluded");
  const primary = Object.fromEntries(model.typeKeys.map(k => [k, 0]));
  for (const f of data.features) primary[f.properties.primary_type]++;
  assert.deepEqual(primary, { nycha: 697, hud: 1124, mitchell_lama: 213, lihtc: 2398, hpd: 4409, tax_only: 8689 });
});

test("type filter uses any-membership semantics", () => {
  const data = model.normalize(payload);
  const count = filter => data.features.filter(f => model.matches(f.properties, filter)).length;
  assert.equal(count("all"), 17530);
  assert.deepEqual(Object.fromEntries(model.typeKeys.map(k => [k, count(k)])),
    { nycha: 697, hud: 1140, mitchell_lama: 269, lihtc: 2864, hpd: 6868, tax_only: 8689 });
  assert.throws(() => model.matches(data.features[0].properties, "bogus"));
});

test("radius is square-root scaled and capped; dates format as ISO", () => {
  const m = payload.metadata;
  assert.equal(model.radius(null, m), m.radius.min_px);
  assert.equal(model.radius(0, m), m.radius.min_px);
  assert.equal(model.radius(m.radius.ref_units * 4, m), m.radius.max_px);
  assert.ok(model.radius(100, m) < model.radius(400, m));
  assert.equal(model.formatDate(20240131), "2024-01-31");
  assert.equal(model.formatDate(null), null);
});

test("invalid snapshots are rejected", () => {
  const numericBbl = clone();
  numericBbl.properties[0][0] = Number(numericBbl.properties[0][0]);
  assert.throws(() => model.normalize(numericBbl));
  const duplicate = clone();
  duplicate.properties[1][0] = duplicate.properties[0][0];
  assert.throws(() => model.normalize(duplicate));
  const precedence = clone();
  const row = precedence.properties.find(r => r[7] > 0);
  row[8] |= 1;
  assert.throws(() => model.normalize(precedence));
  const units = clone();
  units.metadata.total_units += 1;
  assert.throws(() => model.normalize(units));
  const outside = clone();
  outside.properties[0][9] = 0;
  assert.throws(() => model.normalize(outside));
});

const lotsPayload = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets/public_housing/lots.json"), "utf8"));
const cloneLots = () => JSON.parse(JSON.stringify(lotsPayload));

test("by-lot view maps every property to exactly one PLUTO lot and reconciles", () => {
  const properties = model.normalize(payload);
  const lots = model.normalizeLots(lotsPayload, properties);
  assert.equal(lots.features.length, 17514);
  const members = lots.features.flatMap(f => f.properties.members.map(p => p.bbl));
  assert.equal(members.length, 17530);
  assert.equal(new Set(members).size, 17530);
  assert.equal(lots.features.reduce((n, f) => n + (f.properties.units ?? 0), 0), 1115579);
  assert.equal(lots.features.reduce((n, f) => n + f.properties.spatial_matches, 0), 32);
  assert.equal(lots.features.filter(f => f.properties.members.length > 1).length, 5);
  assert.ok(lots.features.every(f => !f.properties.bbl.startsWith("101373")));
  const counts = Object.fromEntries(model.typeKeys.map(k => [k, 0]));
  for (const f of lots.features) {
    counts[f.properties.primary_type]++;
    assert.equal(f.geometry.type, "MultiPolygon");
    for (const polygon of f.geometry.coordinates) for (const ring of polygon) {
      assert.deepEqual(ring[0], ring.at(-1));
      for (const [x, y] of ring) assert.ok(x > -74.3 && x < -73.6 && y > 40.4 && y < 41);
    }
  }
  assert.deepEqual(counts, { nycha: 697, hud: 1124, mitchell_lama: 213, lihtc: 2394, hpd: 4409, tax_only: 8677 });
  assert.equal(lots.features.filter(f => model.matches(f.properties, "nycha")).length,
    new Set(properties.features.filter(f => f.properties.types.includes("nycha")).map(f => f.properties.bbl)).size);
});

test("lot shading classes and colors follow unit breaks; unknown units use the lightest shade", () => {
  const m = lotsPayload.metadata;
  assert.deepEqual(m.unit_breaks, [10, 25, 60, 150]);
  assert.deepEqual([null, 0, 9, 10, 24, 25, 59, 60, 149, 150, 5000].map(u => model.lotUnitClass(u, m.unit_breaks)),
    [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(model.lotColor({ primary_type: "nycha", unit_class: 4 }, m), m.colors.nycha[4]);
  assert.throws(() => model.lotColor({ primary_type: "nycha", unit_class: 5 }, m));
});

test("invalid lot snapshots are rejected", () => {
  const properties = model.normalize(payload);
  const missing = cloneLots();
  missing.lots[0][6] = missing.lots[0][6].slice(1).concat(missing.lots[0][6].length > 1 ? [] : ["1000000000"]);
  assert.throws(() => model.normalizeLots(missing, properties));
  const repeated = cloneLots();
  repeated.lots[1][6] = [...repeated.lots[1][6], repeated.lots[0][6][0]];
  assert.throws(() => model.normalizeLots(repeated, properties));
  const wrongType = cloneLots();
  const row = wrongType.lots.find(r => r[1] < 5);
  row[1] += 1;
  row[2] = 1 << row[1];
  assert.throws(() => model.normalizeLots(wrongType, properties));
  const units = cloneLots();
  units.lots.find(r => r[3] !== null)[3] += 1;
  assert.throws(() => model.normalizeLots(units, properties));
  const open = cloneLots();
  open.lots[0][7][0][0].push(1, 1);
  assert.throws(() => model.normalizeLots(open, properties));
});
