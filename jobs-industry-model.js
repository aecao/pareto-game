"use strict";

(function (root) {
  const income = typeof module !== "undefined" && module.exports ? require("./income-model.js") : root.IncomeModel;
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const keys = ["healthcare_education_government", "manufacturing_logistics", "professional", "retail_hospitality_other"];

  function normalize(payload, scale) {
    const m = payload?.metadata;
    if (payload?.type !== "FeatureCollection" || payload.schema_version !== 1 ||
        !["tract", "neighborhood"].includes(scale) || m?.dataset !== "jobs_industry" || m.scale !== scale ||
        m.year !== 2023 || m.job_type !== "JT01" || m.geography_vintage !== 2020 ||
        m.geometry_crs !== "EPSG:4326" || m.placement !== "land_only" ||
        m.sampling_area_units !== "square US feet" || !integer(m.jobs_per_dot) || m.jobs_per_dot < 1 ||
        !integer(m.random_seed) || !integer(m.total_jobs) || !Array.isArray(payload.features) ||
        !payload.features.length || m.feature_count !== payload.features.length ||
        !m.groups || JSON.stringify(Object.keys(m.groups).sort()) !== JSON.stringify(keys) ||
        !keys.every(key => typeof m.groups[key].label === "string" && m.groups[key].label &&
          /^#[0-9a-f]{6}$/i.test(m.groups[key].color))) {
      throw new Error("Invalid jobs/industry snapshot.");
    }
    const seen = new Set();
    let total = 0;
    for (const f of payload.features) {
      const p = f?.properties;
      const validKey = scale === "tract" ? /^36(005|047|061|081|085)\d{6}$/ : /^(?:(BX|BK|MN|QN|SI)\d{4}|MN0801-RI)$/;
      if (f?.type !== "Feature" || !income.polygon(f.geometry) || !p ||
          !validKey.test(p.geoid) || seen.has(p.geoid) || p.dataset !== "jobs" || p.scale !== scale ||
          typeof p.name !== "string" || !p.name || typeof p.borough !== "string" || !p.borough ||
          !integer(p.total) || !p.industries ||
          JSON.stringify(Object.keys(p.industries).sort()) !== JSON.stringify(keys) ||
          !keys.every(key => integer(p.industries[key])) ||
          keys.reduce((n, key) => n + p.industries[key], 0) !== p.total ||
          !Array.isArray(p.ties) || !Array.isArray(p.triangles)) {
        throw new Error(`Invalid jobs/industry area: ${p?.geoid}.`);
      }
      const maximum = Math.max(...keys.map(key => p.industries[key]));
      const winners = p.total ? keys.filter(key => p.industries[key] === maximum) : [];
      if (p.dominant !== (winners[0] ?? null) ||
          JSON.stringify(p.ties) !== JSON.stringify(winners.length > 1 ? winners : []) ||
          (p.total > 0) !== (p.triangles.length > 0) ||
          !p.triangles.every(t => Array.isArray(t) && t.length === 7 && t.every(Number.isFinite) &&
            t[0] > 0 && [1, 3, 5].every(i => Math.abs(t[i]) <= 180 && Math.abs(t[i + 1]) <= 85))) {
        throw new Error(`Invalid dominant industry or land sampler: ${p.geoid}.`);
      }
      seen.add(p.geoid);
      total += p.total;
    }
    if (total !== m.total_jobs) throw new Error("Jobs/industry totals do not reconcile.");
    return payload;
  }

  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let n = Math.imul(state ^ state >>> 15, 1 | state);
      n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
  }

  function withCategories(data, payload) {
    const m = payload?.metadata;
    const expected = {
      sectors: Array.from({ length: 20 }, (_, i) => `CNS${String(i + 1).padStart(2, "0")}`),
      age: ["CA01", "CA02", "CA03"], earnings: ["CE01", "CE02", "CE03"],
    };
    const sameKeys = (object, list) => object && typeof object === "object" &&
      JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...list].sort());
    if (m?.dataset !== "jobs_categories" || m.scale !== data.metadata.scale ||
        m.year !== data.metadata.year || m.job_type !== data.metadata.job_type ||
        m.total_jobs !== data.metadata.total_jobs || m.source_sha256 !== data.metadata.source_sha256 ||
        !sameKeys(m.classifications, Object.keys(expected)) ||
        !sameKeys(payload.areas, data.features.map(f => f.properties.geoid))) {
      throw new Error("Invalid jobs classification snapshot or area coverage.");
    }
    for (const [mode, fields] of Object.entries(expected)) {
      const definition = m.classifications[mode];
      if (!definition || typeof definition.label !== "string" || !definition.label ||
          definition.proportional !== (mode !== "sectors") || !sameKeys(definition.groups, fields) ||
          !fields.every(key => typeof definition.groups[key]?.label === "string" &&
            definition.groups[key].label && /^#[0-9a-f]{6}$/i.test(definition.groups[key].color))) {
        throw new Error(`Invalid jobs classification definition: ${mode}.`);
      }
    }
    const features = data.features.map(f => {
      const categories = payload.areas[f.properties.geoid];
      if (!sameKeys(categories, Object.keys(expected)) ||
          !Object.entries(expected).every(([mode, fields]) => sameKeys(categories[mode], fields) &&
            fields.every(key => integer(categories[mode][key])) &&
            fields.reduce((n, key) => n + categories[mode][key], 0) === f.properties.total)) {
        throw new Error(`Invalid jobs category counts: ${f.properties.geoid}.`);
      }
      return { ...f, properties: { ...f.properties, categories } };
    });
    return { ...data, metadata: { ...data.metadata, classifications: m.classifications }, features };
  }

  function classification(metadata, mode) {
    if (mode === "broad") return { label: "Four broad industry groups", proportional: false, groups: metadata.groups };
    const definition = metadata.classifications?.[mode];
    if (!definition) throw new Error(`Unknown jobs classification: ${mode}.`);
    return definition;
  }

  function breakdown(p, metadata, mode) {
    const definition = classification(metadata, mode);
    const counts = mode === "broad" ? p.industries : p.categories[mode];
    const maximum = Math.max(...Object.values(counts));
    const winners = p.total ? Object.keys(counts).sort().filter(key => counts[key] === maximum) : [];
    const groups = definition.proportional ? Object.keys(counts).sort() : winners.slice(0, 1);
    let end = 0;
    const bands = groups.filter(key => definition.proportional ? counts[key] > 0 : p.total > 0).map(key => {
      const total = definition.proportional ? counts[key] : p.total;
      const start = end;
      end += Math.ceil(total / metadata.jobs_per_dot);
      return { key, start, end, total, color: definition.groups[key].color };
    });
    return { definition, counts, winners, bands, count: end };
  }

  function sampleCapacity(p, metadata) {
    if (!p.categories) return Math.ceil(p.total / metadata.jobs_per_dot);
    return Math.max(...["broad", "sectors", "age", "earnings"].map(mode => breakdown(p, metadata, mode).count));
  }

  function drawOrder(count, seed) {
    const order = Uint32Array.from({ length: count }, (_, i) => i);
    const next = random(seed);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  function sample(p, metadata) {
    let seed = metadata.random_seed;
    for (const char of `${p.scale}:${p.geoid}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    const next = random(seed);
    const count = Math.ceil(p.total / metadata.jobs_per_dot);
    const points = new Float64Array(count * 2);
    const cumulative = [];
    let area = 0;
    for (const t of p.triangles) cumulative.push(area += t[0]);
    for (let i = 0; i < count; i++) {
      const target = next() * area;
      let low = 0, high = cumulative.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (target < cumulative[mid]) high = mid;
        else low = mid + 1;
      }
      const t = p.triangles[low];
      const u = Math.sqrt(next()), v = next();
      const lon = (1 - u) * t[1] + u * (1 - v) * t[3] + u * v * t[5];
      const lat = (1 - u) * t[2] + u * (1 - v) * t[4] + u * v * t[6];
      const sin = Math.sin(lat * Math.PI / 180);
      points[i * 2] = (lon + 180) / 360;
      points[i * 2 + 1] = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    }
    return points;
  }

  function dotRadius(zoom) {
    if (!Number.isFinite(zoom)) throw new Error("Invalid jobs/industry map zoom.");
    return Math.max(0.6, Math.min(1.4, 0.6 * 2 ** ((zoom - 12) / 2)));
  }

  const api = { normalize, withCategories, classification, breakdown, sampleCapacity, drawOrder, sample, dotRadius };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JobsIndustryModel = api;
})(globalThis);
