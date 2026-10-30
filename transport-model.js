"use strict";

(function (root) {
  const modes = ["Drove alone", "Carpooled", "Public transportation", "Walked",
    "Taxi / motorcycle / bicycle / other", "Worked from home"];
  const earnings = ["$1 to $9,999 or loss", "$10,000 to $14,999", "$15,000 to $24,999",
    "$25,000 to $34,999", "$35,000 to $49,999", "$50,000 to $64,999", "$65,000 to $74,999", "$75,000 or more"];
  const pieLabels = ["Car / truck / van / taxi", "Bus", "Subway", "Rail", "Ferry", "Motorcycle",
    "Bicycle", "Walked", "Other", "Worked from home"];
  const colors = ["#375a9e", "#81a6cf", "#de7b27", "#339777", "#9969ad", "#cb5061"];
  const pieColors = ["#375a9e", "#dea02e", "#de7b27", "#b65121", "#4b9da7", "#9969ad",
    "#7ab843", "#339777", "#8a8986", "#cb5061"];
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const vector = (values, size) => Array.isArray(values) && values.length === size && values.every(count);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const same = (a, b) => Array.isArray(a) && a.length === b.length && a.every((value, i) => value === b[i]);

  function normalize(payload, geography) {
    if (payload?.schema_version !== 1 || payload.metadata?.scale !== "tract" ||
        !same(payload.metadata.tables, ["B08119", "B08301"]) || payload.metadata.period !== "2020-2024" ||
        payload.metadata.universe !== "Workers 16 years and over with earnings" ||
        payload.metadata.pie_universe !== "Workers 16 years and over" ||
        payload.metadata.pie_moe_method !== "root_sum_squares_rounded_up" ||
        !same(payload.modes, modes) || !same(payload.earnings_labels, earnings) ||
        !same(payload.pie_labels, pieLabels) || !payload.tracts || Array.isArray(payload.tracts) ||
        payload.metadata.feature_count !== geography.features.length ||
        Object.keys(payload.tracts).length !== geography.features.length) {
      throw new Error("Invalid tract transportation snapshot.");
    }
    const seen = new Set();
    for (const { properties: p } of geography.features) {
      const t = payload.tracts[p.geoid];
      if (!/^36(005|047|061|081|085)\d{6}$/.test(p.geoid) || seen.has(p.geoid) || !t ||
          ![t.total, t.total_moe, t.pie_total, t.pie_total_moe].every(count) ||
          !vector(t.earnings_totals, 8) || !vector(t.earnings_moes, 8) ||
          !Array.isArray(t.series) || t.series.length !== 6 ||
          !Array.isArray(t.pie) || t.pie.length !== 10 ||
          !t.pie.every((item) => count(item.estimate) && count(item.moe)) ||
          sum(t.pie.map((item) => item.estimate)) !== t.pie_total ||
          sum(t.earnings_totals) !== t.total) throw new Error(`Invalid transportation tract: ${p.geoid}.`);
      seen.add(p.geoid);
      for (const series of t.series) {
        if (!vector(series.estimates, 8) || !vector(series.moes, 8) ||
            !count(series.total) || !count(series.moe) || sum(series.estimates) !== series.total) {
          throw new Error(`Invalid B08119 mode counts/MOEs: ${p.geoid}.`);
        }
      }
      if (t.earnings_totals.some((value, i) => sum(t.series.map((s) => s.estimates[i])) !== value)) {
        throw new Error(`B08119 earnings do not reconcile: ${p.geoid}.`);
      }
    }
    return {
      ...geography, metadata: { ...payload.metadata, dataset: "transport" },
      features: geography.features.map((feature) => ({
        ...feature, properties: {
          geoid: feature.properties.geoid, name: feature.properties.name, borough: feature.properties.borough,
          scale: "tract", dataset: "transport", ...payload.tracts[feature.properties.geoid],
        },
      })),
    };
  }

  function stackedLayout(tract) {
    if (!vector(tract.earnings_totals, 8) || tract.series.length !== 6 ||
        !tract.series.every((s) => vector(s.estimates, 8)) ||
        tract.earnings_totals.some((value, i) => sum(tract.series.map((s) => s.estimates[i])) !== value)) {
      throw new Error("Invalid stacked counts.");
    }
    const maximum = Math.max(1, ...tract.earnings_totals);
    const power = 10 ** Math.floor(Math.log10(maximum / 4));
    const step = Math.max(1, [1, 2, 5, 10].find((factor) => factor * power >= maximum / 4) * power);
    const ceiling = Math.ceil(maximum / step) * step;
    const cumulative = Array(8).fill(0);
    const xs = [0, 12500, 20000, 30000, 42500, 57500, 70000, 75000].map((value) => 64 + value / 75000 * 650);
    const y = (value) => 235 - value / ceiling * 195;
    const series = tract.series.map((s) => {
      const lower = [...cumulative];
      s.estimates.forEach((value, i) => { cumulative[i] += value; });
      const upper = [...cumulative];
      const points = xs.map((x, i) => ({ x, y: y(upper[i]), lower: lower[i], upper: upper[i] }));
      const path = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") +
        xs.map((x, i) => [x, y(lower[i])]).reverse().map(([x, py]) => ` L${x},${py}`).join("") + " Z";
      return { points, path };
    });
    return { ceiling, series, xs, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => i * step) };
  }

  function pieLayout(items) {
    if (!Array.isArray(items) || !items.length || !items.every((item) => count(item.estimate))) {
      throw new Error("Invalid pie counts.");
    }
    const total = sum(items.map((item) => item.estimate));
    let start = -Math.PI / 2;
    return items.map((item) => {
      const share = total ? item.estimate / total : 0;
      const end = start + share * 2 * Math.PI;
      const point = (angle) => `${120 + 100 * Math.cos(angle)},${120 + 100 * Math.sin(angle)}`;
      const path = share === 0 ? "" : share === 1
        ? "M120,20 A100,100 0 1,1 120,220 A100,100 0 1,1 120,20 Z"
        : `M120,120 L${point(start)} A100,100 0 ${share > 0.5 ? 1 : 0},1 ${point(end)} Z`;
      start = end;
      return { share, path };
    });
  }

  const api = { normalize, stackedLayout, pieLayout, modes, earnings, pieLabels, colors, pieColors };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TransportModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
