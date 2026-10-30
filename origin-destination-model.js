"use strict";

(function (root) {
  const income = typeof module !== "undefined" && module.exports ? require("./income-model.js") : root.IncomeModel;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const tractKey = (value) => typeof value === "string" && /^36(005|047|061|081|085)\d{6}$/.test(value);

  function normalize(payload) {
    const m = payload?.metadata;
    if (payload?.type !== "FeatureCollection" || payload.schema_version !== 1 ||
        m?.dataset !== "lodes_origin_destination" || m.year !== 2023 || m.job_type !== "JT01" ||
        m.measure !== "primary_job_links" || m.destination_scope !== "NYC" ||
        m.geography_vintage !== 2020 || m.geometry_crs !== "EPSG:4326" ||
        m.center_method !== "EPSG:2263 geometric centroid" ||
        !Array.isArray(payload.features) || !payload.features.length || m.feature_count !== payload.features.length ||
        !Array.isArray(m.origin_geoids) || m.origin_geoids.length !== m.feature_count ||
        !m.origin_geoids.every(tractKey) || new Set(m.origin_geoids).size !== m.feature_count ||
        !m.origin_areas || !Object.values(m.origin_areas).every((name) => typeof name === "string" && name) ||
        !payload.nodes || Array.isArray(payload.nodes) ||
        ![m.nyc_jobs, m.resident_primary_jobs, m.outside_nyc_jobs, m.max_pair_jobs].every(count) ||
        m.max_pair_jobs === 0 || !Number.isFinite(m.display?.min_link_width_px) ||
        !Number.isFinite(m.display?.max_link_width_px) || m.display.min_link_width_px <= 0 ||
        m.display.max_link_width_px <= m.display.min_link_width_px) {
      throw new Error("Invalid LODES origin-destination snapshot.");
    }
    for (const [geoid, node] of Object.entries(payload.nodes)) {
      if (!tractKey(geoid) || typeof node.name !== "string" || !node.name ||
          !Array.isArray(node.center) || node.center.length !== 2 ||
          !node.center.every(Number.isFinite) || Math.abs(node.center[0]) > 180 || Math.abs(node.center[1]) > 90) {
        throw new Error(`Invalid LODES tract node: ${geoid}.`);
      }
    }
    let jobs = 0;
    let residents = 0;
    let excluded = 0;
    let maximum = 0;
    const seen = new Set();
    const areas = new Set();
    for (const feature of payload.features) {
      const p = feature.properties;
      if (feature.type !== "Feature" || !income.polygon(feature.geometry) || !p ||
          !tractKey(p.geoid) || seen.has(p.geoid) || !m.origin_geoids.includes(p.geoid) ||
          !Object.hasOwn(payload.nodes, p.geoid) || p.scale !== "tract" || p.dataset !== "od" ||
          typeof p.name !== "string" || !p.name || p.borough !== income.countyBoroughs[p.geoid.slice(2, 5)] ||
          !Object.hasOwn(m.origin_areas, p.nta) || p.nta_name !== m.origin_areas[p.nta] ||
          ![p.total, p.resident_primary_jobs, p.outside_nyc_jobs].every(count) ||
          p.total + p.outside_nyc_jobs !== p.resident_primary_jobs || !Array.isArray(p.flows)) {
        throw new Error(`Invalid LODES origin tract: ${p?.geoid ?? "missing GEOID"}.`);
      }
      seen.add(p.geoid);
      areas.add(p.nta);
      const destinations = new Set();
      let total = 0;
      for (const flow of p.flows) {
        if (!tractKey(flow.destination) || !Object.hasOwn(payload.nodes, flow.destination) ||
            destinations.has(flow.destination) || !count(flow.jobs) || flow.jobs === 0) {
          throw new Error(`Invalid or duplicate LODES destination: ${p.geoid}.`);
        }
        destinations.add(flow.destination);
        total += flow.jobs;
        maximum = Math.max(maximum, flow.jobs);
      }
      if (total !== p.total) throw new Error(`LODES counts do not reconcile: ${p.geoid}.`);
      jobs += total;
      residents += p.resident_primary_jobs;
      excluded += p.outside_nyc_jobs;
    }
    if (jobs !== m.nyc_jobs || residents !== m.resident_primary_jobs || excluded !== m.outside_nyc_jobs ||
        maximum !== m.max_pair_jobs || areas.size !== Object.keys(m.origin_areas).length) {
      throw new Error("LODES snapshot totals or origin areas do not reconcile.");
    }
    return payload;
  }

  function linkWidth(jobs, metadata) {
    if (!count(jobs) || jobs <= 0 || !count(metadata.max_pair_jobs) || jobs > metadata.max_pair_jobs ||
        !Number.isFinite(metadata.display?.min_link_width_px) || metadata.display.min_link_width_px <= 0 ||
        !Number.isFinite(metadata.display?.max_link_width_px) ||
        metadata.display.max_link_width_px <= metadata.display.min_link_width_px) {
      throw new Error("Invalid LODES link width input.");
    }
    const { min_link_width_px: minimum, max_link_width_px: maximum } = metadata.display;
    return minimum + jobs / metadata.max_pair_jobs * (maximum - minimum);
  }

  const api = { normalize, linkWidth };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OriginDestinationModel = api;
})(globalThis);
