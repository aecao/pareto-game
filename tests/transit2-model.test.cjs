const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../transit2-model.js");
const config = require("../assets/transit/transit2-config.json");

test("Transit 2 reproduces the three subway arrival-load scenarios", () => {
  const results = [0.5, 0.7, 0.85].map((load) => model.run(config, load));
  assert.deepEqual(results.map((result) => Math.round(result.headroom.subway)), [3836, 2076, 756]);
  assert.deepEqual(results.map((result) => Math.round(result.fixed.subway)), [24620, 13323, 4851]);
  assert.deepEqual(results.map((result) => result.bindingMode), ["bus", "subway", "subway"]);
  assert.deepEqual(results.map((result) => Math.round(result.fixedBindingHouseholds)), [14356, 13323, 4851]);
  assert.deepEqual(results.map((result) => Math.round(result.fullReallocationHouseholds)), [28135, 17978, 10360]);
  assert.deepEqual(config.subway_arrival_load_scenarios, [0.5, 0.7, 0.85]);
  assert.equal(config.selected_peak_hour, "07:00-08:00");
  assert.equal(config.parameters.subway.tph, 8);
  assert.equal(config.parameters.ferry.headway_min, 20);
});

test("Transit 2 uses collected ACS household and work-pattern estimates", () => {
  assert.equal(config.parameters.hh_existing, 3622);
  assert.equal(config.parameters.workers_per_hh, 3707 / 3622);
  assert.equal(config.parameters.in_person, 2879 / 3707);
  assert.match(config.provenance_note, /B08301/);
  assert.match(config.provenance_note, /ACS has no Tram category/);
  assert.equal(config.parameters.transit_share, 2092 / 2879);
  assert.equal(config.parameters.split.subway, 1881 / 2092);
  assert.equal(config.parameters.split.bus, 137 / 2092);
  assert.equal(config.parameters.split.ferry, 74 / 2092);
  assert.equal(config.parameters.split.tram, 0);
  assert.deepEqual(model.modes, ["subway", "bus", "tram", "ferry"]);
  const baseline = model.run(config, 0.7);
  assert.ok(Math.abs(baseline.existing.subway - 1881 * 0.3) < 1e-8);
  assert.ok(Math.abs(baseline.existing.bus - 137 * 0.3) < 1e-8);
  assert.ok(Math.abs(baseline.existing.ferry - 74 * 0.3) < 1e-8);
  assert.equal(baseline.existing.tram, 0);
  assert.equal(baseline.usable.bus, 4 * 51);
  assert.equal(baseline.fixed.tram, null);
});

test("Transit 2 responds to key sliders and keeps all parameters in config", () => {
  const changed = structuredClone(config);
  changed.parameters.in_person = 0.5;
  changed.parameters.peak_hour_share = 0.6;
  changed.parameters.tram.headway_min = 15;
  changed.parameters.ferry.headway_min = 40;
  const baseline = model.run(config, 0.7);
  const result = model.run(changed, 0.7);
  assert.notEqual(result.r, baseline.r);
  assert.notEqual(result.headroom.tram, baseline.headroom.tram);
  assert.notEqual(result.headroom.ferry, baseline.headroom.ferry);
  assert.ok(config.replace_with_real_data.length > 0);
  assert.equal(config.parameters.tram.capacity, 109);
  assert.equal(config.parameters.tram.headway_min, 7.5);
  assert.equal(config.parameters.ferry.capacity, 150);
  assert.equal(config.replaced_from_collected_data.length, 10);
});

test("invalid mode split and replacement flags fail explicitly", () => {
  const invalid = structuredClone(config);
  invalid.parameters.split.subway = 0.9;
  assert.throws(() => model.validate(invalid), /mode split/);
  const missingFlags = structuredClone(config);
  missingFlags.replace_with_real_data = [];
  assert.throws(() => model.validate(missingFlags), /replacement flags/);
});
