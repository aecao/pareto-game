"use strict";

function transportLegend(parent, labels, colors) {
  const legend = incomeNode("div", null, parent, { class: "income-chart-legend" });
  labels.forEach((label, i) => {
    const item = incomeNode("span", null, legend);
    incomeNode("span", null, item, { class: "transport-swatch", style: `background:${colors[i]}`, "aria-hidden": "true" });
    incomeNode("span", label, item);
  });
}

function transportPopup(feature) {
  const p = feature.properties;
  const wrapper = incomeNode("div", null, null, { class: "income-popup-content transport-popup-content" });
  incomeNode("h2", p.name, wrapper);
  incomeNode("p", `Census tract ${p.geoid} | 2020-2024 ACS five-year estimates`, wrapper);
  const columns = incomeNode("div", null, wrapper, { class: "transport-charts" });
  const stack = incomeNode("section", null, columns, { class: "income-chart", "aria-label": "Transportation by earnings" });
  incomeNode("h3", "Transportation by individual earnings (B08119)", stack);
  incomeNode("p", `${incomeNumber(p.total)} workers with earnings +/- ${incomeNumber(p.total_moe)} (90% MOE)`, stack);
  if (!p.total) incomeNode("p", "No estimated workers with earnings. Reported zeros are not missing data.", stack);
  const svg = incomeNode("svg", null, stack, {
    viewBox: "0 0 750 310", role: "img", "aria-label": `Stacked worker counts by earnings and transportation, ${p.name}`,
  });
  incomeNode("title", "Worker counts in each source earnings band, stacked by six published transportation modes", svg);
  const layout = TransportModel.stackedLayout(p);
  incomeNode("text", "Workers", svg, { x: 64, y: 22, class: "income-axis-title" });
  for (const tick of layout.ticks) {
    const y = 235 - tick / layout.ceiling * 195;
    incomeNode("line", null, svg, { x1: 64, x2: 714, y1: y, y2: y, class: "income-grid-line" });
    incomeNode("text", incomeNumber(tick), svg, { x: 56, y: y + 4, "text-anchor": "end" });
  }
  layout.series.forEach((series, mode) => {
    incomeNode("path", null, svg, { d: series.path, fill: TransportModel.colors[mode], "fill-opacity": 0.8,
      stroke: TransportModel.colors[mode], "stroke-width": 1, class: "transport-stack" });
    series.points.forEach((point, i) => {
      const label = `${TransportModel.modes[mode]}, ${TransportModel.earnings[i]}: ${incomeNumber(p.series[mode].estimates[i])} workers +/- ${incomeNumber(p.series[mode].moes[i])} (90% MOE)`;
      const dot = incomeNode("circle", null, svg, { cx: point.x, cy: point.y, r: 3, fill: TransportModel.colors[mode],
        tabindex: "0", "aria-label": label });
      incomeNode("title", label, dot);
    });
  });
  ["Loss / <$10k", "$12.5k", "$20k", "$30k", "$42.5k", "$57.5k", "$70k", "$75k+"].forEach((label, i) => {
    incomeNode("text", label, svg, { x: layout.xs[i], y: i % 2 ? 270 : 253, "text-anchor": "middle" });
  });
  incomeNode("text", "Annual individual earnings (2024 dollars)", svg, {
    x: 389, y: 300, "text-anchor": "middle", class: "income-axis-title",
  });
  transportLegend(stack, TransportModel.modes, TransportModel.colors);
  incomeNode("p", "Source-band counts, not a continuous density. Closed bands sit at midpoints; loss / under $10k and $75k+ sit at the ends. Connecting bands does not infer exact earnings. These are individual earnings, not household income.", stack);
  const pie = incomeNode("section", null, columns, { class: "transport-pie", "aria-label": "Means of transportation to work" });
  incomeNode("h3", "All commute modes (B08301)", pie);
  incomeNode("p", `${incomeNumber(p.pie_total)} workers age 16+ +/- ${incomeNumber(p.pie_total_moe)} (approximate 90% MOE)`, pie);
  const pieSvg = incomeNode("svg", null, pie, {
    viewBox: "0 0 240 240", role: "img", "aria-label": `B08301 transportation shares, ${p.name}`,
  });
  if (p.pie_total === 0) {
    incomeNode("circle", null, pieSvg, { cx: 120, cy: 120, r: 100, fill: "#bdbdbd" });
    incomeNode("p", "No estimated workers; shares are unavailable (not missing source data).", pie);
  }
  TransportModel.pieLayout(p.pie).forEach((slice, i) => {
    if (!slice.path) return;
    const label = `${TransportModel.pieLabels[i]}: ${incomeNumber(p.pie[i].estimate)} workers (${(slice.share * 100).toFixed(1)}%), +/- ${incomeNumber(p.pie[i].moe)} (approximate 90% MOE)`;
    const wedge = incomeNode("path", null, pieSvg, { d: slice.path, fill: TransportModel.pieColors[i],
      stroke: "#fff", "stroke-width": 1, tabindex: "0", "aria-label": label });
    incomeNode("title", label, wedge);
  });
  transportLegend(pie, TransportModel.pieLabels, TransportModel.pieColors);
  incomeNode("p", "All workers age 16+, not just those with earnings. Whole-block-group sums for this tract; this total need not equal B08119. Bus, subway, rail and ferry detail is not available by earnings.", pie);
  const details = incomeNode("details", null, wrapper, { class: "income-data-details" });
  incomeNode("summary", "Counts, percentages & 90% margins of error", details);
  incomeNode("p", "B08119: original published tract estimates and MOEs. B08301: IPUMS NHGIS block groups summed within each tract; approximate MOEs are root-sum-of-squares of all source cells, rounded up once. Percentages use the stated table's total; no percentage MOEs are inferred. ACS estimates are uncertain, not exact counts.", details);
  const table = incomeNode("table", null, details, { class: "income-popup-table" });
  incomeNode("caption", "B08119 workers with earnings; percentages of tract B08119 total", table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  ["Mode / earnings band", "Workers", "Share of total", "+/- MOE"].forEach((label) => incomeNode("th", label, head, { scope: "col" }));
  const body = incomeNode("tbody", null, table);
  const addRow = (label, estimate, moe, total) => {
    const row = incomeNode("tr", null, body);
    incomeNode("th", label, row, { scope: "row" });
    incomeNode("td", incomeNumber(estimate), row);
    incomeNode("td", total ? `${(estimate / total * 100).toFixed(1)}%` : "Unavailable", row);
    incomeNode("td", incomeNumber(moe), row);
  };
  p.earnings_totals.forEach((estimate, i) => addRow(`All modes / ${TransportModel.earnings[i]}`, estimate, p.earnings_moes[i], p.total));
  p.series.forEach((series, mode) => {
    addRow(`${TransportModel.modes[mode]} / all earnings`, series.total, series.moe, p.total);
    series.estimates.forEach((estimate, i) => addRow(`${TransportModel.modes[mode]} / ${TransportModel.earnings[i]}`, estimate, series.moes[i], p.total));
  });
  const pieTable = incomeNode("table", null, details, { class: "income-popup-table" });
  incomeNode("caption", "B08301 all workers age 16+; approximate 90% MOEs", pieTable);
  const pieHead = incomeNode("tr", null, incomeNode("thead", null, pieTable));
  ["Mode", "Workers", "Share", "+/- MOE (approx.)"].forEach((label) => incomeNode("th", label, pieHead, { scope: "col" }));
  const pieBody = incomeNode("tbody", null, pieTable);
  p.pie.forEach((item, i) => {
    const row = incomeNode("tr", null, pieBody);
    incomeNode("th", TransportModel.pieLabels[i], row, { scope: "row" });
    incomeNode("td", incomeNumber(item.estimate), row);
    incomeNode("td", p.pie_total ? `${(item.estimate / p.pie_total * 100).toFixed(1)}%` : "Unavailable", row);
    incomeNode("td", incomeNumber(item.moe), row);
  });
  return wrapper;
}
