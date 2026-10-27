"use strict";

(function (root) {
  const binIds = [2, 4, 5, 6, 7, 8, 9, 10, 11];
  const labels = [
    "No income", "$1 to $9,999 or loss", "$10,000 to $14,999",
    "$15,000 to $24,999", "$25,000 to $34,999", "$35,000 to $49,999",
    "$50,000 to $64,999", "$65,000 to $74,999", "$75,000 or more",
  ];
  const districtNames = { 106: "Manhattan CD6", 108: "Manhattan CD8", 401: "Queens CD1", 402: "Queens CD2" };
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const share = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

  function polygon(geometry) {
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return false;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return Array.isArray(polygons) && polygons.length > 0 && polygons.every((rings) =>
      Array.isArray(rings) && rings.length > 0 && rings.every((ring) =>
        Array.isArray(ring) && ring.length >= 4 && ring.every((point) =>
          Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) &&
          Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90) &&
        ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]));
  }

  function normalize(payload) {
    if (payload?.schema_version !== 1 || payload.type !== "FeatureCollection" ||
        !Array.isArray(payload.features) || !payload.features.length ||
        payload.metadata?.tract_count !== payload.features.length ||
        payload.metadata.area_threshold !== 0.01 || payload.metadata.partial_overlap_threshold !== 0.99) {
      throw new Error("Invalid Income snapshot or selection policy.");
    }
    const seen = new Set();
    for (const feature of payload.features) {
      const p = feature.properties;
      if (feature.type !== "Feature" || !polygon(feature.geometry) || !p ||
          !/^36(061|081)\d{6}$/.test(p.geoid) || seen.has(p.geoid) ||
          typeof p.name !== "string" || !p.name ||
          p.borough !== (p.geoid.slice(2, 5) === "061" ? "Manhattan" : "Queens") ||
          !count(p.total) || !count(p.total_moe) || !count(p.with_income) || !count(p.with_income_moe) ||
          !Array.isArray(p.bins) || p.bins.length !== 9 ||
          !Array.isArray(p.districts) || !p.districts.length ||
          new Set(p.districts).size !== p.districts.length || !share(p.overlap_share) ||
          p.partial_overlap !== (p.overlap_share < payload.metadata.partial_overlap_threshold)) {
        throw new Error(`Invalid Income tract: ${p?.geoid ?? "missing GEOID"}.`);
      }
      seen.add(p.geoid);
      for (const [index, bin] of p.bins.entries()) {
        if (bin.id !== binIds[index] || bin.label !== labels[index] || !count(bin.estimate) || !count(bin.moe)) {
          throw new Error(`Invalid income band or missing estimate/MOE: ${p.geoid}.`);
        }
      }
      if (p.bins.reduce((sum, bin) => sum + bin.estimate, 0) !== p.total ||
          p.bins.slice(1).reduce((sum, bin) => sum + bin.estimate, 0) !== p.with_income) {
        throw new Error(`Income bands do not reconcile: ${p.geoid}.`);
      }
      const expected = [];
      for (const code of Object.keys(districtNames)) {
        const value = p.district_shares?.[code];
        const sameBorough = (p.borough === "Manhattan") === code.startsWith("1");
        if (!share(value) || (!sameBorough && value !== 0) || value > p.overlap_share + 1e-8) {
          throw new Error(`Invalid district overlap: ${p.geoid}.`);
        }
        if (value >= payload.metadata.area_threshold) expected.push(code);
      }
      if (expected.join(",") !== p.districts.join(",")) throw new Error(`Invalid tract membership: ${p.geoid}.`);
    }
    const districts = payload.districts;
    if (districts?.type !== "FeatureCollection" || !Array.isArray(districts.features) ||
        districts.features.length !== 4 ||
        new Set(districts.features.map((feature) => feature.properties?.boro_cd)).size !== 4 ||
        !districts.features.every((feature) =>
          Object.hasOwn(districtNames, feature.properties?.boro_cd) && polygon(feature.geometry))) {
      throw new Error("Income district outlines are missing or invalid.");
    }
    return payload;
  }

  function chartLayout(bins, plotHeight = 180) {
    if (!Array.isArray(bins) || bins.length !== 9 || !bins.every((bin) => count(bin.estimate)) ||
        !Number.isFinite(plotHeight) || plotHeight <= 0) throw new Error("Invalid chart counts or height.");
    const maximum = Math.max(1, ...bins.map((bin) => bin.estimate));
    const power = 10 ** Math.floor(Math.log10(maximum / 4));
    const step = Math.max(1, [1, 2, 5, 10].find((factor) => factor * power >= maximum / 4) * power);
    const ceiling = Math.ceil(maximum / step) * step;
    return {
      ceiling, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, index) => index * step),
      heights: bins.map((bin) => bin.estimate / ceiling * plotHeight),
    };
  }

  const api = { normalize, chartLayout, labels, districtNames };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.IncomeModel = api;
})(globalThis);
