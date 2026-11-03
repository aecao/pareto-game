"use strict";

(function (root) {
  const groups = ["renter", "mixed", "owner"];
  const buckets = ["1", "2", "3-4", "5-9", "10-19", "20-49", "50+"];
  const sources = ["block_group", "tract", "pilot"];
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const hex = value => /^#[0-9a-f]{6}$/i.test(value);

  function decodeRing(flat, scale) {
    if (!Array.isArray(flat) || flat.length < 8 || flat.length % 2 || !flat.every(Number.isSafeInteger)) {
      throw new Error("Invalid encoded lot ring.");
    }
    let x = flat[0];
    let y = flat[1];
    const ring = [[x / scale, y / scale]];
    for (let i = 2; i < flat.length; i += 2) {
      x += flat[i];
      y += flat[i + 1];
      ring.push([x / scale, y / scale]);
    }
    if (x !== flat[0] || y !== flat[1]) throw new Error("Encoded lot ring is not closed.");
    return ring;
  }

  function tenureGroup(share, breaks) {
    if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error("Invalid owner share.");
    return share < breaks[0] ? "renter" : share > breaks[1] ? "owner" : "mixed";
  }

  function unitClass(units, breaks) {
    if (!Number.isSafeInteger(units) || units < 1) throw new Error("Invalid residential units.");
    return breaks.filter(limit => units >= limit).length;
  }

  function normalize(payload) {
    const m = payload?.metadata;
    if (payload?.schema_version !== 1 || m?.dataset !== "housing_mode" || m.table !== "B25032" ||
        m.period !== "2020-2024" || m.pluto_version !== "26v2" || !Number.isSafeInteger(m.coordinate_scale) ||
        !Array.isArray(m.owner_share_breaks) || m.owner_share_breaks.length !== 2 ||
        !(m.owner_share_breaks[0] > 0 && m.owner_share_breaks[0] < m.owner_share_breaks[1] && m.owner_share_breaks[1] < 1) ||
        !Array.isArray(m.unit_breaks) || m.unit_breaks.length !== 4 ||
        !m.unit_breaks.every((v, i) => Number.isSafeInteger(v) && v > (i ? m.unit_breaks[i - 1] : 1)) ||
        !Array.isArray(m.unit_labels) || m.unit_labels.length !== 5 ||
        !groups.every(g => Array.isArray(m.colors?.[g]) && m.colors[g].length === 5 && m.colors[g].every(hex)) ||
        !Array.isArray(payload.cells) || payload.cells.length !== m.cell_count ||
        !Array.isArray(payload.lots) || !payload.lots.length || payload.lots.length !== m.feature_count) {
      throw new Error("Invalid housing-by-mode snapshot.");
    }
    const cells = payload.cells.map(cell => {
      const [geoid, bucket, source, owner, renter] = Array.isArray(cell) ? cell : [];
      if (typeof geoid !== "string" || !/^36(005|047|061|081|085)\d{7}$/.test(geoid) || !buckets.includes(bucket) || !sources.includes(source) ||
          !count(owner) || !count(renter) || owner + renter === 0) {
        throw new Error("Invalid ACS tenure cell.");
      }
      return { geoid, bucket, share_source: source, acs_owner: owner, acs_renter: renter, owner_share: owner / (owner + renter) };
    });
    const seen = new Set();
    let units = 0;
    const features = payload.lots.map(row => {
      const [bbl, address, bldgClass, landUse, lotUnits, buildings, yearBuilt, condo, cellIndex, polygons] = Array.isArray(row) ? row : [];
      const cell = cells[cellIndex];
      if (typeof bbl !== "string" || !/^[1-5]\d{9}$/.test(bbl) || seen.has(bbl) || typeof address !== "string" || typeof bldgClass !== "string" ||
          !["01", "02", "03", "04"].includes(landUse) || !Number.isSafeInteger(lotUnits) || lotUnits < 1 ||
          !count(buildings) || !(yearBuilt === null || (Number.isSafeInteger(yearBuilt) && yearBuilt > 1600)) ||
          ![0, 1].includes(condo) || !cell || !Array.isArray(polygons) || !polygons.length) {
        throw new Error(`Invalid housing lot: ${bbl}.`);
      }
      seen.add(bbl);
      units += lotUnits;
      const coordinates = polygons.map(rings => {
        if (!Array.isArray(rings) || !rings.length) throw new Error(`Invalid housing lot polygon: ${bbl}.`);
        return rings.map(ring => decodeRing(ring, m.coordinate_scale));
      });
      return { type: "Feature", geometry: { type: "MultiPolygon", coordinates }, properties: {
        dataset: "housing_mode", geoid: bbl, bbl, name: address || `BBL ${bbl}`, address, bldg_class: bldgClass,
        land_use: landUse, units: lotUnits, buildings, year_built: yearBuilt, condo: condo === 1, ...cell,
        tenure_group: tenureGroup(cell.owner_share, m.owner_share_breaks),
        unit_class: unitClass(lotUnits, m.unit_breaks),
      } };
    });
    if (units !== m.total_units) throw new Error("Housing units do not reconcile.");
    return { type: "FeatureCollection", schema_version: 1, metadata: m, features };
  }

  function color(properties, metadata) {
    const palette = metadata.colors[properties.tenure_group];
    if (!palette || !Number.isSafeInteger(properties.unit_class) || !palette[properties.unit_class]) {
      throw new Error("Invalid housing color class.");
    }
    return palette[properties.unit_class];
  }

  const api = { normalize, color, decodeRing, tenureGroup, unitClass, groups };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HousingModeModel = api;
})(globalThis);
