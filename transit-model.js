(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TransitModel = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function check(condition, message) {
    if (!condition) throw new Error(`Invalid transit snapshot: ${message}`);
  }
  function integer(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }
  function directional(items, from, to) {
    check(Array.isArray(items), "missing directions");
    const matches = items.filter((item) => item.from === from && item.to === to);
    check(matches.length === 1, `${from} to ${to} direction`);
    return matches[0];
  }
  function validate(data) {
    const { subway, tram, bus, ferry } = data;
    const commute = data.commute;
    check(commute?.dataset === "B08301", "commute snapshot");
    const serviceSnapshots = { subway, tram, bus, ferry };
    for (const [mode, snapshot] of Object.entries(serviceSnapshots)) {
      check(snapshot?.service_date === "2026-10-21" && typeof snapshot.service_day_definition === "string", `${mode} service day`);
    }
    check(subway?.mode === "subway" && tram?.mode === "Roosevelt Island Tram"
      && bus?.mode === "bus" && bus.route === "Q102" && ferry?.mode === "ferry" && ferry.route === "Astoria", "modes");
    const c = subway.calculation_per_segment;
    const trains = subway.user_specified_trains;
    check(c && trains?.M && trains?.F && [c.M_scheduled_trips, c.F_scheduled_trips,
      trains.M.passengers_per_train, trains.F.passengers_per_train, c.total_scheduled_trips, c.total_passenger_places].every(integer)
      && c.M_scheduled_trips + c.F_scheduled_trips === c.total_scheduled_trips
      && c.M_scheduled_trips * trains.M.passengers_per_train === c.M_passenger_places
      && c.F_scheduled_trips * trains.F.passengers_per_train === c.F_passenger_places
      && c.M_passenger_places + c.F_passenger_places === c.total_passenger_places, "subway calculation");
    check(c.M_scheduled_trips === 115 && c.F_scheduled_trips === 37
      && trains.M.passengers_per_train === 1680 && trains.F.passengers_per_train === 2100, "subway assumptions changed; update methodology");
    check(subway.segments?.length === 4, "subway segments");
    for (const borough of ["Manhattan", "Queens"]) {
      for (const [from, to] of [[borough, "Roosevelt Island"], ["Roosevelt Island", borough]]) {
        check(directional(subway.segments, from, to).passenger_places === c.total_passenger_places, "subway segment total");
      }
    }
    const trip = tram.assumptions_and_sources?.trip_count;
    const capacity = tram.assumptions_and_sources?.passengers_per_cabin?.value;
    check(tram.crossing?.mainland_endpoint === "Manhattan" && trip && [capacity, trip.trips_from_island, trip.trips_to_island].every(integer)
      && tram.result?.from_roosevelt_island_passenger_places === trip.trips_from_island * capacity
      && tram.result?.to_roosevelt_island_passenger_places === trip.trips_to_island * capacity, "tram calculation");
    check(trip.trips_from_island === 109 && trip.trips_to_island === 109 && capacity === 109, "tram assumptions changed; update methodology");
    check(bus.segments?.length === 2 && integer(bus.capacity_assumption?.passengers_per_bus), "bus capacity");
    check(bus.capacity_assumption.passengers_per_bus === 51, "bus assumption changed; update methodology");
    for (const [from, to] of [["Queens", "Roosevelt Island"], ["Roosevelt Island", "Queens"]]) {
      const segment = directional(bus.segments, from, to);
      check(integer(segment.scheduled_bus_trips) && segment.passenger_places === segment.scheduled_bus_trips * bus.capacity_assumption.passengers_per_bus, "bus calculation");
    }
    check(JSON.stringify(ferry.capacity_assumptions?.passengers_per_vessel_scenarios) === "[150,350]" && ferry.journeys?.length === 4, "ferry scenarios");
    for (const borough of ["Manhattan", "Queens"]) {
      for (const [from, to] of [[borough, "Roosevelt Island"], ["Roosevelt Island", borough]]) {
        const journey = directional(ferry.journeys, from, to);
        check(Array.isArray(journey.options) && journey.options.length === 2 && integer(journey.trips), "ferry options");
        check(journey.options.every((option) => typeof option.landing === "string" && option.landing.length > 0
          && integer(option.trips) && [150, 350].every((n) => option[`places_${n}`] === option.trips * n)), "ferry option calculation");
        check(journey.options.reduce((sum, option) => sum + option.trips, 0) === journey.trips
          && [150, 350].every((n) => journey[`places_${n}`] === journey.trips * n), "ferry journey calculation");
      }
    }
    check(commute?.dataset === "B08301" && commute.period === "2020-2024"
      && commute.universe === "Workers age 16 years and over"
      && Array.isArray(commute.source_geographies) && commute.source_geographies.length === 2
      && commute.source_geographies.every((geography) => /^3606102380[23]$/.test(geography.geoid)
        && integer(geography.pie_total))
      && Array.isArray(commute.modes) && commute.modes.length === 10
      && commute.modes.every((mode) => typeof mode.label === "string" && integer(mode.estimate) && integer(mode.moe))
      && commute.modes.reduce((sum, mode) => sum + mode.estimate, 0) === commute.total
      && commute.total === commute.source_geographies.reduce((sum, geography) => sum + geography.pie_total, 0)
      && integer(commute.total_moe), "commute summary");
    return data;
  }
  function rows(data, capacity) {
    validate(data);
    check([150, 350].includes(capacity), "unknown ferry scenario");
    const result = [];
    for (const borough of ["Manhattan", "Queens"]) {
      const inbound = (items) => directional(items, borough, "Roosevelt Island");
      const outbound = (items) => directional(items, "Roosevelt Island", borough);
      const subway = data.subway.calculation_per_segment;
      result.push({ mode: "Subway", borough, to: inbound(data.subway.segments).passenger_places,
        from: outbound(data.subway.segments).passenger_places,
        basis: `${subway.total_scheduled_trips} trains each direction; M and F` });
      result.push({ mode: "Tram", borough,
        to: borough === "Manhattan" ? data.tram.result.to_roosevelt_island_passenger_places : null,
        from: borough === "Manhattan" ? data.tram.result.from_roosevelt_island_passenger_places : null,
        basis: borough === "Manhattan" ? "109 trips each direction; 109 places per cabin" : "No direct tram crossing" });
      result.push({ mode: "Q102 bus", borough,
        to: borough === "Queens" ? inbound(data.bus.segments).passenger_places : null,
        from: borough === "Queens" ? outbound(data.bus.segments).passenger_places : null,
        basis: borough === "Queens" ? `${inbound(data.bus.segments).scheduled_bus_trips} inbound / ${outbound(data.bus.segments).scheduled_bus_trips} outbound trips; ${data.bus.capacity_assumption.passengers_per_bus} places per bus` : "No direct bus crossing in inventory" });
      const inFerry = inbound(data.ferry.journeys);
      const outFerry = outbound(data.ferry.journeys);
      result.push({ mode: "Ferry", borough, to: inFerry[`places_${capacity}`], from: outFerry[`places_${capacity}`],
        toOptions: inFerry.options, fromOptions: outFerry.options,
        basis: `${inFerry.trips} sailings each direction; ${capacity} places per vessel${borough === "Manhattan" ? "; via Queens" : ""}` });
    }
    return result;
  }
  return { validate, rows };
}));
