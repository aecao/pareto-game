"use strict";

(function (root) {
  const typeKeys = ["nycha", "hud", "mitchell_lama", "lihtc", "hpd", "tax_only"];
  const hex = value => /^#[0-9a-f]{6}$/i.test(value);
  const optionalInt = value => value === null || Number.isSafeInteger(value);
  // Some source end dates are far-future (e.g. 2110-01-01); keep them but still reject garbage.
  const date = value => value === null || (Number.isSafeInteger(value) && value >= 18000101 && value <= 21991231);

  function normalize(payload) {
    const m = payload?.metadata;
    const r = m?.radius;
    if (payload?.schema_version !== 1 || m?.dataset !== "public_housing" || !Number.isSafeInteger(m.coordinate_scale) ||
        !Array.isArray(m.types) || m.types.map(t => t.key).join() !== typeKeys.join() ||
        !m.types.every(t => typeof t.label === "string" && hex(t.color)) ||
        !Array.isArray(m.program_codes) || !m.program_codes.every(c => typeof c === "string") ||
        !(r?.min_px > 0 && r.max_px > r.min_px && r.ref_units > 0) ||
        !Array.isArray(payload.properties) || !payload.properties.length || payload.properties.length !== m.feature_count) {
      throw new Error("Invalid public housing snapshot.");
    }
    const seen = new Set();
    let units = 0;
    let unknown = 0;
    const features = payload.properties.map(row => {
      const [bbl, address, cd, resUnits, yearBuilt, buildings, owner, kind, mask, x, y, programs] = Array.isArray(row) ? row : [];
      if (typeof bbl !== "string" || !/^[1-5]\d{9}$/.test(bbl) || seen.has(bbl) || typeof address !== "string" ||
          !Number.isSafeInteger(cd) || !optionalInt(resUnits) || (resUnits !== null && resUnits < 0) ||
          !optionalInt(yearBuilt) || !optionalInt(buildings) || typeof owner !== "string" ||
          !Number.isSafeInteger(kind) || !m.types[kind] || !Number.isSafeInteger(mask) || !(mask >> kind & 1) ||
          mask >= 1 << typeKeys.length || (mask & ((1 << kind) - 1)) !== 0 ||
          !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Array.isArray(programs) ||
          !programs.every(p => Array.isArray(p) && p.length === 3 && m.program_codes[p[0]] !== undefined && date(p[1]) && date(p[2]))) {
        throw new Error(`Invalid public housing property: ${bbl}.`);
      }
      const lon = x / m.coordinate_scale;
      const lat = y / m.coordinate_scale;
      if (!(lon > -74.3 && lon < -73.6 && lat > 40.4 && lat < 41)) throw new Error(`Property outside NYC: ${bbl}.`);
      seen.add(bbl);
      if (resUnits === null) unknown += 1; else units += resUnits;
      return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {
        dataset: "public_housing", geoid: bbl, bbl, name: address || `BBL ${bbl}`, address, cd, units: resUnits,
        year_built: yearBuilt, buildings, owner, primary_type: typeKeys[kind],
        types: typeKeys.filter((_, i) => mask >> i & 1),
        programs: programs.map(([code, start, end]) => ({ code: m.program_codes[code], start, end })),
      } };
    });
    if (units !== m.total_units || unknown !== m.unknown_unit_count) throw new Error("Public housing units do not reconcile.");
    return { type: "FeatureCollection", schema_version: 1, metadata: m, features };
  }

  function radius(units, metadata) {
    const { min_px: low, max_px: high, ref_units: ref } = metadata.radius;
    if (units === null) return low;
    return low + (high - low) * Math.sqrt(Math.min(units, ref) / ref);
  }

  function color(properties, metadata) {
    const type = metadata.types.find(t => t.key === properties.primary_type);
    if (!type) throw new Error("Unknown public housing type.");
    return type.color;
  }

  function matches(properties, filter) {
    if (filter === "all") return true;
    if (!typeKeys.includes(filter)) throw new Error(`Unknown public housing filter ${filter}.`);
    return properties.types.includes(filter);
  }

  function formatDate(value) {
    if (value === null) return null;
    const text = String(value);
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

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

  function lotUnitClass(units, breaks) {
    if (units === null) return 0;
    if (!Number.isSafeInteger(units) || units < 0) throw new Error("Invalid lot units.");
    return breaks.filter(limit => units >= limit).length;
  }

  // Aggregates properties to PLUTO lots; every property must belong to exactly one lot.
  function normalizeLots(payload, propertyData) {
    const m = payload?.metadata;
    const pm = propertyData?.metadata;
    const breaks = m?.unit_breaks;
    if (payload?.schema_version !== 1 || m?.dataset !== "public_housing_lots" || pm?.dataset !== "public_housing" ||
        !Number.isSafeInteger(m.coordinate_scale) || m.type_keys?.join() !== typeKeys.join() ||
        !Array.isArray(breaks) || !breaks.length || !breaks.every((v, i) => Number.isSafeInteger(v) && v > (i ? breaks[i - 1] : 0)) ||
        !typeKeys.every(k => Array.isArray(m.colors?.[k]) && m.colors[k].length === breaks.length + 1 && m.colors[k].every(hex)) ||
        !Array.isArray(payload.lots) || payload.lots.length !== m.feature_count || m.property_count !== propertyData.features.length) {
      throw new Error("Invalid public housing lot snapshot.");
    }
    const byBbl = new Map(propertyData.features.map(f => [f.properties.bbl, f]));
    const assigned = new Set();
    const lotsSeen = new Set();
    let units = 0;
    let spatial = 0;
    const features = payload.lots.map(row => {
      const [bbl, kind, mask, lotUnits, unknown, spatialMatches, members, geometry] = Array.isArray(row) ? row : [];
      if (typeof bbl !== "string" || !/^[1-5]\d{9}$/.test(bbl) || lotsSeen.has(bbl) ||
          !Number.isSafeInteger(kind) || !typeKeys[kind] || !Number.isSafeInteger(mask) || !(mask >> kind & 1) ||
          mask >= 1 << typeKeys.length || (mask & ((1 << kind) - 1)) !== 0 || !optionalInt(lotUnits) ||
          !Number.isSafeInteger(unknown) || !Number.isSafeInteger(spatialMatches) || spatialMatches < 0 ||
          !Array.isArray(members) || !members.length || spatialMatches > members.length ||
          !Array.isArray(geometry) || !geometry.length) {
        throw new Error(`Invalid public housing lot: ${bbl}.`);
      }
      lotsSeen.add(bbl);
      const properties = members.map(member => {
        const feature = byBbl.get(member);
        if (!feature || assigned.has(member)) throw new Error(`Lot ${bbl} has an unknown or repeated property ${member}.`);
        assigned.add(member);
        return feature.properties;
      });
      const known = properties.filter(p => p.units !== null);
      const memberMask = properties.reduce((n, p) => n | p.types.reduce((b, k) => b | 1 << typeKeys.indexOf(k), 0), 0);
      if (memberMask !== mask || unknown !== properties.length - known.length ||
          lotUnits !== (known.length ? known.reduce((n, p) => n + p.units, 0) : null) ||
          Math.min(...properties.map(p => typeKeys.indexOf(p.primary_type))) !== kind) {
        throw new Error(`Lot ${bbl} does not reconcile with its properties.`);
      }
      units += lotUnits ?? 0;
      spatial += spatialMatches;
      return { type: "Feature", geometry: { type: "MultiPolygon",
        coordinates: geometry.map(polygon => polygon.map(ring => decodeRing(ring, m.coordinate_scale))) }, properties: {
        dataset: "public_housing_lots", geoid: bbl, bbl, primary_type: typeKeys[kind],
        types: typeKeys.filter((_, i) => mask >> i & 1), units: lotUnits, unknown_units: unknown,
        spatial_matches: spatialMatches, members: properties, unit_class: lotUnitClass(lotUnits, breaks),
      } };
    });
    if (assigned.size !== byBbl.size || units !== m.total_units || spatial !== m.spatial_match_count) {
      throw new Error("Public housing lots do not reconcile.");
    }
    return { type: "FeatureCollection", schema_version: 1,
      metadata: { ...m, types: pm.types, program_codes: pm.program_codes, property_citation: pm.citation }, features };
  }

  function lotColor(properties, metadata) {
    const color = metadata.colors[properties.primary_type]?.[properties.unit_class];
    if (!color) throw new Error("Invalid public housing lot color.");
    return color;
  }

  const api = { normalize, normalizeLots, radius, color, lotColor, lotUnitClass, matches, formatDate, typeKeys };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PublicHousingModel = api;
})(globalThis);
