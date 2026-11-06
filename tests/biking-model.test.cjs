const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const model = require("../connectivity-model.js");
const catalog = require("../assets/connectivity/origins.json");

for (const origin of catalog.origins) {
  test(`${origin.name}: directed biking snapshot reconciles all 32 reference summaries`, () => {
    const file = path.join(__dirname, "..", "assets", "connectivity", `biking_${origin.id}.json.gz`);
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
    assert.equal(model.validate(data, origin, "biking"), data);
    assert.equal(data.settings.biking.speed_mph, 13);
    assert.equal(data.settings.walking_speed_mph, 3);
    assert.equal(data.summary.length, 32);
    assert.ok(data.edges.features.some((feature) => feature.properties.d !== "TW"));
    assert.ok(data.edges.features.some((feature) => feature.properties.travel_mode === "dismount"));
    for (const row of data.summary) {
      const metrics = model.metrics(data, row.scenario, row.budget_minutes);
      assert.equal(metrics.queens, row.queens_source_nodes);
      assert.equal(metrics.island, row.island_source_nodes);
      assert.equal(metrics.other, row.other_source_nodes);
      assert.ok(Math.abs(metrics.existingMiles - row.existing_source_edge_miles) < 1e-7);
      assert.ok(Math.abs(metrics.queensMiles - row.queens_source_edge_miles) < 1e-7);
    }
    const scenario = Object.keys(data.scenarios).at(-1);
    for (const budget of [0, 17, 60]) {
      const times = data.node_times[scenario];
      for (const feature of data.edges.features) {
        const bandFeet = model.bands(feature, times, budget, 5)
          .reduce((sum, piece) => sum + (piece.to - piece.from) * feature.properties.l, 0);
        const trimmedFeet = model.trim(feature, times, budget).fraction * feature.properties.l;
        assert.ok(Math.abs(bandFeet - trimmedFeet) < 1e-6);
      }
    }
    assert.throws(() => model.validate(data, origin, "walking"), /schema/);
    const selected = data.settings.selected_origin;
    data.settings.selected_origin = { ...selected, coordinates: [0, 0] };
    assert.throws(() => model.validate(data, origin, "biking"), /origin identity/);
    data.settings.selected_origin = selected;
    const edge = data.edges.features[0].properties;
    const direction = edge.d;
    edge.d = "NV";
    assert.throws(() => model.validate(data, origin, "biking"), /bicycle edge direction/);
    edge.d = direction;
    const penalty = data.links.features.filter((feature) => feature.properties.name === "lic_midtown:v1:access");
    assert.equal(penalty.length, 1);
    assert.ok(Math.abs(penalty[0].properties.minutes - penalty[0].properties.length_ft / 264 - 3) < 1e-9);
    assert.equal(penalty[0].properties.travel_mode, "dismount");
    for (const feature of data.links.features.filter((feature) => feature.properties.kind === "proposed_bridge")) {
      assert.ok(Math.abs(feature.properties.minutes - feature.properties.length_ft / 1144) < 1e-9);
      assert.equal(feature.properties.travel_mode, "biking");
    }
  });
}
