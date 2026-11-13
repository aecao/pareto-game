(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Transit2Model = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const modes = ["subway", "bus", "tram", "ferry"];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  function check(condition, message) {
    if (!condition) throw new Error(`Invalid Transit 2 configuration: ${message}`);
  }
  function validate(config) {
    const p = config?.parameters;
    check(config?.schema_version === 1 && p, "schema");
    ["hh_existing", "workers_per_hh", "in_person", "transit_share", "peak_hour_share"].forEach((key) => check(finite(p[key]) && p[key] >= 0, key));
    check(p.hh_existing > 0 && p.workers_per_hh > 0 && p.transit_share <= 1 && p.in_person <= 1 && p.peak_hour_share <= 1, "household parameters");
    check(p.split && modes.every((mode) => finite(p.split[mode]) && p.split[mode] >= 0 && p.split[mode] <= 1)
      && modes.some((mode) => p.split[mode] > 0)
      && Math.abs(modes.reduce((sum, mode) => sum + p.split[mode], 0) - 1) < 1e-9, "mode split");
    check(p.tram && finite(p.tram.headway_min) && p.tram.headway_min > 0 && finite(p.tram.capacity) && p.tram.capacity > 0
      && finite(p.tram.planning_load) && p.tram.planning_load > 0 && p.tram.planning_load <= 1, "tram");
    check(p.subway && finite(p.subway.tph) && p.subway.tph > 0 && finite(p.subway.train_capacity) && p.subway.train_capacity > 0, "subway");
    check(p.bus && finite(p.bus.trips_per_hour) && p.bus.trips_per_hour > 0
      && finite(p.bus.passengers_per_bus) && p.bus.passengers_per_bus > 0, "bus");
    check(p.ferry && finite(p.ferry.headway_min) && p.ferry.headway_min > 0 && finite(p.ferry.capacity) && p.ferry.capacity > 0
      && finite(p.ferry.planning_load) && p.ferry.planning_load > 0 && p.ferry.planning_load <= 1
      && finite(p.ferry.onboard_load) && p.ferry.onboard_load >= 0 && p.ferry.onboard_load <= p.ferry.planning_load, "ferry");
    check(Array.isArray(config.replace_with_real_data) && config.replace_with_real_data.length > 0, "replacement flags");
    check(Array.isArray(config.subway_arrival_load_scenarios)
      && config.subway_arrival_load_scenarios.length === 3
      && config.subway_arrival_load_scenarios.every((value) => finite(value) && value >= 0 && value < 1)
      && finite(config.default_subway_arrival_load)
      && config.subway_arrival_load_scenarios.includes(config.default_subway_arrival_load), "arrival-load scenarios");
    return config;
  }
  function run(config, subwayArrivalLoad) {
    validate(config);
    const p = config.parameters;
    check(finite(subwayArrivalLoad) && subwayArrivalLoad >= 0 && subwayArrivalLoad < 1, "subway arrival load");
    const r = p.workers_per_hh * p.in_person * p.transit_share * p.peak_hour_share;
    const existing = Object.fromEntries(modes.map((mode) => [mode, p.hh_existing * r * p.split[mode]]));
    const usable = {
      tram: (60 / p.tram.headway_min) * p.tram.capacity * p.tram.planning_load,
      subway: p.subway.tph * p.subway.train_capacity * (1 - subwayArrivalLoad),
      bus: p.bus.trips_per_hour * p.bus.passengers_per_bus,
      ferry: (60 / p.ferry.headway_min) * p.ferry.capacity * (p.ferry.planning_load - p.ferry.onboard_load),
    };
    const headroom = Object.fromEntries(modes.map((mode) => [mode, usable[mode] - existing[mode]]));
    const fixed = Object.fromEntries(modes.map((mode) => [mode,
      p.split[mode] === 0 ? null : headroom[mode] / (r * p.split[mode])]));
    const bindingMode = modes.filter((mode) => p.split[mode] > 0)
      .reduce((best, mode) => fixed[mode] < fixed[best] ? mode : best);
    return {
      arrivalLoad: subwayArrivalLoad,
      r,
      existing,
      usable,
      headroom,
      fixed,
      bindingMode,
      fixedBindingHouseholds: fixed[bindingMode],
      fullReallocationHouseholds: modes.reduce((sum, mode) => sum + headroom[mode], 0) / r,
    };
  }
  return { validate, run, modes };
}));
