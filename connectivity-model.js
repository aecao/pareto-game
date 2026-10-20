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
  function validate(data) {
    requireValue(data && data.schema_version === 3, "unsupported schema");
    requireValue(data.settings?.site_id === "Q00313_4003130001", "unexpected comparison site");
    requireValue(data.settings?.origin_method === "roosevelt_island_bridge_landing_with_explicit_access_connector",
      "unexpected origin method");
    requireValue(JSON.stringify(data.settings.thresholds_minutes) === "[15,30,45]", "unexpected budgets");
    requireValue(data.settings.walking_speed_mph === 3, "unexpected speed");
    requireValue(data.provenance?.geometry_crs === "EPSG:4326" && data.provenance.lion === "26c", "missing provenance");
    requireValue(finite(data.bridge_length_ft) && data.bridge_length_ft > 0, "bridge length");
    requireValue(finite(data.bridge_minutes) && data.bridge_minutes > 0, "bridge time");
    requireValue(data.validation?.origin_is_roosevelt_island === true
      && data.validation.origin_is_island_bridge_landing === true
      && data.validation.baseline_node_times_not_worsened === true
      && data.validation.existing_island_bridge_in_baseline === true
      && data.validation.hypothetical_bridge_in_scenario === true, "unverified scenario");
    requireValue(!("example_routes" in data) && !("destination_times" in data) && !("route_inventory" in data),
      "obsolete route fields are not supported");
    for (const name of ["reachable_streets", "scenario_links", "markers", "site", "island"]) {
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
    requireValue([15, 30, 45].some((budget) => {
      const rows = data.summary.filter((row) => row.budget_minutes === budget);
      return rows[0].queens_source_nodes !== rows[1].queens_source_nodes
        || rows[0].island_source_nodes !== rows[1].island_source_nodes;
    }), "baseline and bridge reachability are identical");
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
    const origin = data.markers.features.find((f) =>
      f.properties.name === "Roosevelt Island bridge landing (origin)");
    const landing = data.markers.features.find((f) =>
      f.properties.name === "Provisional Roosevelt Island landing");
    const bridge = data.scenario_links.features.find((f) => f.properties.kind === "hypothetical_bridge");
    requireValue(origin?.geometry.type === "Point" && landing?.geometry.type === "Point"
      && JSON.stringify(origin.geometry.coordinates) === JSON.stringify(landing.geometry.coordinates)
      && bridge.geometry.type === "LineString"
      && bridge.geometry.coordinates.some((point) =>
        JSON.stringify(point) === JSON.stringify(origin.geometry.coordinates)),
    "origin must be the island-side bridge landing");
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
