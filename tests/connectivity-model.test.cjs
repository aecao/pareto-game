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
  assert.equal(data.summary.length, 6);
  assert.equal("example_routes" in data, false);
  assert.equal("destination_times" in data, false);
});

test("every budget/scenario selector returns exact source feature membership", () => {
  for (const budget of [15, 30, 45]) {
    for (const scenario of ["baseline", "bridge", "both"]) {
      const selected = model.selection(data, budget, scenario);
      assert.ok(selected.length > 0);
      assert.deepEqual(selected, data.reachable_streets.features.filter((f) =>
        f.properties.budget_minutes === budget
        && (scenario === "both" || f.properties.scenario === scenario)));
    }
  }
  assert.throws(() => model.selection(data, 20, "both"), /selection/);
  assert.throws(() => model.selection(data, 15, "transit"), /selection/);
});

test("Roosevelt Island origin yields distinct baseline and bridge reachability", () => {
  assert.equal(data.validation.origin_is_roosevelt_island, true);
  assert.equal(data.validation.origin_is_island_bridge_landing, true);
  assert.equal(data.validation.existing_island_bridge_in_baseline, true);
  assert.equal(data.validation.hypothetical_bridge_in_scenario, true);
  assert.ok(data.markers.features.some((feature) =>
    feature.properties.name === "Roosevelt Island bridge landing (origin)"));
  assert.ok([15, 30, 45].some((budget) => {
    const rows = data.summary.filter((row) => row.budget_minutes === budget);
    return rows[0].queens_source_nodes !== rows[1].queens_source_nodes
      || rows[0].island_source_nodes !== rows[1].island_source_nodes;
  }));
});

test("isochrones start at the island bridge endpoint with no interior-origin detour", () => {
  const origin = data.markers.features.find((f) =>
    f.properties.name === "Roosevelt Island bridge landing (origin)");
  const landing = data.markers.features.find((f) =>
    f.properties.name === "Provisional Roosevelt Island landing");
  const bridge = data.scenario_links.features.find((f) => f.properties.kind === "hypothetical_bridge");
  assert.deepEqual(origin.geometry.coordinates, landing.geometry.coordinates);
  assert.ok(bridge.geometry.coordinates.some((point) =>
    JSON.stringify(point) === JSON.stringify(origin.geometry.coordinates)));
  assert.equal(data.scenario_links.features.some((f) => f.properties.name === "roosevelt_origin:access"), false);
  const baseline = data.summary.find((row) => row.scenario === "baseline" && row.budget_minutes === 15);
  const scenario = data.summary.find((row) => row.scenario === "bridge" && row.budget_minutes === 15);
  assert.ok(scenario.queens_source_nodes > baseline.queens_source_nodes);
});

for (const [name, corrupt] of [
  ["schema", (d) => { d.schema_version = 99; }],
  ["duplicate summary", (d) => { d.summary[0] = d.summary[1]; }],
  ["coordinate", (d) => { d.markers.features[0].geometry.coordinates = [0, 0]; }],
  ["Queens origin", (d) => { d.settings.origin_method = "site_representative_point_with_explicit_access_connector"; }],
  ["interior island origin", (d) => {
    d.markers.features.find((f) => f.properties.name === "Roosevelt Island bridge landing (origin)")
      .geometry.coordinates[0] -= 0.001;
  }],
  ["example route payload", (d) => { d.example_routes = { type: "FeatureCollection", features: [] }; }],
  ["identical scenarios", (d) => {
    for (const bridge of d.summary.filter((row) => row.scenario === "bridge")) {
      const baseline = d.summary.find((row) =>
        row.scenario === "baseline" && row.budget_minutes === bridge.budget_minutes);
      bridge.queens_source_nodes = baseline.queens_source_nodes;
      bridge.island_source_nodes = baseline.island_source_nodes;
    }
  }],
  ["missing budget", (d) => { d.reachable_streets.features = d.reachable_streets.features.filter((f) => f.properties.budget_minutes !== 15); }],
  ["link cost", (d) => { d.scenario_links.features[0].properties.minutes = null; }],
]) {
  test(`reject corrupt payload: ${name}`, () => {
    const copy = structuredClone(data);
    corrupt(copy);
    assert.throws(() => model.validate(copy), /Invalid walking snapshot/);
  });
}
