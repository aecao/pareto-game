"use strict";

(function (root) {
  const income = typeof module !== "undefined" && module.exports ? require("./income-model.js") : root.IncomeModel;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const tractKey = (value) => typeof value === "string" && /^36(005|047|061|081|085)\d{6}$/.test(value);
  const ntaKey = (value) => typeof value === "string" && /^(?:(BX|BK|MN|QN|SI)\d{4}|MN0801-RI)$/.test(value);

  function normalize(payload, scale = "tract", direction = "od") {
    const m = payload?.metadata;
    const reverse = direction === "do";
    const nta = scale === "neighborhood";
    const key = nta ? ntaKey : tractKey;
    if (payload?.type !== "FeatureCollection" || payload.schema_version !== 1 ||
        !["tract", "neighborhood"].includes(scale) || !["od", "do"].includes(direction) ||
        (reverse ? m?.direction !== "destination_origin" || m.residence_scope !== "NYC" : m?.direction !== undefined) ||
        (nta ? m?.scale !== "neighborhood" : (m?.scale !== undefined && m.scale !== "tract")) ||
        m?.dataset !== "lodes_origin_destination" || m.year !== 2023 || m.job_type !== "JT01" ||
        m.measure !== "primary_job_links" || m.destination_scope !== "NYC" ||
        m.geography_vintage !== 2020 || m.geometry_crs !== "EPSG:4326" ||
        m.center_method !== "EPSG:2263 geometric centroid" ||
        !Array.isArray(payload.features) || !payload.features.length || m.feature_count !== payload.features.length ||
        !Array.isArray(m.origin_geoids) || m.origin_geoids.length !== m.feature_count ||
        !m.origin_geoids.every(key) || new Set(m.origin_geoids).size !== m.feature_count ||
        !m.origin_areas || !Object.values(m.origin_areas).every((name) => typeof name === "string" && name) ||
        !payload.nodes || Array.isArray(payload.nodes) ||
        !(reverse ? [m.nyc_jobs, m.max_pair_jobs] : [m.nyc_jobs, m.resident_primary_jobs, m.outside_nyc_jobs, m.max_pair_jobs]).every(count) ||
        m.max_pair_jobs === 0 || m.display?.size_scale !== "square_root" ||
        !Number.isFinite(m.display?.min_node_radius_px) || m.display.min_node_radius_px <= 0 ||
        !Number.isFinite(m.display?.max_node_radius_px) ||
        m.display.max_node_radius_px <= m.display.min_node_radius_px ||
        !Number.isFinite(m.display?.min_link_width_px) ||
        !Number.isFinite(m.display?.max_link_width_px) || m.display.min_link_width_px <= 0 ||
        m.display.max_link_width_px <= m.display.min_link_width_px) {
      throw new Error("Invalid LODES origin-destination snapshot.");
    }
    const members = new Set();
    for (const [geoid, node] of Object.entries(payload.nodes)) {
      if (!key(geoid) || typeof node.name !== "string" || !node.name ||
          !Array.isArray(node.center) || node.center.length !== 2 ||
          !node.center.every(Number.isFinite) || Math.abs(node.center[0]) > 180 || Math.abs(node.center[1]) > 90) {
        throw new Error(`Invalid LODES tract node: ${geoid}.`);
      }
      if (nta) {
        if (!Array.isArray(node.members) || !node.members.length ||
            typeof node.borough !== "string" || !node.borough) throw new Error(`Invalid NTA membership: ${geoid}.`);
        for (const member of node.members) {
          if (!tractKey(member) || members.has(member)) throw new Error(`Duplicate or invalid NTA member: ${member}.`);
          members.add(member);
        }
      }
    }
    if (nta && (m.node_count !== Object.keys(payload.nodes).length || m.member_count !== members.size ||
        m.custom_split?.id !== "MN0801-RI" || m.custom_split.source_nta !== "MN0801" ||
        !Array.isArray(m.custom_split.tract_geoids) ||
        m.custom_split.tract_geoids.length !== 3 ||
        !["36061023802", "36061023803", "36061023804"].every((id) =>
          m.custom_split.tract_geoids.includes(id) && payload.nodes["MN0801-RI"]?.members.includes(id)) ||
        payload.nodes["MN0801-RI"]?.members.length !== 3 || !payload.nodes.MN0801)) {
      throw new Error("Invalid NTA coverage or Roosevelt Island split.");
    }
    let jobs = 0;
    let residents = 0;
    let excluded = 0;
    let maximum = 0;
    let sameArea = 0;
    const seen = new Set();
    const areas = new Set();
    for (const feature of payload.features) {
      const p = feature.properties;
      if (feature.type !== "Feature" || !income.polygon(feature.geometry) || !p ||
          !key(p.geoid) || seen.has(p.geoid) || !m.origin_geoids.includes(p.geoid) ||
          !Object.hasOwn(payload.nodes, p.geoid) || p.scale !== scale || p.dataset !== "od" ||
          typeof p.name !== "string" || !p.name ||
          p.borough !== (nta ? payload.nodes[p.geoid].borough : income.countyBoroughs[p.geoid.slice(2, 5)]) ||
          !Object.hasOwn(m.origin_areas, p.nta) || p.nta_name !== m.origin_areas[p.nta] ||
          !(reverse ? [p.total] : [p.total, p.resident_primary_jobs, p.outside_nyc_jobs]).every(count) ||
          (!reverse && p.total + p.outside_nyc_jobs !== p.resident_primary_jobs) || !Array.isArray(p.flows)) {
        throw new Error(`Invalid LODES origin tract: ${p?.geoid ?? "missing GEOID"}.`);
      }
      if (nta && (p.geoid !== p.nta || !Array.isArray(p.members) ||
          p.members.length !== payload.nodes[p.geoid].members.length ||
          new Set(p.members).size !== p.members.length ||
          !p.members.every((id) => payload.nodes[p.geoid].members.includes(id)))) {
        throw new Error(`Invalid NTA origin members: ${p.geoid}.`);
      }
      seen.add(p.geoid);
      areas.add(p.nta);
      const destinations = new Set();
      let total = 0;
      for (const flow of p.flows) {
        if (!key(flow.destination) || !Object.hasOwn(payload.nodes, flow.destination) ||
            destinations.has(flow.destination) || !count(flow.jobs) || flow.jobs === 0) {
          throw new Error(`Invalid or duplicate LODES destination: ${p.geoid}.`);
        }
        destinations.add(flow.destination);
        total += flow.jobs;
        if (flow.destination === p.geoid) sameArea += flow.jobs;
        maximum = Math.max(maximum, flow.jobs);
      }
      if (total !== p.total) throw new Error(`LODES counts do not reconcile: ${p.geoid}.`);
      jobs += total;
      if (!reverse) {
        residents += p.resident_primary_jobs;
        excluded += p.outside_nyc_jobs;
      }
    }
    if (jobs !== m.nyc_jobs || (!reverse && (residents !== m.resident_primary_jobs || excluded !== m.outside_nyc_jobs)) ||
        maximum !== m.max_pair_jobs || areas.size !== Object.keys(m.origin_areas).length ||
        (nta && sameArea !== m.same_area_jobs)) {
      throw new Error("LODES snapshot totals or origin areas do not reconcile.");
    }
    return payload;
  }

  function normalizeBoundaries(payload, data, scale) {
    const m = payload?.metadata;
    if (payload?.type !== "FeatureCollection" || m?.dataset !== "lodes_od_boundaries" ||
        m.scale !== scale || m.geography_vintage !== 2020 || m.geometry_crs !== "EPSG:4326" ||
        m.simplified !== false || !Array.isArray(payload.features) ||
        m.feature_count !== payload.features.length || m.feature_count !== Object.keys(data.nodes).length) {
      throw new Error("Invalid LODES destination boundaries.");
    }
    const boundaries = Object.create(null);
    for (const feature of payload.features) {
      const id = feature?.properties?.geoid;
      if (feature?.type !== "Feature" || !Object.hasOwn(data.nodes, id) ||
          Object.hasOwn(boundaries, id) || !income.polygon(feature.geometry)) {
        throw new Error(`Invalid or duplicate LODES destination boundary: ${id}.`);
      }
      boundaries[id] = feature;
    }
    return boundaries;
  }

  function visibleFlows(flows, minimum) {
    if (!Number.isSafeInteger(minimum) || minimum < 1) throw new Error("Invalid LODES minimum job-link threshold.");
    return flows.filter((flow) => flow.jobs >= minimum);
  }

  function thresholdPosition(minimum, maximum) {
    if (!count(maximum) || maximum < 1 || !count(minimum) || minimum < 1 || minimum > maximum) {
      throw new Error("Invalid LODES threshold range.");
    }
    return maximum === 1 ? 0 : Math.log(minimum) / Math.log(maximum) * 1000;
  }

  function thresholdFromPosition(position, maximum) {
    thresholdPosition(1, maximum);
    if (!Number.isFinite(position) || position < 0 || position > 1000) {
      throw new Error("Invalid LODES threshold slider position.");
    }
    return Math.round(Math.exp(position / 1000 * Math.log(maximum)));
  }

  function linkWidth(jobs, metadata) {
    if (!count(jobs) || jobs <= 0 || !count(metadata.max_pair_jobs) || jobs > metadata.max_pair_jobs ||
        !Number.isFinite(metadata.display?.min_link_width_px) || metadata.display.min_link_width_px <= 0 ||
        !Number.isFinite(metadata.display?.max_link_width_px) ||
        metadata.display.max_link_width_px <= metadata.display.min_link_width_px) {
      throw new Error("Invalid LODES link width input.");
    }
    const { min_link_width_px: minimum, max_link_width_px: maximum } = metadata.display;
    return minimum + Math.sqrt(jobs / metadata.max_pair_jobs) * (maximum - minimum);
  }

  function linkOpacity(jobs, metadata, keyConnection = false) {
    linkWidth(jobs, metadata);
    const fraction = Math.sqrt(jobs / metadata.max_pair_jobs);
    return keyConnection ? 0.2 + 0.75 * fraction : 0.08 + 0.47 * fraction;
  }

  function nodeRadius(jobs, metadata) {
    linkWidth(jobs, metadata);
    const { min_node_radius_px: minimum, max_node_radius_px: maximum } = metadata.display;
    if (!Number.isFinite(minimum) || minimum <= 0 || !Number.isFinite(maximum) || maximum <= minimum) {
      throw new Error("Invalid LODES node radius input.");
    }
    return minimum + Math.sqrt(jobs / metadata.max_pair_jobs) * (maximum - minimum);
  }

  const api = { normalize, normalizeBoundaries, visibleFlows, thresholdPosition, thresholdFromPosition, linkWidth, linkOpacity, nodeRadius };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OriginDestinationModel = api;
})(globalThis);
