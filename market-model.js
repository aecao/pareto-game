(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MarketModel = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function check(condition, message) {
    if (!condition) throw new Error(`Invalid market data: ${message}`);
  }
  function monthIndex(month) {
    check(typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month), "month must be YYYY-MM");
    return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
  }
  function validate(data) {
    check(data?.schema_version === 1, "unsupported schema");
    check(Array.isArray(data.geographies) && data.geographies.length > 0, "geographies");
    const geoIds = new Set();
    const geoKeys = new Set();
    for (const g of data.geographies) {
      check(typeof g.id === "string" && !geoIds.has(g.id), "duplicate geography ID");
      check(typeof g.name === "string" && g.name.length > 0
        && ["city", "borough", "neighborhood"].includes(g.type), "geography label");
      check(g.type === "city" ? g.borough === null : typeof g.borough === "string", "geography borough");
      const key = JSON.stringify([g.name, g.borough, g.type]);
      check(!geoKeys.has(key), "duplicate geography labels");
      geoIds.add(g.id);
      geoKeys.add(key);
    }
    check(Array.isArray(data.metrics) && data.metrics.length === 12, "metric scope");
    const metricIds = new Set();
    let cells = 0, missing = 0, flagged = 0;
    for (const m of data.metrics) {
      check(typeof m.id === "string" && !metricIds.has(m.id), "duplicate metric");
      metricIds.add(m.id);
      check(typeof m.label === "string" && typeof m.description === "string"
        && m.units_status === "native_unverified", "metric metadata");
      check(Array.isArray(m.months) && m.months.length > 0, "empty calendar");
      const calendar = m.months.map(monthIndex);
      check(calendar.every((n, i) => i === 0 || n === calendar[i - 1] + 1), "nonconsecutive calendar");
      check(Array.isArray(m.series) && m.series.length > 0, "empty series");
      const seen = new Set();
      for (const series of m.series) {
        check(geoIds.has(series.geography) && !seen.has(series.geography), "duplicate/unknown series geography");
        seen.add(series.geography);
        check(Array.isArray(series.values) && series.values.length === calendar.length, "series length");
        check(series.values.every((v) => v === null || (typeof v === "number" && Number.isFinite(v))), "nonnumeric value");
        check(Array.isArray(series.source_rows) && series.source_rows.length === calendar.length
          && series.source_rows.every((v) => Number.isInteger(v) && v >= 0), "source rows");
        check(Array.isArray(series.flagged_indices)
          && new Set(series.flagged_indices).size === series.flagged_indices.length
          && series.flagged_indices.every((i) => Number.isInteger(i) && i >= 0
            && i < calendar.length && series.values[i] !== null), "anomaly indices");
        const expectedFlags = series.values.flatMap((v, i) => {
          if (v === null) return [];
          const suspect = v < 0
            || (["discountShare_All", "priceCutShare_All"].includes(m.id) && v > 1)
            || (["recordedSalesVolume_All", "rentalInventory_All", "totalInventory_All"].includes(m.id) && !Number.isInteger(v))
            || (m.id === "saleListRatio_All" && v <= 0);
          return suspect ? [i] : [];
        });
        check(JSON.stringify(series.flagged_indices) === JSON.stringify(expectedFlags), "anomaly flags disagree with values");
        cells += series.values.length;
        missing += series.values.filter((v) => v === null).length;
        flagged += series.flagged_indices.length;
      }
    }
    check(data.provenance?.publisher === "StreetEasy" && data.provenance.cells === cells
      && data.provenance.missing_cells === missing && data.provenance.anomalies === flagged, "provenance counts");
    const hashes = data.provenance.source_sha256;
    check(hashes && Object.keys(hashes).length === 4
      && Object.values(hashes).every((s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s)), "source hashes");
    check(metricIds.has(data.defaults?.metric), "default metric");
    const selected = data.metrics.find((m) => m.id === data.defaults.metric);
    check(selected.series.some((s) => s.geography === data.defaults.geography), "default geography");
    const defaultGeo = data.geographies.find((g) => g.id === data.defaults.geography);
    check(defaultGeo.type === "borough" && defaultGeo.name === "Queens", "default must be Queens borough");
    return data;
  }
  function select(data, metricId, geographyId, start, end) {
    const metric = data.metrics.find((m) => m.id === metricId);
    check(metric, "unknown metric");
    const series = metric.series.find((s) => s.geography === geographyId);
    check(series, "geography unavailable for this metric");
    const first = monthIndex(start), last = monthIndex(end);
    check(first <= last, "start month must not follow end month");
    check(first >= monthIndex(metric.months[0]) && last <= monthIndex(metric.months.at(-1)), "range outside source history");
    const flags = new Set(series.flagged_indices);
    const rows = metric.months.map((month, i) => ({
      month, value: series.values[i], flagged: flags.has(i), sourceRow: series.source_rows[i],
    })).filter((r) => r.month >= start && r.month <= end);
    const available = rows.filter((r) => r.value !== null);
    return {
      rows, metric, geography: data.geographies.find((g) => g.id === geographyId),
      latest: available.at(-1) ?? null, missing: rows.length - available.length,
      flagged: rows.filter((r) => r.flagged).length,
    };
  }
  function segments(rows) {
    const result = [];
    let current = [];
    for (const row of rows) {
      if (row.value === null) {
        if (current.length) result.push(current);
        current = [];
      } else current.push(row);
    }
    if (current.length) result.push(current);
    return result;
  }
  return { validate, monthIndex, select, segments };
}));
