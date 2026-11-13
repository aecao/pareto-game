const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../transit2-model.js");
const config = require("../assets/transit/transit2-config.json");

test("Transit 2 reproduces the three subway arrival-load scenarios", () => {
  const results = [0.5, 0.7, 0.85].map((load) => model.run(config, load));
  assert.deepEqual(results.map((result) => Math.round(result.headroom.subway)), [3482, 1722, 402]);
  assert.deepEqual(results.map((result) => Math.round(result.fixed.subway)), [19629, 9707, 2266]);
  assert.deepEqual(results.map((result) => result.bindingMode), ["bus", "subway", "subway"]);
  assert.deepEqual(results.map((result) => Math.round(result.fixedBindingHouseholds)), [16152, 9707, 2266]);
  assert.deepEqual(results.map((result) => Math.round(result.fullReallocationHouseholds)), [18712, 9633, 2824]);
  assert.deepEqual(config.subway_arrival_load_scenarios, [0.5, 0.7, 0.85]);
  assert.equal(config.selected_peak_hour, "07:00-08:00");
  assert.equal(config.parameters.subway.tph, 8);
  assert.equal(config.parameters.ferry.headway_min, 20);
});

test("Transit 2 sums peak-hour and full-weekday capacity with existing households included", () => {
  const results = [0.5, 0.7, 0.85].map((load) => model.run(config, load));
  assert.deepEqual(results.map((result) => Math.round(result.totalCapacity)), [5503, 3743, 2423]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.totalCapacity)), [116643, 75803, 45173]);
  assert.deepEqual(results.map((result) => Math.round(result.residentialCapacity.fixed.totalHouseholds)), [21327, 14882, 7441]);
  assert.deepEqual(results.map((result) => Math.round(result.residentialCapacity.reallocated.totalHouseholds)), [23887, 14808, 7999]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.residentialCapacity.fixed.totalHouseholds)), [75179, 75179, 51801]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.residentialCapacity.reallocated.totalHouseholds)), [180511, 117309, 69908]);
  assert.deepEqual(results.map((result) => Math.round(result.residentialCapacity.fixed.totalResidents)), [45226, 31777, 16249]);
  assert.deepEqual(results.map((result) => Math.round(result.residentialCapacity.reallocated.totalResidents)), [50569, 31623, 17414]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.residentialCapacity.fixed.totalResidents)), [157603, 157603, 108818]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.residentialCapacity.reallocated.totalResidents)), [377409, 245520, 146604]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.existing.subway)), [3060, 3060, 3060]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.existing.bus)), [165, 165, 165]);
  assert.deepEqual(results.map((result) => Math.round(result.daily.existing.ferry)), [119, 119, 119]);
});

test("Transit 2 uses collected ACS household and work-pattern estimates", () => {
  assert.equal(config.schema_version, 3);
  assert.equal(config.parameters.hh_existing, 5175);
  assert.equal(config.parameters.workers_per_hh, 5696 / 5175);
  assert.equal(config.parameters.in_person, 4431 / 5696);
  assert.match(config.provenance_note, /B08301/);
  assert.match(config.provenance_note, /238\.04/);
  assert.match(config.provenance_note, /ACS does not identify Tram riders/);
  assert.equal(config.parameters.transit_share, 3344 / 4431);
  assert.equal(config.parameters.split.subway, 3060 / 3344);
  assert.equal(config.parameters.split.bus, 165 / 3344);
  assert.equal(config.parameters.split.ferry, 119 / 3344);
  assert.equal(config.parameters.split.tram, 0);
  assert.equal(config.parameters.current_population, 11520);
  assert.equal(config.parameters.average_household_size, 2.0867845410628014);
  assert.equal(config.tramway_ridership_estimate.monthly_riders, 137711);
  assert.equal(config.tramway_ridership_estimate.days_in_month, 31);
  assert.deepEqual(config.acs_demand_identified, ["subway", "bus", "ferry"]);
  assert.deepEqual(model.modes, ["subway", "bus", "tram", "ferry"]);
  const baseline = model.run(config, 0.7);
  assert.ok(Math.abs(baseline.existing.subway - 3060 * 0.3) < 1e-8);
  assert.ok(Math.abs(baseline.existing.bus - 165 * 0.3) < 1e-8);
  assert.ok(Math.abs(baseline.existing.ferry - 119 * 0.3) < 1e-8);
  assert.equal(baseline.existing.tram, 0);
  assert.equal(baseline.tramwayDemandEstimate.averageDailyRiders, 137711 / 31);
  assert.match(baseline.tramwayDemandEstimate.attributionStatus, /provisional/);
  assert.equal(baseline.tramwayCrowdingScenario.estimatedPeakDemand, 60 / 7.5 * 109);
  assert.equal(baseline.tramwayCrowdingScenario.planningCapacity, 60 / 7.5 * 109 * 0.85);
  assert.equal(baseline.tramwayCrowdingScenario.grossHeadroom, 0);
  assert.equal(baseline.estimatedDemand.tram, 872);
  assert.ok(Math.abs(baseline.headroom.tram + 130.8) < 1e-8);
  assert.equal(baseline.usable.bus, 4 * 51);
  assert.equal(baseline.fixed.tram, null);
  assert.equal(baseline.residentialCapacity.fixed.totalHouseholds, config.parameters.hh_existing + baseline.fixedBindingHouseholds);
  assert.equal(
    baseline.residentialCapacity.fixed.totalResidents,
    config.parameters.current_population + baseline.fixedBindingHouseholds * config.parameters.average_household_size,
  );
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
  assert.equal(result.daily.totalCapacity, baseline.daily.totalCapacity);
  assert.notEqual(result.daily.tripsPerHousehold, baseline.daily.tripsPerHousehold);
  const peakOnly = structuredClone(config);
  peakOnly.parameters.peak_hour_share = 0.6;
  const peakOnlyResult = model.run(peakOnly, 0.7);
  assert.notEqual(peakOnlyResult.fixedBindingHouseholds, baseline.fixedBindingHouseholds);
  assert.equal(peakOnlyResult.daily.fixedBindingHouseholds, baseline.daily.fixedBindingHouseholds);
  assert.ok(config.replace_with_real_data.length > 0);
  assert.equal(config.parameters.tram.capacity, 109);
  assert.equal(config.parameters.tram.headway_min, 7.5);
  assert.equal(config.parameters.ferry.capacity, 150);
  assert.equal(config.replaced_from_collected_data.length, 19);
});

test("subway and bus headways change AM-peak capacity but preserve weekday schedules", () => {
  const baseline = model.run(config, 0.7);
  const changed = structuredClone(config);
  changed.parameters.subway.tph = 60 / 10;
  changed.parameters.bus.trips_per_hour = 60 / 20;
  const result = model.run(changed, 0.7);
  assert.equal(config.parameters.subway.tph, 8);
  assert.equal(config.parameters.bus.trips_per_hour, 4);
  assert.notEqual(result.usable.subway, baseline.usable.subway);
  assert.notEqual(result.usable.bus, baseline.usable.bus);
  assert.equal(result.daily.totalCapacity, baseline.daily.totalCapacity);
  assert.equal(result.daily.existing.subway, baseline.daily.existing.subway);
  assert.equal(result.daily.existing.bus, baseline.daily.existing.bus);
  assert.deepEqual(config.slider_ranges.subway_headway_min, {
    min: 5,
    max: 15,
    step: 0.5,
    status: "ASSUMPTION: sensitivity range for AM-peak subway headway; scheduled 8 tph is the 7.5-minute baseline.",
  });
  assert.equal(60 / config.parameters.subway.tph, 7.5);
  assert.equal(60 / config.parameters.bus.trips_per_hour, 15);
});

test("invalid mode split and replacement flags fail explicitly", () => {
  const invalid = structuredClone(config);
  invalid.parameters.split.subway = 0.9;
  assert.throws(() => model.validate(invalid), /mode split/);
  const invalidDemandModes = structuredClone(config);
  invalidDemandModes.acs_demand_identified = ["tram", "tram"];
  assert.throws(() => model.validate(invalidDemandModes), /ACS demand modes/);
  const invalidHeadwayRange = structuredClone(config);
  invalidHeadwayRange.slider_ranges.bus_headway_min.max = 10;
  assert.throws(() => model.validate(invalidHeadwayRange), /headway slider ranges/);
  const invalidTramwayEstimate = structuredClone(config);
  invalidTramwayEstimate.tramway_ridership_estimate.monthly_riders = 0;
  assert.throws(() => model.validate(invalidTramwayEstimate), /Tramway ridership estimate/);
  const invalidTramwayCrowding = structuredClone(config);
  invalidTramwayCrowding.tramway_crowding_scenario.peak_load_factor = 1.2;
  assert.throws(() => model.validate(invalidTramwayCrowding), /Tramway crowding scenario/);
  const missingFlags = structuredClone(config);
  missingFlags.replace_with_real_data = [];
  assert.throws(() => model.validate(missingFlags), /replacement flags/);
});
