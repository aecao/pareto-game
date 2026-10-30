"use strict";

(function (root) {
  const income = typeof module !== "undefined" && module.exports ? require("./income-model.js") : root.IncomeModel;
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const scales = ["block_group", "tract", "neighborhood"];

  function normalize(payload, geography, scale) {
    const m = payload?.metadata;
    if (payload?.schema_version !== 1 || m?.dataset !== "population" || !scales.includes(scale) ||
        m.scale !== scale || m.table !== "B01003" || m.period !== "2020-2024" ||
        m.universe !== "Total population" || m.density_units !== "people per square mile of land" ||
        m.moe_method !== (scale === "block_group" ? "original" : "root_sum_squares_rounded_up") ||
        !integer(m.total_population) || !Array.isArray(m.breaks) || !m.breaks.length ||
        !m.breaks.every((v, i) => Number.isFinite(v) && v > 0 && (!i || v > m.breaks[i - 1])) ||
        !Array.isArray(m.colors) || m.colors.length !== m.breaks.length + 1 ||
        ![...m.colors, m.no_land_color].every(v => /^#[0-9a-f]{6}$/i.test(v)) ||
        geography?.type !== "FeatureCollection" || !Array.isArray(geography.features) ||
        !geography.features.length || geography.features.length !== m.feature_count ||
        !payload.areas || Object.keys(payload.areas).length !== m.feature_count) {
      throw new Error("Invalid population density snapshot.");
    }
    const seen = new Set();
    let total = 0;
    const features = geography.features.map(f => {
      const p = f?.properties;
      const validKey = scale === "block_group" ? /^36(005|047|061|081|085)\d{7}$/
        : scale === "tract" ? /^36(005|047|061|081|085)\d{6}$/ : /^(?:(BX|BK|MN|QN|SI)\d{4}|MN0801-RI)$/;
      const v = payload.areas[p?.geoid];
      if (f?.type !== "Feature" || !income.polygon(f.geometry) || !p ||
          !validKey.test(p.geoid) || seen.has(p.geoid) || typeof p.name !== "string" || !p.name ||
          typeof p.borough !== "string" || !p.borough || !v || !integer(v.total) || !integer(v.total_moe) ||
          !integer(v.member_count) || !v.member_count || (scale === "block_group" && v.member_count !== 1) ||
          !Number.isFinite(v.land_sqft) || v.land_sqft < 0 ||
          !Number.isFinite(v.land_sq_miles) || v.land_sq_miles < 0 ||
          Math.abs(v.land_sqft - v.land_sq_miles * (5280 * 0.3048 * 3937 / 1200) ** 2) >
            Math.max(0.01, v.land_sqft * 1e-10) ||
          (v.land_sq_miles === 0 ? (v.density !== null || v.total !== 0) :
            (!Number.isFinite(v.density) || v.density < 0 ||
             Math.abs(v.density - v.total / v.land_sq_miles) > Math.max(1e-8, v.density * 1e-10)))) {
        throw new Error(`Invalid population density area: ${p?.geoid}.`);
      }
      seen.add(p.geoid);
      total += v.total;
      return { type: "Feature", geometry: f.geometry, properties: {
        geoid: p.geoid, name: p.name, borough: p.borough, tract: p.tract,
        block_group: p.block_group, custom_neighborhood: Boolean(p.custom_neighborhood),
        ...v, scale, dataset: "population",
      } };
    });
    if (total !== m.total_population) throw new Error("Population totals do not reconcile.");
    return { type: "FeatureCollection", schema_version: 1, metadata: m, features };
  }

  function color(density, metadata) {
    if (density === null) return metadata.no_land_color;
    if (!Number.isFinite(density) || density < 0) throw new Error("Invalid population density.");
    const index = metadata.breaks.findIndex(limit => density < limit);
    return metadata.colors[index < 0 ? metadata.colors.length - 1 : index];
  }

  const api = { normalize, color };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PopulationModel = api;
})(globalThis);
