(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ConnectivityModel = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function requireValue(condition, message) {
    if (!condition) throw new Error(`Invalid walking snapshot: ${message}`);
  }
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const time = (value) => value === null || (finite(value) && value >= 0 && value <= 45);
  function validate(data) {
    requireValue(data && data.schema_version === 1, "unsupported schema");
    requireValue(data.settings?.site_id === "Q00313_4003130001", "unexpected origin site");
    requireValue(JSON.stringify(data.settings.thresholds_minutes) === "[15,30,45]", "unexpected budgets");
    requireValue(data.settings.walking_speed_mph === 3, "unexpected speed");
    requireValue(data.provenance?.geometry_crs === "EPSG:4326" && data.provenance.lion === "26c", "missing provenance");
    requireValue(finite(data.bridge_length_ft) && data.bridge_length_ft > 0, "bridge length");
    requireValue(finite(data.bridge_minutes) && data.bridge_minutes > 0, "bridge time");
    requireValue(data.validation?.all_baseline_trips_preserved_or_improved === true
      && data.validation.existing_island_bridge_used_in_baseline === true
      && data.validation.hypothetical_bridge_used_in_scenario === true, "unverified routes");
    requireValue(data.validation.queens_nodes_improved === 0
      && data.validation.queens_nodes_newly_reached === 0, "Queens result differs from supported snapshot");
    for (const name of ["reachable_streets", "scenario_links", "markers", "example_routes", "site", "island"]) {
      const collection = data[name];
      requireValue(collection?.type === "FeatureCollection" && Array.isArray(collection.features)
        && collection.features.length > 0, `missing ${name}`);
      for (const feature of collection.features) {
        requireValue(feature.type === "Feature" && feature.properties && feature.geometry, `${name} feature`);
        const geometry = feature.geometry;
        requireValue(["Point", "LineString", "MultiLineString", "Polygon", "MultiPolygon"].includes(geometry.type), `${name} geometry type`);
        function coordinates(value) {
          requireValue(Array.isArray(value) && value.length > 0, `${name} coordinates`);
          if (typeof value[0] === "number") {
            requireValue(value.length === 2 && value.every(finite)
              && value[0] >= -74.4 && value[0] <= -73.5 && value[1] >= 40.4 && value[1] <= 41,
            `${name} coordinate range`);
          } else value.forEach(coordinates);
        }
        coordinates(geometry.coordinates);
      }
    }
    requireValue(data.summary?.length === 6, "summary count");
    const summaryKeys = new Set();
    for (const row of data.summary) {
      requireValue(["baseline", "bridge"].includes(row.scenario) && [15, 30, 45].includes(row.budget_minutes), "summary selector");
      for (const key of ["reachable_source_nodes", "queens_source_nodes", "island_source_nodes"]) {
        requireValue(Number.isInteger(row[key]) && row[key] >= 0, `summary ${key}`);
      }
      summaryKeys.add(`${row.scenario}:${row.budget_minutes}`);
    }
    requireValue(summaryKeys.size === 6, "duplicate summary rows");
    for (const budget of [15, 30, 45]) {
      const rows = data.summary.filter((r) => r.budget_minutes === budget);
      requireValue(rows[0].queens_source_nodes === rows[1].queens_source_nodes, "Queens count disagreement");
    }
    requireValue(Array.isArray(data.destination_times) && data.destination_times.length > 0, "destinations");
    const names = new Set();
    for (const row of data.destination_times) {
      requireValue(typeof row.destination === "string" && row.destination.length > 0 && !names.has(row.destination), "duplicate/missing destination");
      requireValue(time(row.baseline_minutes) && time(row.bridge_minutes), "destination time");
      names.add(row.destination);
    }
    const routeKeys = new Set();
    for (const feature of data.example_routes.features) {
      const p = feature.properties;
      requireValue(names.has(p.destination) && ["baseline", "bridge"].includes(p.scenario)
        && finite(p.minutes) && time(p.minutes), "example route");
      const row = data.destination_times.find((r) => r.destination === p.destination);
      requireValue(Math.abs(row[`${p.scenario}_minutes`] - p.minutes) < 1e-8
        && row[`${p.scenario}_minutes`] !== null, "route/table disagreement");
      const key = `${p.destination}:${p.scenario}`;
      requireValue(!routeKeys.has(key), "duplicate route");
      routeKeys.add(key);
    }
    for (const row of data.destination_times) {
      for (const scenario of ["baseline", "bridge"]) {
        requireValue(routeKeys.has(`${row.destination}:${scenario}`) === (row[`${scenario}_minutes`] !== null), "missing route");
      }
    }
    for (const feature of data.reachable_streets.features) {
      const p = feature.properties;
      requireValue(["baseline", "bridge"].includes(p.scenario) && [15, 30, 45].includes(p.budget_minutes)
        && typeof p.street === "string" && typeof p.edge_key === "string", "reachable interval");
      requireValue(["LineString", "MultiLineString"].includes(feature.geometry.type), "street line geometry");
    }
    for (const feature of data.scenario_links.features) {
      const p = feature.properties;
      requireValue(typeof p.name === "string" && typeof p.street === "string"
        && finite(p.length_ft) && p.length_ft > 0 && finite(p.minutes) && p.minutes > 0
        && ["hypothetical_bridge", "assumed_access"].includes(p.kind), "scenario link");
    }
    requireValue(data.scenario_links.features.filter((f) => f.properties.kind === "hypothetical_bridge").length === 1, "bridge count");
    requireValue(data.markers.features.every((f) => typeof f.properties.name === "string"), "marker labels");
    const island = data.destination_times.find((r) => r.destination === "Roosevelt Island landing street");
    requireValue(island && island.baseline_minutes !== null && island.bridge_minutes !== null, "island destination");
    for (const scenario of ["baseline", "bridge"]) {
      for (const budget of [15, 30, 45]) {
        requireValue(data.reachable_streets.features.some((f) => f.properties.scenario === scenario
          && f.properties.budget_minutes === budget), "missing reachable scenario/budget");
      }
    }
    return data;
  }
  function selection(data, budget, scenario) {
    requireValue([15, 30, 45].includes(budget) && ["both", "baseline", "bridge"].includes(scenario), "selection");
    return data.reachable_streets.features.filter((feature) =>
      feature.properties.budget_minutes === budget
      && (scenario === "both" || feature.properties.scenario === scenario));
  }
  return { validate, selection };
}));
