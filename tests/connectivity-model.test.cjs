const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../connectivity-model.js");
const data = require("../assets/connectivity/walking.json");
const fs = require("node:fs");
const path = require("node:path");
const origins = require("../assets/connectivity/origins.json");

test("origin catalog has eight sourced locations and preserves the exact Main Street origin", () => {
  assert.equal(model.validateOrigins(origins, data), origins);
  assert.deepEqual(origins.origins.map((origin) => origin.name), [
    "Main Street", "Coler", "Cornell Tech", "Long Island City", "Queensbridge Houses",
    "Astoria Houses", "Ravenswood Houses", "East River Esplanade",
  ]);
  assert.ok(origins.origins.slice(1).every((origin) => origin.provisional));
  assert.deepEqual(origins.origins.find((origin) => origin.id === "east_river_esplanade").coordinates,
    [-73.961427, 40.7550331]);
});

for (const [label, corrupt] of [
  ["count", (d) => d.origins.pop()],
  ["duplicate", (d) => { d.origins[1].id = d.origins[0].id; }],
  ["coordinate", (d) => { d.origins[1].coordinates = [0, 0]; }],
  ["source", (d) => { d.origins[1].source = ""; }],
  ["Main Street", (d) => { d.origins[0].coordinates[0] += 0.00001; }],
]) {
  test(`reject invalid origin catalog: ${label}`, () => {
    const invalid = structuredClone(origins);
    corrupt(invalid);
    assert.throws(() => model.validateOrigins(invalid, data), /origin|Main Street/);
  });
}

test("origin controls replace map style and load the same released origin catalog", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../connectivity.js"), "utf8");
  const version = html.match(/src="connectivity-model\.js\?v=([^"]+)"/)[1];
  assert.ok(html.includes('class="panel-section connectivity-only" hidden aria-label="Connectivity origins"'));
  assert.ok(!html.includes("data-style="));
  assert.ok(!app.includes("streetLayer"));
  assert.ok(renderer.includes(`fetch("assets/connectivity/origins.json?v=${version}"`));
});

test("alternate origins clear results and Main Street restores the selected scenario", () => {
  const vm = require("node:vm");
  const element = () => ({
    children: [], value: "45", hidden: false, textContent: "",
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener() {},
    querySelectorAll() { return data.bridges.map((bridge) => ({ value: bridge.id })); },
  });
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const group = () => ({
    layers: [], addTo() { return this; }, clearLayers() { this.layers = []; },
  });
  const context = vm.createContext({
    ConnectivityModel: model,
    document: { getElementById: get, querySelector: get, createElement: element },
    L: {
      featureGroup: group,
      geoJSON(collection, options) {
        return { addTo(target) { target.layers = collection.features.filter(options.filter); } };
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../connectivity.js"), "utf8"), context);
  context.testData = data;
  context.testOrigins = origins.origins;
  vm.runInContext(`
    connectivityData = testData; connectivityOrigins = testOrigins;
    renderLegendRamps = () => {};
    drawReachable = (scenario) => connectivityStreets.layers.push(scenario);
    renderConnectivity();
  `, context);
  const initialMetrics = JSON.stringify(get("connectivity-metrics").children);
  for (const origin of origins.origins.slice(1)) {
    context.testId = origin.id;
    vm.runInContext("connectivityOriginId = testId; renderConnectivity();", context);
    assert.equal(vm.runInContext("connectivityStreets.layers.length", context), 0);
    assert.equal(get("connectivity-metrics").children.length, 0);
    assert.ok(get("connectivity-fields").disabled);
    assert.ok(get(".connectivity-legend").hidden);
    assert.match(get("connectivity-state").textContent, /not generated/);
    assert.equal(vm.runInContext('connectivityLinks.layers.some(f => f.properties.kind === "origin_access")', context), false);
    assert.ok(vm.runInContext("connectivityLinks.layers.length", context) > 0);
  }
  vm.runInContext('connectivityOriginId = "main_street"; renderConnectivity();', context);
  assert.equal(get("connectivity-fields").disabled, false);
  assert.equal(get(".connectivity-legend").hidden, false);
  assert.equal(vm.runInContext("connectivityStreets.layers.length", context), 2);
  assert.equal(JSON.stringify(get("connectivity-metrics").children), initialMetrics);
});

test("Connectivity scripts, fetch and download share a cache-busting release", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const loader = fs.readFileSync(path.join(__dirname, "../connectivity.js"), "utf8");
  const modelVersion = html.match(/src="connectivity-model\.js\?v=([^"]+)"/);
  assert.ok(modelVersion, "validator must have a release version");
  const version = modelVersion[1];
  assert.ok(html.includes(`src="connectivity.js?v=${version}"`));
  assert.ok(html.includes(`href="assets/connectivity/walking.json?v=${version}"`));
  assert.ok(loader.includes(`fetch("assets/connectivity/walking.json?v=${version}", { cache: "no-cache" })`));
});

test("travel modes show walking and unavailable biking without a map comparison selector", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../connectivity.js"), "utf8");
  assert.ok(html.includes('aria-pressed="true">Walking</button>'));
  assert.ok(html.includes('disabled aria-describedby="connectivity-biking-note">Biking</button>'));
  assert.ok(html.indexOf('aria-label="Travel mode"') < html.indexOf('id="connectivity-bridges"'));
  assert.ok(!html.includes('id="connectivity-scenario"'));
  assert.ok(!renderer.includes("connectivity-scenario"));
});

test("verified walking snapshot validates without mutation", () => {
  const original = JSON.stringify(data);
  assert.equal(model.validate(data), data);
  assert.equal(JSON.stringify(data), original);
  assert.equal(Object.keys(data.scenarios).length, 8);
  assert.equal(data.summary.length, 32);
});

test("5-minute bands cover exactly the trimmed length and stay within their band", () => {
  for (const scenario of ["baseline", "lic_midtown", Object.keys(data.scenarios).at(-1)]) {
    for (const budget of [7, 33, 60]) {
      const times = data.node_times[scenario];
      let bandFeet = 0;
      let trimFeet = 0;
      for (const feature of data.edges.features) {
        const p = feature.properties;
        if (p.bridge !== null && !data.scenarios[scenario].includes(p.bridge)) continue;
        trimFeet += model.trim(feature, times, budget).fraction * p.l;
        for (const piece of model.bands(feature, times, budget, 5)) {
          assert.ok(piece.band >= 0 && piece.band < Math.ceil(budget / 5), `${scenario}/${budget} band`);
          assert.ok(piece.coordinates.length >= 2 && piece.coordinates.flat().every(Number.isFinite));
          bandFeet += (piece.to - piece.from) * p.l;
        }
      }
      assert.ok(Math.abs(bandFeet - trimFeet) < 0.01, `${scenario}/${budget}`);
    }
  }
});

test("band boundaries fall on 5-minute isochrones of a synthetic edge", () => {
  const feature = { geometry: { coordinates: [[-73.95, 40.76], [-73.94, 40.76]] },
    properties: { u: 0, v: 1, m: 20, l: 5280, f: [0, 1] } };
  const pieces = model.bands(feature, [2, 10], 60, 5);
  // Meet point at (10 - 2 + 20) / 40 = 0.7 → u side 2→16 min, v side 10→16 min.
  assert.deepEqual(pieces.map((p) => p.band), [0, 1, 2, 3, 2, 3]);
  const lon = (x) => -73.95 + 0.01 * x;
  assert.ok(Math.abs(pieces[0].coordinates[1][0] - lon(3 / 20)) < 1e-12);
  assert.ok(Math.abs(pieces[3].coordinates[1][0] - lon(0.7)) < 1e-12);
  assert.deepEqual(model.bands(feature, [null, null], 60, 5), []);
  assert.deepEqual(model.bands(feature, [2, 10], 7, 5).map((p) => p.band), [0, 1]);
});

test("metrics work for any whole-minute slider budget up to 60", () => {
  let previous = -1;
  for (let budget = 0; budget <= model.MAX_BUDGET; budget += 1) {
    const m = model.metrics(data, "baseline", budget);
    assert.ok(m.existingMiles >= previous);
    previous = m.existingMiles;
  }
  assert.throws(() => model.metrics(data, "baseline", 61), /selection/);
});

test("bridge selections map to configured-order scenario names", () => {
  const [a, b, c] = data.bridges.map((bridge) => bridge.id);
  assert.equal(model.scenarioName(data, []), "baseline");
  assert.equal(model.scenarioName(data, [c, a]), `${a}+${c}`);
  assert.equal(model.scenarioName(data, [a, b, c]), `${a}+${b}+${c}`);
  assert.throws(() => model.scenarioName(data, ["tunnel"]), /unknown bridge/);
});

test("browser trimming reproduces every saved node count and street length", () => {
  for (const scenario of Object.keys(data.scenarios)) {
    for (const budget of model.BUDGETS) {
      const result = model.metrics(data, scenario, budget);
      assert.equal(result.queens, result.row.queens_source_nodes, `${scenario}/${budget} queens`);
      assert.equal(result.island, result.row.island_source_nodes, `${scenario}/${budget} island`);
      assert.equal(result.other, result.row.other_source_nodes, `${scenario}/${budget} other`);
      assert.ok(Math.abs(result.existingMiles - result.row.existing_source_edge_miles) * 5280 < 0.01,
        `${scenario}/${budget} length`);
      assert.ok(Math.abs(result.queensMiles - result.row.queens_source_edge_miles) * 5280 < 0.01,
        `${scenario}/${budget} Queens length`);
    }
  }
});

test("trimmed lines stay on their source edge and inactive bridges are hidden", () => {
  const items = model.reachable(data, "baseline", 45);
  assert.ok(items.length > 0);
  assert.equal(items.some((item) => item.feature.properties.bridge !== null), false);
  const lic = model.reachable(data, "lic_midtown", 45);
  assert.ok(lic.some((item) => item.feature.properties.kind === "proposed_bridge"));
  for (const item of lic) {
    for (const part of item.parts) assert.ok(part.length >= 2 && part.flat().every(Number.isFinite));
  }
});

test("LIC–Midtown charges its 3-minute penalty only at the island exit", () => {
  const lic = data.bridges.find((bridge) => bridge.id === "lic_midtown");
  assert.deepEqual(lic.stops.map((stop) => stop.exit_penalty_minutes), [0, 3, 0]);
  const exit = data.edges.features.find((f) => f.properties.k === "lic_midtown:v1:access");
  assert.ok(Math.abs(exit.properties.m - (3 + exit.properties.l / 264)) < 1e-9);
  const through = data.edges.features.filter((f) => f.properties.k.startsWith("lic_midtown:deck"));
  assert.ok(through.every((f) => Math.abs(f.properties.m - f.properties.l / 264) < 1e-9));
});

test("every bridge alone improves on the baseline", () => {
  for (const bridge of data.bridges) {
    const better = model.BUDGETS.some((budget) => model.summaryRow(data, bridge.id, budget).existing_source_edge_miles
      > model.summaryRow(data, "baseline", budget).existing_source_edge_miles);
    assert.ok(better, bridge.id);
  }
});

for (const [name, corrupt] of [
  ["schema", (d) => { d.schema_version = 99; }],
  ["duplicate summary", (d) => { d.summary[0] = d.summary[1]; }],
  ["coordinate", (d) => { d.markers.features[0].geometry.coordinates = [0, 0]; }],
  ["origin method", (d) => { d.settings.origin_method = "roosevelt_island_bridge_landing_with_explicit_access_connector"; }],
  ["missing scenario", (d) => { delete d.node_times.baseline; }],
  ["node time range", (d) => { d.node_times.baseline[0] = 90; }],
  ["edge node index", (d) => { d.edges.features[0].properties.u = d.node_flags.length; }],
  ["edge fractions", (d) => { d.edges.features[0].properties.f = [0.5]; }],
  ["unknown bridge edge", (d) => { d.edges.features[0].properties.bridge = "tunnel"; }],
  ["obsolete payload", (d) => { d.reachable_streets = { type: "FeatureCollection", features: [] }; }],
  ["bridge with no effect", (d) => {
    for (const row of d.summary.filter((r) => r.scenario === d.bridges[0].id)) {
      const base = d.summary.find((r) => r.scenario === "baseline" && r.budget_minutes === row.budget_minutes);
      row.reachable_source_nodes = base.reachable_source_nodes;
      row.existing_source_edge_miles = base.existing_source_edge_miles;
    }
  }],
]) {
  test(`reject corrupt payload: ${name}`, () => {
    const copy = structuredClone(data);
    corrupt(copy);
    assert.throws(() => model.validate(copy), /Invalid walking snapshot/);
  });
}
