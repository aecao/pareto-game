const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../market-model.js");
const data = require("../assets/market/monthly.json");

test("market snapshot preserves every source cell, null, geography and six source anomalies", () => {
  const before = JSON.stringify(data);
  assert.equal(model.validate(data), data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(data.provenance.cells, 367812);
  assert.equal(data.provenance.missing_cells, 36271);
  assert.equal(data.provenance.anomalies, 6);
  assert.equal(data.geographies.length, 182);
  assert.equal(data.metrics.length, 12);
});

test("all metric/geography selections preserve every value, flag, source row and month", () => {
  for (const metric of data.metrics) {
    for (const series of metric.series) {
      const selected = model.select(data, metric.id, series.geography, metric.months[0], metric.months.at(-1));
      assert.deepEqual(selected.rows.map((r) => r.month), metric.months);
      assert.deepEqual(selected.rows.map((r) => r.value), series.values);
      assert.deepEqual(selected.rows.map((r) => r.sourceRow), series.source_rows);
      assert.deepEqual(selected.rows.flatMap((r, i) => r.flagged ? [i] : []), series.flagged_indices);
      assert.equal(selected.missing, series.values.filter((v) => v === null).length);
    }
  }
});

test("index coverage is not falsely extended to unavailable neighborhoods or boroughs", () => {
  const astoria = data.geographies.find((g) => g.name === "Astoria" && g.borough === "Queens");
  for (const id of ["priceIndex_All", "rentalIndex_All"]) {
    const metric = data.metrics.find((m) => m.id === id);
    assert.equal(metric.series.length, 4);
    assert.throws(() => model.select(data, id, astoria.id, metric.months[0], metric.months.at(-1)), /unavailable/);
  }
});

test("Queens early rental-index nulls stay missing and do not become zeros or lines across gaps", () => {
  const selected = model.select(data, "rentalIndex_All", data.defaults.geography, "2007-01", "2011-12");
  assert.equal(selected.rows.length, 60);
  assert.equal(selected.missing, 60);
  assert.equal(selected.latest, null);
  assert.deepEqual(model.segments(selected.rows), []);
  const rows = [
    { month: "2020-01", value: 0 }, { month: "2020-02", value: null },
    { month: "2020-03", value: 2 }, { month: "2020-04", value: 3 },
  ];
  assert.deepEqual(model.segments(rows), [[rows[0]], [rows[2], rows[3]]]);
});

test("negative days-on-market values remain negative and explicitly flagged", () => {
  const geo = data.geographies.find((g) => g.name === "Queens Village" && g.borough === "Queens");
  const selected = model.select(data, "daysOnMarket_All", geo.id, "2017-06", "2017-06");
  assert.equal(selected.rows[0].value, -17);
  assert.equal(selected.rows[0].flagged, true);
  assert.equal(selected.flagged, 1);
});

test("inclusive month range returns only requested months, including single-month selection", () => {
  const selection = model.select(data, data.defaults.metric, data.defaults.geography, "2026-08", "2026-09");
  assert.deepEqual(selection.rows.map((r) => r.month), ["2026-08", "2026-09"]);
  assert.equal(model.select(data, data.defaults.metric, data.defaults.geography, "2026-09", "2026-09").rows.length, 1);
});

test("blank, malformed, reversed, out-of-history ranges and unknown metrics fail explicitly", () => {
  for (const [start, end] of [["", "2026-09"], ["2026-13", "2026-09"], ["2026-09", "2026-08"], ["2009-12", "2026-09"], ["2010-01", "2026-10"]]) {
    assert.throws(() => model.select(data, data.defaults.metric, data.defaults.geography, start, end), /Invalid market data/);
  }
  assert.throws(() => model.select(data, "bogus", data.defaults.geography, "2026-09", "2026-09"), /unknown metric/);
});

for (const [name, corrupt] of [
  ["schema", (d) => { d.schema_version = 2; }],
  ["duplicate geography", (d) => { d.geographies[1].id = d.geographies[0].id; }],
  ["calendar gap", (d) => { d.metrics[0].months[1] = "2010-03"; }],
  ["missing series value", (d) => { d.metrics[0].series[0].values.pop(); }],
  ["nonnumeric value", (d) => { d.metrics[0].series[0].values[0] = "10"; }],
  ["duplicate series", (d) => { d.metrics[0].series[1].geography = d.metrics[0].series[0].geography; }],
  ["source row", (d) => { d.metrics[0].series[0].source_rows[0] = -1; }],
  ["unflagged anomaly", (d) => { d.metrics.find((m) => m.id === "daysOnMarket_All").series.find((s) => s.flagged_indices.length).flagged_indices = []; }],
  ["cell counts", (d) => { d.provenance.cells -= 1; }],
  ["missing counts", (d) => { d.provenance.missing_cells -= 1; }],
  ["hash", (d) => { d.provenance.source_sha256 = {}; }],
  ["default geography", (d) => { d.defaults.geography = "unknown"; }],
]) {
  test(`market rejects corrupt snapshot: ${name}`, () => {
    const copy = structuredClone(data);
    corrupt(copy);
    assert.throws(() => model.validate(copy), /Invalid market data/);
  });
}
