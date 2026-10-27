"use strict";

(function (root) {
  const binIds = Array.from({ length: 16 }, (_, index) => index + 2);
  const labels = [
    "Less than $10,000", "$10,000 to $14,999", "$15,000 to $19,999",
    "$20,000 to $24,999", "$25,000 to $29,999", "$30,000 to $34,999",
    "$35,000 to $39,999", "$40,000 to $44,999", "$45,000 to $49,999",
    "$50,000 to $59,999", "$60,000 to $74,999", "$75,000 to $99,999",
    "$100,000 to $124,999", "$125,000 to $149,999", "$150,000 to $199,999",
    "$200,000 or more",
  ];
  const countyBoroughs = { "005": "Bronx", "047": "Brooklyn", "061": "Manhattan", "081": "Queens", "085": "Staten Island" };
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const scales = {
    block_group: { label: "Block group", plural: "block groups", file: "block-groups.json" },
    tract: { label: "Census tract", plural: "census tracts", file: "geographies/tract.json" },
    neighborhood: { label: "Neighborhood (NTA)", plural: "neighborhoods (NTAs)", file: "geographies/neighborhood.json" },
    community_district: {
      label: "Community district (CDTA approximation)", plural: "district approximations (CDTAs)",
      file: "geographies/community_district.json",
    },
    borough: { label: "Borough", plural: "boroughs", file: "geographies/borough.json" },
  };

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
    if (payload?.schema_version !== 2 || payload.type !== "FeatureCollection" ||
        !Array.isArray(payload.features) || !payload.features.length ||
        payload.metadata?.feature_count !== payload.features.length ||
        payload.metadata.table !== "B19001" || payload.metadata.universe !== "Households" ||
        payload.metadata.geography !== "NYC block groups" || "districts" in payload) {
      throw new Error("Invalid NYC block-group household Income snapshot.");
    }
    const seen = new Set();
    for (const feature of payload.features) {
      const p = feature.properties;
      if (feature.type !== "Feature" || !polygon(feature.geometry) || !p ||
          !/^36(005|047|061|081|085)\d{7}$/.test(p.geoid) || seen.has(p.geoid) ||
          typeof p.name !== "string" || !p.name ||
          p.borough !== countyBoroughs[p.geoid.slice(2, 5)] ||
          p.tract !== p.geoid.slice(5, 11) || p.block_group !== p.geoid.slice(11) ||
          typeof p.gisjoin !== "string" || !/^G\d+$/.test(p.gisjoin) ||
          !count(p.total) || !count(p.total_moe) ||
          !Array.isArray(p.bins) || p.bins.length !== 16 || "districts" in p) {
        throw new Error(`Invalid Income block group: ${p?.geoid ?? "missing GEOID"}.`);
      }
      seen.add(p.geoid);
      for (const [index, bin] of p.bins.entries()) {
        if (bin.id !== binIds[index] || bin.label !== labels[index] || !count(bin.estimate) || !count(bin.moe)) {
          throw new Error(`Invalid income band or missing estimate/MOE: ${p.geoid}.`);
        }
      }
      if (p.bins.reduce((sum, bin) => sum + bin.estimate, 0) !== p.total) {
        throw new Error(`Income bands do not reconcile: ${p.geoid}.`);
      }
    }
    return payload;
  }

  function chartLayout(bins, plotHeight = 180) {
    if (!Array.isArray(bins) || bins.length !== 16 || !bins.every((bin) => count(bin.estimate)) ||
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

  function areaLayout(bins) {
    const layout = chartLayout(bins, 205);
    // Verified B19001 breakpoints. Closed bins sit at their midpoints; open tails sit at the chart ends.
    const breaks = [0, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000,
      50000, 60000, 75000, 100000, 125000, 150000, 200000];
    const points = bins.map((bin, i) => {
      const income = i === 0 ? 0 : i === bins.length - 1 ? 200000 : (breaks[i] + breaks[i + 1]) / 2;
      return { income, x: 76 + income / 200000 * 688, y: 242 - layout.heights[i] };
    });
    const line = points.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" ");
    return {
      ...layout, points, line,
      area: `${line} L${points.at(-1).x},242 L${points[0].x},242 Z`,
      incomeTicks: [0, 25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000],
    };
  }

  function normalizeAreas(payload, scale) {
    if (scale === "block_group") return normalize(payload);
    if (!Object.hasOwn(scales, scale) || payload?.schema_version !== 3 ||
        payload.type !== "FeatureCollection" || !Array.isArray(payload.features) || !payload.features.length ||
        payload.metadata?.scale !== scale || payload.metadata.feature_count !== payload.features.length ||
        payload.metadata.table !== "B19001" || payload.metadata.universe !== "Households" ||
        payload.metadata.geometry_crs !== "EPSG:4326" ||
        payload.metadata.moe_method !== "root_sum_squares_rounded_up" ||
        !count(payload.metadata.member_count) || payload.metadata.member_count === 0) {
      throw new Error(`Invalid ${scale} household Income snapshot.`);
    }
    const keys = {
      tract: /^36(005|047|061|081|085)\d{6}$/,
      neighborhood: /^(BX|BK|MN|QN|SI)\d{4}$/,
      community_district: /^(BX|BK|MN|QN|SI)\d{2}$/,
      borough: /^(005|047|061|081|085)$/,
    };
    const seen = new Set();
    const members = new Set();
    for (const feature of payload.features) {
      const p = feature.properties;
      if (feature.type !== "Feature" || !polygon(feature.geometry) || !p ||
          typeof p.geoid !== "string" || !keys[scale].test(p.geoid) || seen.has(p.geoid) || p.scale !== scale ||
          typeof p.name !== "string" || !p.name || typeof p.borough !== "string" || !p.borough ||
          !count(p.total) || !count(p.total_moe) || !Array.isArray(p.bins) || p.bins.length !== 16 ||
          !Array.isArray(p.members) || !p.members.length || p.member_count !== p.members.length) {
        throw new Error(`Invalid Income ${scale} area: ${p?.geoid ?? "missing ID"}.`);
      }
      seen.add(p.geoid);
      for (const member of p.members) {
        if (typeof member !== "string" || !/^36(005|047|061|081|085)\d{7}$/.test(member) ||
            members.has(member) || (scale === "tract" && member.slice(0, 11) !== p.geoid) ||
            (scale === "borough" && member.slice(2, 5) !== p.geoid)) {
          throw new Error(`Invalid or duplicated ${scale} membership: ${member}.`);
        }
        members.add(member);
      }
      for (const [i, bin] of p.bins.entries()) {
        if (bin.id !== binIds[i] || bin.label !== labels[i] || !count(bin.estimate) || !count(bin.moe)) {
          throw new Error(`Invalid ${scale} income band/MOE: ${p.geoid}.`);
        }
      }
      if (p.bins.reduce((sum, bin) => sum + bin.estimate, 0) !== p.total) {
        throw new Error(`Income bands do not reconcile: ${p.geoid}.`);
      }
    }
    if (members.size !== payload.metadata.member_count) throw new Error(`${scale} membership count mismatch.`);
    return payload;
  }

  const api = { normalize, normalizeAreas, chartLayout, areaLayout, labels, countyBoroughs, scales };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.IncomeModel = api;
})(globalThis);
