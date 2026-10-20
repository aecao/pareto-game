const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculate } = require("../siting-model.js");

const payload = JSON.parse(fs.readFileSync(path.join(__dirname, "../assets/siting/pilot.json"), "utf8"));
const sites = payload.sites.features.map((feature) => feature.properties);
const defaults = payload.defaults;
const changed = (values) => ({ ...defaults, ...values });
const fixture = (id, extra = {}) => ({
  site_id: id, lot_count: 2, lot_area_sqft: 1000, rankable: true,
  base_far_proxy_gsf: 1000, existing_units_removed: 0, unranked_reason: "", ...extra,
});

test("all 72 corrected pilot groups reproduce all 61 pipeline ranks and exact-score precision", () => {
  const output = calculate(sites, defaults);
  assert.equal(output.sites.length, 72);
  assert.equal(output.ranked, 61);
  assert.equal(output.unranked, 11);
  assert.equal(output.targetMet, 0);
  assert.equal(output.requiredGsf, 5000 * 750 / 0.82);
  for (const site of output.sites) {
    assert.equal(site.rank, site.baseline_rank, site.site_id);
    if (site.rankable) assert.ok(Math.abs(site.score - site.baseline_score) < 1e-10, site.site_id);
    else assert.equal(site.score, null);
  }
  assert.equal(output.sites[0].site_id, "Q00488_4004880001");
  assert.equal(output.sites[1].parks_overlap_sqft > 600000, true);
});

test("target changes recompute accommodation, ranks, area, target-met counts and net units", () => {
  const base = calculate(sites, defaults);
  const reduced = calculate(sites, changed({ units: 1000 }));
  assert.ok(reduced.targetMet > 0);
  assert.ok(reduced.sites.some((site) => site.rank !== site.baseline_rank));
  const site = reduced.sites.find((row) => row.site_id === base.sites[0].site_id);
  assert.equal(site.components.accommodation, 1);
  assert.equal(site.netUnits, 1000);
  assert.equal(site.proxyUnits, base.sites[0].proxyUnits);
  assert.equal(site.shortfall, 0);
  assert.equal(reduced.requiredGsf, 1000 * 750 / 0.82);
});

test("unit size and efficiency change yield without mutating source or defaults", () => {
  const before = JSON.stringify({ sites, defaults });
  const base = calculate(sites, defaults);
  const smaller = calculate(sites, changed({ unitSize: 600 }));
  const efficient = calculate(sites, changed({ efficiency: 1 }));
  assert.ok(smaller.sites[0].proxyUnits > base.sites[0].proxyUnits);
  assert.ok(efficient.sites[0].proxyUnits > base.sites[0].proxyUnits);
  assert.equal(JSON.stringify({ sites, defaults }), before);
});

test("weights change scores and ordering; zero individual weights are supported", () => {
  const output = calculate(sites, changed({ weights: { accommodation: 0, removal: 0, assembly: 1 } }));
  assert.ok(output.sites.some((site) => site.rank !== site.baseline_rank));
  for (const site of output.sites.filter((row) => row.rankable)) {
    assert.equal(site.score, 100 * site.components.assembly);
  }
});

test("ties share minimum rank, constant inverse components equal one, IDs order ties", () => {
  const output = calculate([
    fixture("b"), fixture("a"), fixture("c", { base_far_proxy_gsf: 0 }),
  ], defaults);
  assert.deepEqual(output.sites.map((site) => [site.site_id, site.rank]), [["a", 1], ["b", 1], ["c", 3]]);
  for (const site of output.sites) {
    assert.equal(site.components.removal, 1);
    assert.equal(site.components.assembly, 1);
  }
});

test("incomplete and single-lot groups stay visible and unranked under all weights", () => {
  const output = calculate(sites, changed({ weights: { accommodation: 1, removal: 0, assembly: 0 } }));
  const incomplete = output.sites.find((site) => site.site_id === "Q00021_4000210001");
  assert.equal(incomplete.proxyUnits, null);
  assert.equal(incomplete.netUnits, null);
  assert.equal(incomplete.shortfall, null);
  assert.equal(incomplete.targetMet, null);
  assert.equal(incomplete.score, null);
  const singleton = output.sites.find((site) => site.site_id === "Q00470_4004700001");
  assert.equal(singleton.rank, null);
  assert.ok(singleton.proxyUnits > 0);
});

test("corrected waterfront excludes Dutch Kills and its former creek-only site groups", () => {
  assert.equal(payload.provenance.boundary_revision, "roosevelt_facing_v2");
  assert.equal(payload.provenance.constituent_lots, 984);
  assert.match(payload.provenance.shoreline_method, /exclusion BEFORE the 1000-ft buffer/);
  for (const id of ["Q00291_4002910001", "Q00083_4000830001", "Q00084_4000840001"]) {
    assert.ok(!sites.some((site) => site.site_id === id), id);
  }
  const shoreline = payload.reference.features.find((feature) => feature.properties.name === "facing_shoreline");
  const corridor = payload.reference.features.find((feature) => feature.properties.name === "candidate_corridor");
  // The excluded geographic mask surrounds the detached creek, not the East River shore.
  const inCreekMask = ([x, y]) => x > -73.9403 && x < -73.9383 && y > 40.7423 && y < 40.7434;
  const visit = (coordinates) => {
    if (typeof coordinates[0] === "number") {
      assert.ok(!inCreekMask(coordinates), JSON.stringify(coordinates));
    } else coordinates.forEach(visit);
  };
  visit(shoreline.geometry.coordinates);
  visit(corridor.geometry.coordinates);
});

test("net gains can be negative and are not floored at zero", () => {
  const site = calculate([fixture("occupied", { existing_units_removed: 6000 })], defaults).sites[0];
  assert.equal(site.netUnits, -1000);
});

test("target threshold uses gross floor area; scoring caps do not cap actual proxy yield", () => {
  const area = defaults.units * defaults.unitSize / defaults.efficiency;
  const output = calculate([
    fixture("exact", { base_far_proxy_gsf: area }),
    fixture("over", { base_far_proxy_gsf: area * 2 }),
    fixture("below", { base_far_proxy_gsf: area - 1 }),
  ], defaults);
  assert.equal(output.targetMet, 2);
  assert.equal(output.sites.find((site) => site.site_id === "exact").targetMet, true);
  const over = output.sites.find((site) => site.site_id === "over");
  assert.equal(over.components.accommodation, 1);
  assert.ok(over.proxyUnits > defaults.units);
});

test("invalid or missing assumptions are rejected explicitly", () => {
  for (const values of [
    { units: 0 }, { units: -1 }, { units: 1.5 }, { units: NaN }, { units: Infinity },
    { unitSize: 0 }, { unitSize: -1 }, { unitSize: NaN },
    { efficiency: 0 }, { efficiency: 1.01 }, { efficiency: -1 },
    { weights: { accommodation: 0.5, removal: 0.4, assembly: 0.2 } },
    { weights: { accommodation: -0.2, removal: 1, assembly: 0.2 } },
    { weights: { accommodation: 0, removal: 0, assembly: 0 } },
    { weights: {} }, { unitSize: Number.MAX_VALUE }, { unitSize: 1e-320 },
  ]) assert.throws(() => calculate(sites, changed(values)));
});

test("invalid or duplicate source records fail instead of becoming plausible ranks", () => {
  for (const records of [
    [], [fixture("a"), fixture("a")],
    [fixture("a", { base_far_proxy_gsf: null })],
    [fixture("a", { existing_units_removed: null })],
    [fixture("a", { existing_units_removed: -1 })],
    [fixture("a", { lot_count: 1 })],
    [fixture("a", { base_far_proxy_gsf: NaN })],
    [fixture("a", { rankable: false, unranked_reason: "" })],
  ]) assert.throws(() => calculate(records, defaults));
});
