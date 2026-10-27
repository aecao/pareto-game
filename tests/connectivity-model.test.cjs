const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../connectivity-model.js");
const data = require("../assets/connectivity/walking.json");
const fs = require("node:fs");
const path = require("node:path");

test("Connectivity scripts, fetch and download share a cache-busting release", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const loader = fs.readFileSync(path.join(__dirname, "../connectivity.js"), "utf8");
  const modelVersion = html.match(/src="connectivity-model\.js\?v=([^"]+)"/);
  assert.ok(modelVersion, "validator must have a release version");
  const version = modelVersion[1];
  assert.ok(html.includes(`src="connectivity.js?v=${version}"`));
  assert.ok(html.includes(`href="assets/connectivity/walking.json?v=${version}"`));
  assert.ok(loader.includes(`fetch("assets/connectivity/walking.json?v=${version}", { cache: "no-cache" })`));
});

test("verified walking snapshot validates without mutation", () => {
  const original = JSON.stringify(data);
  assert.equal(model.validate(data), data);
  assert.equal(JSON.stringify(data), original);
  assert.equal(Object.keys(data.scenarios).length, 8);
  assert.equal(data.summary.length, 32);
});

test("5-minute bands cover exactly the trimmed length and stay within their band", () => {
  for (const scenario of ["baseline", "lic_midtown", Object.keys(data.scenarios).at(-1)]) {
    for (const budget of [7, 33, 60]) {
      const times = data.node_times[scenario];
      let bandFeet = 0;
      let trimFeet = 0;
      for (const feature of data.edges.features) {
        const p = feature.properties;
        if (p.bridge !== null && !data.scenarios[scenario].includes(p.bridge)) continue;
        trimFeet += model.trim(feature, times, budget).fraction * p.l;
        for (const piece of model.bands(feature, times, budget, 5)) {
          assert.ok(piece.band >= 0 && piece.band < Math.ceil(budget / 5), `${scenario}/${budget} band`);
          assert.ok(piece.coordinates.length >= 2 && piece.coordinates.flat().every(Number.isFinite));
          bandFeet += (piece.to - piece.from) * p.l;
        }
      }
      assert.ok(Math.abs(bandFeet - trimFeet) < 0.01, `${scenario}/${budget}`);
    }
  }
});

test("band boundaries fall on 5-minute isochrones of a synthetic edge", () => {
  const feature = { geometry: { coordinates: [[-73.95, 40.76], [-73.94, 40.76]] },
    properties: { u: 0, v: 1, m: 20, l: 5280, f: [0, 1] } };
  const pieces = model.bands(feature, [2, 10], 60, 5);
  // Meet point at (10 - 2 + 20) / 40 = 0.7 → u side 2→16 min, v side 10→16 min.
  assert.deepEqual(pieces.map((p) => p.band), [0, 1, 2, 3, 2, 3]);
  const lon = (x) => -73.95 + 0.01 * x;
  assert.ok(Math.abs(pieces[0].coordinates[1][0] - lon(3 / 20)) < 1e-12);
  assert.ok(Math.abs(pieces[3].coordinates[1][0] - lon(0.7)) < 1e-12);
  assert.deepEqual(model.bands(feature, [null, null], 60, 5), []);
  assert.deepEqual(model.bands(feature, [2, 10], 7, 5).map((p) => p.band), [0, 1]);
});

test("metrics work for any whole-minute slider budget up to 60", () => {
  let previous = -1;
  for (let budget = 0; budget <= model.MAX_BUDGET; budget += 1) {
    const m = model.metrics(data, "baseline", budget);
    assert.ok(m.existingMiles >= previous);
    previous = m.existingMiles;
  }
  assert.throws(() => model.metrics(data, "baseline", 61), /selection/);
});

test("bridge selections map to configured-order scenario names", () => {
  const [a, b, c] = data.bridges.map((bridge) => bridge.id);
  assert.equal(model.scenarioName(data, []), "baseline");
  assert.equal(model.scenarioName(data, [c, a]), `${a}+${c}`);
  assert.equal(model.scenarioName(data, [a, b, c]), `${a}+${b}+${c}`);
  assert.throws(() => model.scenarioName(data, ["tunnel"]), /unknown bridge/);
});

test("browser trimming reproduces every saved node count and street length", () => {
  for (const scenario of Object.keys(data.scenarios)) {
    for (const budget of model.BUDGETS) {
      const result = model.metrics(data, scenario, budget);
      assert.equal(result.queens, result.row.queens_source_nodes, `${scenario}/${budget} queens`);
      assert.equal(result.island, result.row.island_source_nodes, `${scenario}/${budget} island`);
      assert.equal(result.other, result.row.other_source_nodes, `${scenario}/${budget} other`);
      assert.ok(Math.abs(result.existingMiles - result.row.existing_source_edge_miles) * 5280 < 0.01,
        `${scenario}/${budget} length`);
      assert.ok(Math.abs(result.queensMiles - result.row.queens_source_edge_miles) * 5280 < 0.01,
        `${scenario}/${budget} Queens length`);
    }
  }
});

test("trimmed lines stay on their source edge and inactive bridges are hidden", () => {
  const items = model.reachable(data, "baseline", 45);
  assert.ok(items.length > 0);
  assert.equal(items.some((item) => item.feature.properties.bridge !== null), false);
  const lic = model.reachable(data, "lic_midtown", 45);
  assert.ok(lic.some((item) => item.feature.properties.kind === "proposed_bridge"));
  for (const item of lic) {
    for (const part of item.parts) assert.ok(part.length >= 2 && part.flat().every(Number.isFinite));
  }
});

test("LIC–Midtown charges its 3-minute penalty only at the island exit", () => {
  const lic = data.bridges.find((bridge) => bridge.id === "lic_midtown");
  assert.deepEqual(lic.stops.map((stop) => stop.exit_penalty_minutes), [0, 3, 0]);
  const exit = data.edges.features.find((f) => f.properties.k === "lic_midtown:v1:access");
  assert.ok(Math.abs(exit.properties.m - (3 + exit.properties.l / 264)) < 1e-9);
  const through = data.edges.features.filter((f) => f.properties.k.startsWith("lic_midtown:deck"));
  assert.ok(through.every((f) => Math.abs(f.properties.m - f.properties.l / 264) < 1e-9));
});

test("every bridge alone improves on the baseline", () => {
  for (const bridge of data.bridges) {
    const better = model.BUDGETS.some((budget) => model.summaryRow(data, bridge.id, budget).existing_source_edge_miles
      > model.summaryRow(data, "baseline", budget).existing_source_edge_miles);
    assert.ok(better, bridge.id);
  }
});

for (const [name, corrupt] of [
  ["schema", (d) => { d.schema_version = 99; }],
  ["duplicate summary", (d) => { d.summary[0] = d.summary[1]; }],
  ["coordinate", (d) => { d.markers.features[0].geometry.coordinates = [0, 0]; }],
  ["origin method", (d) => { d.settings.origin_method = "roosevelt_island_bridge_landing_with_explicit_access_connector"; }],
  ["missing scenario", (d) => { delete d.node_times.baseline; }],
  ["node time range", (d) => { d.node_times.baseline[0] = 90; }],
  ["edge node index", (d) => { d.edges.features[0].properties.u = d.node_flags.length; }],
  ["edge fractions", (d) => { d.edges.features[0].properties.f = [0.5]; }],
  ["unknown bridge edge", (d) => { d.edges.features[0].properties.bridge = "tunnel"; }],
  ["obsolete payload", (d) => { d.reachable_streets = { type: "FeatureCollection", features: [] }; }],
  ["bridge with no effect", (d) => {
    for (const row of d.summary.filter((r) => r.scenario === d.bridges[0].id)) {
      const base = d.summary.find((r) => r.scenario === "baseline" && r.budget_minutes === row.budget_minutes);
      row.reachable_source_nodes = base.reachable_source_nodes;
      row.existing_source_edge_miles = base.existing_source_edge_miles;
    }
  }],
]) {
  test(`reject corrupt payload: ${name}`, () => {
    const copy = structuredClone(data);
    corrupt(copy);
    assert.throws(() => model.validate(copy), /Invalid walking snapshot/);
  });
}
