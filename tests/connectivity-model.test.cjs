const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../connectivity-model.js");
const data = require("../assets/connectivity/walking.json");

test("verified walking snapshot validates without mutation", () => {
  const original = JSON.stringify(data);
  assert.equal(model.validate(data), data);
  assert.equal(JSON.stringify(data), original);
  assert.equal(data.summary.length, 6);
  assert.equal(data.destination_times.length, 5);
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

test("Queens counts and island baseline/scenario times preserve source findings", () => {
  for (const budget of [15, 30, 45]) {
    const rows = data.summary.filter((r) => r.budget_minutes === budget);
    assert.equal(rows[0].queens_source_nodes, rows[1].queens_source_nodes);
    assert.ok(rows[1].island_source_nodes > rows[0].island_source_nodes);
  }
  const island = data.destination_times.find((r) => r.destination === "Roosevelt Island landing street");
  assert.ok(Math.abs(island.baseline_minutes - 29.797635235154) < 0.00001);
  assert.ok(Math.abs(island.bridge_minutes - 5.377442802396105) < 1e-10);
  assert.equal(data.validation.queens_nodes_improved, 0);
});

for (const [name, corrupt] of [
  ["schema", (d) => { d.schema_version = 99; }],
  ["duplicate summary", (d) => { d.summary[0] = d.summary[1]; }],
  ["coordinate", (d) => { d.markers.features[0].geometry.coordinates = [0, 0]; }],
  ["route disagreement", (d) => { d.example_routes.features[0].properties.minutes += 1; }],
  ["missing routes", (d) => { d.example_routes.features.pop(); }],
  ["invalid time", (d) => { d.destination_times[0].baseline_minutes = -1; }],
  ["missing budget", (d) => { d.reachable_streets.features = d.reachable_streets.features.filter((f) => f.properties.budget_minutes !== 15); }],
  ["link cost", (d) => { d.scenario_links.features[0].properties.minutes = null; }],
  ["unsupported Queens change", (d) => { d.validation.queens_nodes_improved = 5; }],
]) {
  test(`reject corrupt payload: ${name}`, () => {
    const copy = structuredClone(data);
    corrupt(copy);
    assert.throws(() => model.validate(copy), /Invalid walking snapshot/);
  });
}
