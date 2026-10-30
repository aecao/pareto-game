"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../jobs-industry-model.js");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const snapshots = Object.fromEntries(["tract", "neighborhood"].map(scale =>
  [scale, JSON.parse(read(`assets/jobs_industry/${scale}.json`))]));
const categories = Object.fromEntries(["tract", "neighborhood"].map(scale =>
  [scale, JSON.parse(read(`assets/jobs_industry/categories-${scale}.json`))]));

test("all classifications preserve exact per-area counts and colored symbol area, including tiny categories", () => {
  for (const [scale, snapshot] of Object.entries(snapshots)) {
    const data = model.withCategories(snapshot, categories[scale]);
    const counts = { broad: 0, sectors: 0, age: 0, earnings: 0 };
    for (const { properties: p } of data.features) {
      for (const mode of Object.keys(counts)) {
        const view = model.breakdown(p, data.metadata, mode);
        counts[mode] += view.count;
        assert.ok(view.count <= model.sampleCapacity(p, data.metadata));
        assert.equal(view.bands.reduce((n, b) => n + b.total, 0), p.total);
        for (const band of view.bands) {
          assert.equal((band.end - band.start - 1) * 10 + (band.total % 10 || 10), band.total);
          if (view.definition.proportional) assert.equal(band.total, p.categories[mode][band.key]);
        }
        if (!view.definition.proportional) {
          assert.equal(view.bands[0]?.key, view.winners[0]);
          assert.ok(view.bands.length <= 1);
        }
      }
    }
    assert.deepEqual(counts, scale === "tract"
      ? { broad: 415299, sectors: 415299, age: 417351, earnings: 417401 }
      : { broad: 414333, sectors: 414333, age: 414576, earnings: 414566 });
    const p = data.features.find(f => f.properties.total > 0).properties;
    const points = model.sample({ ...p, total: model.sampleCapacity(p, data.metadata) * 10 }, data.metadata);
    const original = model.sample(p, data.metadata);
    assert.deepEqual(points.slice(0, original.length), original, "capacity preserves every original dot coordinate");
    const before = points.slice();
    for (const mode of Object.keys(counts)) model.breakdown(p, data.metadata, mode);
    assert.deepEqual(points, before, "switching only selects colors/counts, never moves points");
  }
});

test("category joins reject missing areas, totals, fields, source, negative or fractional counts and definitions", () => {
  for (const edit of [
    d => { delete d.areas[Object.keys(d.areas)[0]]; },
    d => { d.metadata.source_sha256 = "wrong"; },
    d => { d.metadata.job_type = "JT00"; },
    d => { d.metadata.classifications.age.proportional = false; },
    d => { d.metadata.classifications.sectors.groups.CNS01.color = "red"; },
    d => { d.areas[Object.keys(d.areas)[0]].age.CA01++; },
    d => { d.areas[Object.keys(d.areas)[0]].age.CA01 = -1; },
    d => { d.areas[Object.keys(d.areas)[0]].age.CA01 = 0.1; },
    d => { delete d.areas[Object.keys(d.areas)[0]].earnings.CE01; },
  ]) {
    const payload = structuredClone(categories.neighborhood);
    edit(payload);
    assert.throws(() => model.withCategories(snapshots.neighborhood, payload));
  }
  const data = model.withCategories(snapshots.neighborhood, categories.neighborhood);
  const p = { ...data.features[0].properties, total: 11,
    categories: { age: { CA01: 1, CA02: 1, CA03: 9 } } };
  assert.deepEqual(model.breakdown(p, data.metadata, "age").bands.map(b => b.total), [1, 1, 9]);
  const tied = { ...p, total: 2, categories: { sectors:
    Object.fromEntries(Object.keys(data.metadata.classifications.sectors.groups).map((key, i) => [key, i < 2 ? 1 : 0])) } };
  assert.deepEqual(model.breakdown(tied, data.metadata, "sectors").winners, ["CNS01", "CNS02"]);
  assert.equal(model.breakdown(tied, data.metadata, "sectors").bands[0].key, "CNS01");
  assert.throws(() => model.classification(data.metadata, "missing"));
});

test("jobs snapshots preserve exact JT01 totals, dominant groups, ties, zeros and representative dot counts", () => {
  for (const [scale, data] of Object.entries(snapshots)) {
    assert.equal(model.normalize(data, scale), data);
    assert.equal(data.metadata.total_jobs, 4142287);
    assert.equal(data.features.length, scale === "tract" ? 2327 : 263);
    assert.equal(data.features.filter(f => f.properties.total === 0).length, scale === "tract" ? 23 : 16);
    assert.equal(data.features.filter(f => f.properties.ties.length).length, scale === "tract" ? 13 : 0);
    const count = data.features.reduce((n,f) => n + Math.ceil(f.properties.total / 10), 0);
    assert.equal(count, scale === "tract" ? 415299 : 414333);
    for (const f of data.features) {
      const p = f.properties;
      const dots = Math.ceil(p.total / 10);
      assert.equal(dots ? (dots - 1) * 10 + (p.total % 10 || 10) : 0, p.total);
    }
  }
});

test("zoom-aware dot size reduces overview saturation without changing density or remainder proportions", () => {
  assert.equal(model.dotRadius(12), 0.6);
  assert.ok(Math.abs(model.dotRadius(13) - 0.6 * Math.sqrt(2)) < 1e-10);
  assert.equal(model.dotRadius(14), 1.2);
  assert.equal(model.dotRadius(15), 1.4);
  assert.equal(model.dotRadius(16), 1.4);
  assert.ok(Math.abs(model.dotRadius(12 - 1e-8) - model.dotRadius(12 + 1e-8)) < 1e-8);
  assert.equal(model.dotRadius(11), 0.6);
  assert.equal(model.dotRadius(9), 0.6);
  assert.equal(model.dotRadius(18), 1.4);
  for (let zoom = 9; zoom <= 18; zoom += 0.25) {
    assert.ok(model.dotRadius(zoom) >= 0.6 && model.dotRadius(zoom) <= 1.4);
    assert.ok(model.dotRadius(zoom) >= model.dotRadius(zoom - 0.25));
  }
  assert.match(read("jobs-industry.js"), /ctx\.globalAlpha = 1;/);
  for (const zoom of [9, 11, 13, 16]) {
    const full = model.dotRadius(zoom);
    for (let remainder = 1; remainder < 10; remainder++) {
      const partial = full * Math.sqrt(remainder / 10);
      assert.ok(Math.abs((partial / full) ** 2 - remainder / 10) < 1e-12);
    }
  }
  for (const invalid of [NaN, Infinity, "13", null]) assert.throws(() => model.dotRadius(invalid));
});

test("invalid metadata, counts, industry partition, dominant winner, ties and samplers fail explicitly", () => {
  for (const edit of [
    d => { d.metadata.job_type = "JT00"; }, d => { d.metadata.total_jobs++; },
    d => { d.metadata.placement = "water"; }, d => { d.features[0].properties.total++; },
    d => { d.features[0].properties.industries.professional = -1; },
    d => { d.features[0].properties.dominant = "wrong"; },
    d => { d.features[0].properties.ties = ["wrong"]; },
    d => { d.features[0].properties.triangles = []; },
    d => { d.features[0].properties.triangles[0][0] = 0; },
    d => { d.features[0].geometry = null; },
  ]) {
    const copy = structuredClone(snapshots.neighborhood);
    edit(copy);
    assert.throws(() => model.normalize(copy, "neighborhood"));
  }
});

test("seeded triangle sampling is deterministic, exact-count, within land triangles and varies by area", () => {
  const p = { scale: "tract", geoid: "36061000100", total: 100001,
    triangles: [[1, -74, 40, -73, 40, -74, 41]] };
  const m = { random_seed: 20231030, jobs_per_dot: 10 };
  const points = model.sample(p, m);
  assert.equal(points.length / 2, 10001);
  assert.deepEqual(points, model.sample(p, m));
  assert.notDeepEqual(points, model.sample({ ...p, geoid: "36061000200" }, m));
  for (let i=0;i<points.length;i+=2) {
    const lon = points[i] * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * points[i+1]))) * 180 / Math.PI;
    assert.ok(lon >= -74 && lon <= -73 && lat >= 40 && lat <= 41 && lon + 74 + lat - 40 <= 1 + 1e-10);
  }
  assert.equal(model.sample({ ...p, total: 0, triangles: [] }, m).length, 0);
});

test("worker transfers generated arrays and reports errors explicitly without fetching dot data", () => {
  let response, transfers;
  const context = {
    JobsIndustryModel: model, importScripts() {},
    self: { postMessage(data, buffers) { response = data; transfers = buffers; } },
  };
  vm.createContext(context);
  vm.runInContext(read("jobs-industry-worker.js"), context);
  const area = snapshots.neighborhood.features.find(f => f.properties.total > 0).properties;
  context.self.onmessage({ data: { areas: [area], metadata: snapshots.neighborhood.metadata } });
  assert.equal(response.areas[0].points.length, Math.ceil(area.total / 10) * 2);
  assert.equal(transfers[0], response.areas[0].points.buffer);
  assert.equal(transfers[1], response.areas[0].order.buffer);
  context.self.onmessage({ data: { areas: [{ total: 10, triangles: [] }], metadata: snapshots.neighborhood.metadata } });
  assert.equal(typeof response.error, "string");
});

test("canvas switches classifications without fetching, resampling, moving the map or retaining listeners", () => {
  const data = model.withCategories(snapshots.neighborhood, categories.neighborhood);
  const original = data.features.find(f => f.properties.geoid === "MN0801-RI");
  const p = original.properties;
  const controls = new Map();
  const get = id => {
    if (!controls.has(id)) controls.set(id, {
      value: "broad", listeners: new Map(),
      addEventListener(event, fn) { this.listeners.set(event, fn); },
      removeEventListener(event, fn) { assert.equal(this.listeners.get(event), fn); this.listeners.delete(event); },
    });
    return controls.get(id);
  };
  const painted = [];
  let removed = false, terminated = false, messages = 0, closed = 0, legends = 0;
  const ctx = {
    scale() {}, beginPath() {}, arc(x, y, radius) { this.radius = radius; },
    fill() { painted.push({ color: this.fillStyle, weight: (this.radius / model.dotRadius(0)) ** 2 * 10 }); },
  };
  const canvas = { style: {}, getContext: () => ctx, remove() { removed = true; } };
  const frames = new Map();
  let nextFrame = 0;
  const context = {
    JobsIndustryModel: model, incomeHomeBounds: {}, devicePixelRatio: 2, console,
    document: { getElementById: get }, incomeNumber: n => n.toLocaleString("en"),
    jobsIndustryLegend() { legends++; },
    Worker: class {
      postMessage() { messages++; }
      terminate() { terminated = true; }
    },
    L: { Layer: { extend: methods => methods }, DomUtil: { create: () => canvas, setPosition() {} } },
    performance: { now: () => 0 },
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(read("jobs-industry.js") + "\nglobalThis.layer = Object.create(JobsIndustryLayer);", context);
  const layer = context.layer;
  layer.initialize({ ...data, features: [original] });
  const events = new Map();
  const map = {
    getPanes: () => ({ overlayPane: { appendChild() {} } }),
    on(name, fn) { events.set(name, fn); }, off(name) { events.delete(name); },
    getSize: () => ({ x: 256, y: 256 }), getZoom: () => 0,
    getPixelBounds: () => ({ min: { x: 0, y: 0 } }), containerPointToLayerPoint: p => p,
    closePopup() { closed++; },
  };
  layer.onAdd(map);
  const points = model.sample({ ...p, total: model.sampleCapacity(p, data.metadata) * 10 }, data.metadata);
  const order = model.drawOrder(points.length / 2, data.metadata.random_seed);
  assert.deepEqual(order, model.drawOrder(points.length / 2, data.metadata.random_seed));
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: points.length / 2 }, (_, i) => i));
  assert.notDeepEqual([...order], [...order].sort((a, b) => a - b), "paint order mixes categories");
  layer.worker.onmessage({ data: { areas: [{ geoid: p.geoid, total: p.total, points, order }] } });
  const flush = () => {
    while (frames.size) {
      const [id, fn] = frames.entries().next().value;
      frames.delete(id);
      fn();
    }
  };
  for (const mode of ["sectors", "age", "earnings", "broad"]) {
    painted.length = 0;
    get("jobs-classification").value = mode;
    get("jobs-classification").listeners.get("change")();
    flush();
    const view = model.breakdown(p, data.metadata, mode);
    assert.equal(painted.length, view.count);
    assert.ok(Math.abs(painted.reduce((n, dot) => n + dot.weight, 0) - p.total) < 1e-8);
    for (const band of view.bands) {
      const matching = painted.filter(dot => dot.color === band.color);
      assert.equal(matching.length, band.end - band.start);
      assert.ok(Math.abs(matching.reduce((n, dot) => n + dot.weight, 0) - band.total) < 1e-8);
    }
    assert.equal(layer.areas[0].points, points, "same point buffer for all classifications");
  }
  assert.equal(messages, 1, "worker only receives one initial sample request");
  assert.equal(legends, 4);
  assert.equal(closed, 4);
  layer.onRemove(map);
  assert.equal(removed, true);
  assert.equal(terminated, true);
  assert.equal(get("jobs-classification").listeners.size, 0);
  assert.equal(events.size, 0);
  assert.equal(frames.size, 0);
  assert.equal(layer.areas.length, 0);
});
