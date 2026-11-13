const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../transit-model.js");
const data = {
  subway: require("../assets/transit/roosevelt_island_subway_throughput_20261021_provisional.json"),
  tram: require("../assets/transit/roosevelt_island_tram_throughput_20261021_provisional.json"),
  bus: require("../assets/transit/roosevelt_island_q102_throughput_20261021_provisional.json"),
  ferry: require("../assets/transit/roosevelt_island_ferry_throughput_20261021_provisional.json"),
  commute: require("../assets/transit/roosevelt_island_commute_modes_2020_2024.json"),
};

test("directional figures and no-direct-service labels match reviewed snapshots", () => {
  const rows = model.rows(data, 150);
  const row = (mode, borough) => rows.find((r) => r.mode === mode && r.borough === borough);
  assert.equal(rows.length, 8);
  assert.equal(data.commute.total, 5696);
  assert.equal(data.commute.source_geographies.length, 3);
  assert.equal(data.commute.modes.find((mode) => mode.label === "Subway").estimate, 3060);
  for (const borough of ["Manhattan", "Queens"]) {
    assert.deepEqual([row("Subway", borough).to, row("Subway", borough).from], [270900, 270900]);
    assert.deepEqual([row("Ferry", borough).to, row("Ferry", borough).from], [5850, 5850]);
  }
  assert.deepEqual([row("Tram", "Manhattan").to, row("Tram", "Manhattan").from], [11881, 11881]);
  assert.deepEqual([row("Tram", "Queens").to, row("Tram", "Queens").from], [null, null]);
  assert.deepEqual([row("Q102 bus", "Queens").to, row("Q102 bus", "Queens").from], [2448, 2397]);
  assert.deepEqual([row("Q102 bus", "Manhattan").to, row("Q102 bus", "Manhattan").from], [null, null]);
  assert.match(row("Ferry", "Manhattan").basis, /via Queens/);
});

test("ferry scenarios preserve directional landing breakdown and scale separately", () => {
  for (const capacity of [150, 350]) {
    const rows = model.rows(data, capacity).filter((row) => row.mode === "Ferry");
    for (const row of rows) {
      assert.equal(row.to, 39 * capacity);
      assert.equal(row.from, 39 * capacity);
      assert.deepEqual(row.toOptions.map((option) => option.trips), [20, 19]);
      assert.deepEqual(row.fromOptions.map((option) => option.trips), [19, 20]);
      for (const option of [...row.toOptions, ...row.fromOptions]) assert.equal(option[`places_${capacity}`], option.trips * capacity);
    }
  }
  assert.throws(() => model.rows(data, 250), /unknown ferry scenario/);
});

test("corrupt, mismatched and duplicate source data fail explicitly", () => {
  for (const corrupt of [
    (d) => { d.tram.service_date = "2026-10-22"; },
    (d) => { d.subway.segments[0].passenger_places++; },
    (d) => { d.bus.segments[0].scheduled_bus_trips++; },
    (d) => { d.ferry.journeys[0].options[0].places_350++; },
    (d) => { d.ferry.journeys[0].from = "Queens"; d.ferry.journeys[0].to = "Roosevelt Island"; },
    (d) => { delete d.tram; },
  ]) {
    const copy = structuredClone(data);
    corrupt(copy);
    assert.throws(() => model.validate(copy), /Invalid transit snapshot/);
  }
});
