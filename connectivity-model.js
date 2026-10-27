(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ConnectivityModel = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const BUDGETS = [15, 30, 45, 60];
  const MAX_BUDGET = BUDGETS.at(-1);
  const QUEENS = 1;
  const ISLAND = 2;
  const SOURCE = 4;
  function requireValue(condition, message) {
    if (!condition) throw new Error(`Invalid walking snapshot: ${message}`);
  }
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  function checkCollection(name, collection) {
    requireValue(collection?.type === "FeatureCollection" && Array.isArray(collection.features)
      && collection.features.length > 0, `missing ${name}`);
    function coordinates(value) {
      requireValue(Array.isArray(value) && value.length > 0, `${name} coordinates`);
      if (typeof value[0] === "number") {
        requireValue(value.length === 2 && value.every(finite)
          && value[0] >= -74.4 && value[0] <= -73.5 && value[1] >= 40.4 && value[1] <= 41,
        `${name} coordinate range`);
      } else value.forEach(coordinates);
    }
    for (const feature of collection.features) {
      requireValue(feature?.type === "Feature" && feature.properties && feature.geometry, `${name} feature`);
      requireValue(["Point", "LineString", "MultiLineString", "Polygon", "MultiPolygon"].includes(feature.geometry.type),
        `${name} geometry type`);
      coordinates(feature.geometry.coordinates);
    }
  }
  function scenarioName(data, selected) {
    const ids = data.bridges.map((bridge) => bridge.id).filter((id) => selected.includes(id));
    requireValue(ids.length === new Set(selected).size, "unknown bridge selection");
    return ids.length ? ids.join("+") : "baseline";
  }
  function validate(data) {
    requireValue(data && data.schema_version === 5, "unsupported schema");
    requireValue(data.settings?.origin_method === "roosevelt_island_centroid_with_nearest_street_connector",
      "unexpected origin method");
    requireValue(JSON.stringify(data.settings.thresholds_minutes) === JSON.stringify(BUDGETS), "unexpected budgets");
    requireValue(data.settings.walking_speed_mph === 3, "unexpected speed");
    requireValue(data.provenance?.geometry_crs === "EPSG:4326" && data.provenance.lion === "26c", "missing provenance");
    requireValue(Array.isArray(data.bridges) && data.bridges.length === 3, "bridge count");
    for (const bridge of data.bridges) {
      requireValue(typeof bridge.id === "string" && typeof bridge.label === "string"
        && finite(bridge.length_ft) && bridge.length_ft > 0 && finite(bridge.deck_minutes) && bridge.deck_minutes > 0
        && Array.isArray(bridge.stops) && bridge.stops.length >= 2, `bridge ${bridge.id}`);
    }
    const ids = data.bridges.map((bridge) => bridge.id);
    requireValue(new Set(ids).size === ids.length, "duplicate bridge ids");
    const expected = [];
    for (let mask = 0; mask < 2 ** ids.length; mask += 1) {
      expected.push(scenarioName(data, ids.filter((_id, i) => mask & (1 << i))));
    }
    requireValue(Object.keys(data.scenarios ?? {}).length === expected.length
      && expected.every((name) => Array.isArray(data.scenarios[name])
        && scenarioName(data, data.scenarios[name]) === name), "scenario set");
    requireValue(data.validation?.adding_bridges_never_worsens_times === true
      && data.validation.existing_island_bridge_in_baseline === true
      && data.validation.origin_is_roosevelt_island_centroid === true
      && data.validation.every_bridge_deck_reachable === true, "unverified scenarios");
    requireValue(!("example_routes" in data) && !("reachable_streets" in data), "obsolete fields are not supported");
    for (const name of ["edges", "links", "markers", "island"]) checkCollection(name, data[name]);
    const nodeCount = data.node_flags?.length;
    requireValue(Number.isInteger(nodeCount) && nodeCount > 0
      && data.node_flags.every((flag) => Number.isInteger(flag) && flag >= 0 && flag < 8), "node flags");
    for (const name of expected) {
      const times = data.node_times?.[name];
      requireValue(Array.isArray(times) && times.length === nodeCount
        && times.every((t) => t === null || (finite(t) && t >= 0 && t <= BUDGETS.at(-1) + 1e-9)), `node times ${name}`);
    }
    for (const feature of data.edges.features) {
      const p = feature.properties;
      requireValue(feature.geometry.type === "LineString" && typeof p.k === "string" && typeof p.s === "string"
        && Number.isInteger(p.u) && Number.isInteger(p.v) && p.u < nodeCount && p.v < nodeCount
        && finite(p.m) && p.m > 0 && finite(p.l) && p.l > 0
        && Array.isArray(p.f) && p.f.length === feature.geometry.coordinates.length
        && p.f[0] === 0 && p.f.at(-1) === 1 && p.f.every((x, i) => finite(x) && (i === 0 || x >= p.f[i - 1]))
        && (p.bridge === null || ids.includes(p.bridge)), "edge");
    }
    requireValue(data.summary?.length === expected.length * BUDGETS.length, "summary count");
    const summaryKeys = new Set();
    for (const row of data.summary) {
      requireValue(expected.includes(row.scenario) && BUDGETS.includes(row.budget_minutes), "summary selector");
      for (const key of ["reachable_source_nodes", "queens_source_nodes", "island_source_nodes", "other_source_nodes"]) {
        requireValue(Number.isInteger(row[key]) && row[key] >= 0, `summary ${key}`);
      }
      for (const key of ["existing_source_edge_miles", "queens_source_edge_miles"]) {
        requireValue(finite(row[key]) && row[key] >= 0, `summary ${key}`);
      }
      summaryKeys.add(`${row.scenario}:${row.budget_minutes}`);
    }
    requireValue(summaryKeys.size === data.summary.length, "duplicate summary rows");
    for (const id of ids) {
      requireValue(BUDGETS.some((budget) => {
        const a = summaryRow(data, "baseline", budget);
        const b = summaryRow(data, id, budget);
        return a.reachable_source_nodes !== b.reachable_source_nodes
          || a.existing_source_edge_miles !== b.existing_source_edge_miles;
      }), `bridge ${id} has no effect`);
    }
    requireValue(data.markers.features.some((f) => f.properties.role === "origin"), "origin marker");
    return data;
  }
  function summaryRow(data, scenario, budget) {
    const row = data.summary.find((r) => r.scenario === scenario && r.budget_minutes === budget);
    requireValue(row, "selection");
    return row;
  }
  function pointAt(coordinates, fractions, target) {
    let i = 1;
    while (i < fractions.length - 1 && fractions[i] < target) i += 1;
    const span = fractions[i] - fractions[i - 1];
    const t = span > 0 ? (target - fractions[i - 1]) / span : 0;
    const [a, b] = [coordinates[i - 1], coordinates[i]];
    return { index: i, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
  }
  function substring(coordinates, fractions, start, end) {
    const first = pointAt(coordinates, fractions, start);
    const last = pointAt(coordinates, fractions, end);
    const inner = [];
    for (let i = first.index; i < last.index; i += 1) inner.push(coordinates[i]);
    return [first.point, ...inner, last.point];
  }
  // Mirrors project_utils.walking.reachable_parts: walk in from either endpoint until the budget runs out.
  function trim(feature, times, budget) {
    const p = feature.properties;
    const tu = times[p.u] ?? Infinity;
    const tv = times[p.v] ?? Infinity;
    const a = Math.min(1, Math.max(0, (budget - tu) / p.m));
    const b = Math.min(1, Math.max(0, (budget - tv) / p.m));
    const coordinates = feature.geometry.coordinates;
    if (a + b >= 1) return { fraction: 1, parts: [coordinates] };
    const parts = [];
    if (a * p.l > 1e-6) parts.push(substring(coordinates, p.f, 0, a));
    if (b * p.l > 1e-6) parts.push(substring(coordinates, p.f, 1 - b, 1));
    return { fraction: a + b, parts };
  }
  // Splits an edge's reachable intervals at every `step`-minute isochrone, keeping the faster endpoint's time.
  function bands(feature, times, budget, step) {
    const p = feature.properties;
    const tu = times[p.u] ?? Infinity;
    const tv = times[p.v] ?? Infinity;
    const a = Math.min(1, Math.max(0, (budget - tu) / p.m));
    const b = Math.min(1, Math.max(0, (budget - tv) / p.m));
    let meet = 0.5;
    if (tu === Infinity) meet = 0;
    else if (tv === Infinity) meet = 1;
    else meet = Math.min(1, Math.max(0, (tv - tu + p.m) / (2 * p.m)));
    const coordinates = feature.geometry.coordinates;
    const result = [];
    // Walks outward from an endpoint at time t0 over fractions [0, reach] (distance from that endpoint).
    function walk(t0, reach, toFraction) {
      let d = 0;
      while (d < reach - 1e-9) {
        const band = Math.floor((t0 + d * p.m) / step + 1e-9);
        const next = Math.min(reach, ((band + 1) * step - t0) / p.m);
        const [x0, x1] = [toFraction(d), toFraction(next)].sort((x, y) => x - y);
        if ((x1 - x0) * p.l > 1e-6) result.push({ band, from: x0, to: x1, coordinates: substring(coordinates, p.f, x0, x1) });
        d = next;
      }
    }
    walk(tu, Math.min(a, meet), (d) => d);
    walk(tv, Math.min(b, 1 - meet), (d) => 1 - d);
    return result;
  }
  function checkBudget(data, scenario, budget) {
    requireValue(finite(budget) && budget >= 0 && budget <= MAX_BUDGET && scenario in data.node_times, "selection");
  }
  function bandedReachable(data, scenario, budget, step) {
    checkBudget(data, scenario, budget);
    const times = data.node_times[scenario];
    const active = new Set(data.scenarios[scenario]);
    const result = [];
    for (const feature of data.edges.features) {
      if (feature.properties.bridge !== null && !active.has(feature.properties.bridge)) continue;
      for (const piece of bands(feature, times, budget, step)) result.push({ feature, ...piece });
    }
    return result;
  }
  function reachable(data, scenario, budget) {
    checkBudget(data, scenario, budget);
    const times = data.node_times[scenario];
    const active = new Set(data.scenarios[scenario]);
    const result = [];
    for (const feature of data.edges.features) {
      if (feature.properties.bridge !== null && !active.has(feature.properties.bridge)) continue;
      const { fraction, parts } = trim(feature, times, budget);
      if (parts.length) result.push({ feature, fraction, parts });
    }
    return result;
  }
  function metrics(data, scenario, budget) {
    checkBudget(data, scenario, budget);
    const row = data.summary.find((r) => r.scenario === scenario && r.budget_minutes === budget) ?? null;
    const times = data.node_times[scenario];
    let queens = 0;
    let island = 0;
    let other = 0;
    data.node_flags.forEach((flag, i) => {
      if (!(flag & SOURCE) || times[i] === null || times[i] > budget) return;
      if (flag & QUEENS) queens += 1;
      else if (flag & ISLAND) island += 1;
      else other += 1;
    });
    const existing = reachable(data, scenario, budget)
      .filter((item) => item.feature.properties.kind === "existing");
    const feet = (items) => items.reduce((sum, item) => sum + item.fraction * item.feature.properties.l, 0);
    const existingMiles = feet(existing) / 5280;
    const queensMiles = feet(existing.filter((item) => item.feature.properties.q)) / 5280;
    return {
      row, queens, island, other, existingMiles, queensMiles,
    };
  }
  return {
    validate, scenarioName, trim, bands, reachable, bandedReachable, metrics, summaryRow, BUDGETS, MAX_BUDGET,
  };
}));
