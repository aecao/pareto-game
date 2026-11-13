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
    check(config?.schema_version === 3 && p, "schema");
    ["hh_existing", "workers_per_hh", "in_person", "transit_share", "peak_hour_share"].forEach((key) => check(finite(p[key]) && p[key] >= 0, key));
    check(p.hh_existing > 0 && p.workers_per_hh > 0 && p.transit_share <= 1 && p.in_person <= 1 && p.peak_hour_share <= 1, "household parameters");
    ["hh_existing_moe", "current_population", "current_population_moe", "average_household_size", "average_household_size_moe"]
      .forEach((key) => check(finite(p[key]) && p[key] >= 0, key));
    check(p.current_population > 0 && p.average_household_size > 0, "residential baseline");
    check(Array.isArray(config.acs_demand_identified) && config.acs_demand_identified.length > 0
      && new Set(config.acs_demand_identified).size === config.acs_demand_identified.length
      && config.acs_demand_identified.every((mode) => modes.includes(mode)), "ACS demand modes");
    check(p.split && modes.every((mode) => finite(p.split[mode]) && p.split[mode] >= 0 && p.split[mode] <= 1)
      && modes.some((mode) => p.split[mode] > 0)
      && Math.abs(modes.reduce((sum, mode) => sum + p.split[mode], 0) - 1) < 1e-9, "mode split");
    check(p.tram && finite(p.tram.headway_min) && p.tram.headway_min > 0 && finite(p.tram.capacity) && p.tram.capacity > 0
      && finite(p.tram.daily_trips) && p.tram.daily_trips > 0
      && finite(p.tram.planning_load) && p.tram.planning_load > 0 && p.tram.planning_load <= 1, "tram");
    check(p.subway && finite(p.subway.tph) && p.subway.tph > 0 && finite(p.subway.train_capacity) && p.subway.train_capacity > 0
      && finite(p.subway.daily_m_trips) && p.subway.daily_m_trips > 0
      && finite(p.subway.daily_f_trips) && p.subway.daily_f_trips > 0
      && finite(p.subway.f_train_capacity) && p.subway.f_train_capacity > 0, "subway");
    check(p.bus && finite(p.bus.trips_per_hour) && p.bus.trips_per_hour > 0
      && finite(p.bus.passengers_per_bus) && p.bus.passengers_per_bus > 0
      && finite(p.bus.daily_trips) && p.bus.daily_trips > 0, "bus");
    check(p.ferry && finite(p.ferry.headway_min) && p.ferry.headway_min > 0 && finite(p.ferry.capacity) && p.ferry.capacity > 0
      && finite(p.ferry.planning_load) && p.ferry.planning_load > 0 && p.ferry.planning_load <= 1
      && finite(p.ferry.onboard_load) && p.ferry.onboard_load >= 0 && p.ferry.onboard_load <= p.ferry.planning_load
      && finite(p.ferry.daily_trips) && p.ferry.daily_trips > 0, "ferry");
    check(Array.isArray(config.replace_with_real_data) && config.replace_with_real_data.length > 0, "replacement flags");
    check(Array.isArray(config.subway_arrival_load_scenarios)
      && config.subway_arrival_load_scenarios.length === 3
      && config.subway_arrival_load_scenarios.every((value) => finite(value) && value >= 0 && value < 1)
      && finite(config.default_subway_arrival_load)
      && config.subway_arrival_load_scenarios.includes(config.default_subway_arrival_load), "arrival-load scenarios");
    const sliderRanges = config.slider_ranges;
    const validHeadwayRange = (range, baseline) => range
      && finite(range.min) && range.min > 0
      && finite(range.max) && range.max > range.min
      && finite(range.step) && range.step > 0
      && baseline >= range.min && baseline <= range.max;
    check(sliderRanges
      && validHeadwayRange(sliderRanges.subway_headway_min, 60 / p.subway.tph)
      && validHeadwayRange(sliderRanges.bus_headway_min, 60 / p.bus.trips_per_hour), "headway slider ranges");
    const tramwayEstimate = config.tramway_ridership_estimate;
    check(tramwayEstimate && /^\d{4}-\d{2}$/.test(tramwayEstimate.month)
      && finite(tramwayEstimate.monthly_riders) && tramwayEstimate.monthly_riders > 0
      && Number.isInteger(tramwayEstimate.days_in_month) && tramwayEstimate.days_in_month > 0
      && typeof tramwayEstimate.source_url === "string" && tramwayEstimate.source_url.startsWith("https://")
      && typeof tramwayEstimate.attribution_status === "string" && tramwayEstimate.attribution_status.length > 0
      && typeof tramwayEstimate.period_note === "string" && tramwayEstimate.period_note.length > 0,
    "Tramway ridership estimate");
    const tramwayCrowdingScenario = config.tramway_crowding_scenario;
    check(tramwayCrowdingScenario && finite(tramwayCrowdingScenario.peak_load_factor)
      && tramwayCrowdingScenario.peak_load_factor > 0 && tramwayCrowdingScenario.peak_load_factor <= 1
      && typeof tramwayCrowdingScenario.status === "string" && tramwayCrowdingScenario.status.length > 0,
    "Tramway crowding scenario");
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
    const tramwayGrossCapacity = (60 / p.tram.headway_min) * p.tram.capacity;
    const tramwayCrowdingScenario = {
      peakLoadFactor: config.tramway_crowding_scenario.peak_load_factor,
      estimatedPeakDemand: tramwayGrossCapacity * config.tramway_crowding_scenario.peak_load_factor,
      grossCapacity: tramwayGrossCapacity,
      planningCapacity: usable.tram,
      excessOverPlanning: tramwayGrossCapacity * config.tramway_crowding_scenario.peak_load_factor - usable.tram,
      grossHeadroom: tramwayGrossCapacity * (1 - config.tramway_crowding_scenario.peak_load_factor),
      status: config.tramway_crowding_scenario.status,
    };
    const estimatedDemand = { ...existing, tram: tramwayCrowdingScenario.estimatedPeakDemand };
    const headroom = Object.fromEntries(modes.map((mode) => [mode, usable[mode] - estimatedDemand[mode]]));
    const fixed = Object.fromEntries(modes.map((mode) => [mode,
      p.split[mode] === 0 ? null : headroom[mode] / (r * p.split[mode])]));
    const bindingMode = modes.filter((mode) => p.split[mode] > 0)
      .reduce((best, mode) => fixed[mode] < fixed[best] ? mode : best);
    const dailyTripsPerHousehold = p.workers_per_hh * p.in_person * p.transit_share;
    const dailyExisting = Object.fromEntries(modes.map((mode) => [
      mode, p.hh_existing * dailyTripsPerHousehold * p.split[mode],
    ]));
    const dailyUsable = {
      subway: (p.subway.daily_m_trips * p.subway.train_capacity
        + p.subway.daily_f_trips * p.subway.f_train_capacity) * (1 - subwayArrivalLoad),
      bus: p.bus.daily_trips * p.bus.passengers_per_bus,
      tram: p.tram.daily_trips * p.tram.capacity * p.tram.planning_load,
      ferry: p.ferry.daily_trips * p.ferry.capacity * (p.ferry.planning_load - p.ferry.onboard_load),
    };
    const tramwayEstimate = config.tramway_ridership_estimate;
    const tramwayDemandEstimate = {
      month: tramwayEstimate.month,
      monthlyRiders: tramwayEstimate.monthly_riders,
      daysInMonth: tramwayEstimate.days_in_month,
      averageDailyRiders: tramwayEstimate.monthly_riders / tramwayEstimate.days_in_month,
      sourceUrl: tramwayEstimate.source_url,
      attributionStatus: tramwayEstimate.attribution_status,
      periodNote: tramwayEstimate.period_note,
    };
    const dailyHeadroom = Object.fromEntries(modes.map((mode) => [
      mode, dailyUsable[mode] - dailyExisting[mode],
    ]));
    const dailyFixed = Object.fromEntries(modes.map((mode) => [
      mode, p.split[mode] === 0 ? null : dailyHeadroom[mode] / (dailyTripsPerHousehold * p.split[mode]),
    ]));
    const dailyBindingMode = modes.filter((mode) => p.split[mode] > 0)
      .reduce((best, mode) => dailyFixed[mode] < dailyFixed[best] ? mode : best);
    const makeResidentialCapacity = (fixedAdditionalHouseholds, reallocatedAdditionalHouseholds) => {
      const fixedAdditionalResidents = fixedAdditionalHouseholds * p.average_household_size;
      const reallocatedAdditionalResidents = reallocatedAdditionalHouseholds * p.average_household_size;
      return {
        fixed: {
          additionalHouseholds: fixedAdditionalHouseholds,
          totalHouseholds: p.hh_existing + fixedAdditionalHouseholds,
          additionalResidents: fixedAdditionalResidents,
          totalResidents: p.current_population + fixedAdditionalResidents,
        },
        reallocated: {
          additionalHouseholds: reallocatedAdditionalHouseholds,
          totalHouseholds: p.hh_existing + reallocatedAdditionalHouseholds,
          additionalResidents: reallocatedAdditionalResidents,
          totalResidents: p.current_population + reallocatedAdditionalResidents,
        },
      };
    };
    const residentialCapacity = makeResidentialCapacity(
      fixed[bindingMode],
      modes.reduce((sum, mode) => sum + headroom[mode], 0) / r,
    );
    const dailyResidentialCapacity = makeResidentialCapacity(
      dailyFixed[dailyBindingMode],
      modes.reduce((sum, mode) => sum + dailyHeadroom[mode], 0) / dailyTripsPerHousehold,
    );
    return {
      arrivalLoad: subwayArrivalLoad,
      r,
      existing,
      estimatedDemand,
      usable,
      headroom,
      totalCapacity: modes.reduce((sum, mode) => sum + usable[mode], 0),
      fixed,
      bindingMode,
      fixedBindingHouseholds: fixed[bindingMode],
      fullReallocationHouseholds: modes.reduce((sum, mode) => sum + headroom[mode], 0) / r,
      residentialCapacity,
      tramwayDemandEstimate,
      tramwayCrowdingScenario,
      daily: {
        tripsPerHousehold: dailyTripsPerHousehold,
        existing: dailyExisting,
        usable: dailyUsable,
        headroom: dailyHeadroom,
        totalCapacity: modes.reduce((sum, mode) => sum + dailyUsable[mode], 0),
        fixed: dailyFixed,
        bindingMode: dailyBindingMode,
        fixedBindingHouseholds: dailyFixed[dailyBindingMode],
        fullReallocationHouseholds: modes.reduce((sum, mode) => sum + dailyHeadroom[mode], 0) / dailyTripsPerHousehold,
        residentialCapacity: dailyResidentialCapacity,
      },
    };
  }
  return { validate, run, modes };
}));
