const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../scenario-model.js");
const config = require("../assets/market/scenario.json");
const defaults = model.defaults(config);
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("illustrative defaults validate without mutation and no-intervention reference closes at 100", () => {
  const before = JSON.stringify(config);
  assert.equal(model.validateConfig(config), config);
  const result = model.solve(config, defaults);
  assert.equal(JSON.stringify(config), before);
  assert.deepEqual(result.map((r) => r.id), ["baseline", "bridge", "redevelopment", "combined"]);
  for (const key of ["rent", "price", "stock", "flow", "shortRunRent", "shortRunPrice"]) close(result[0][key], 1);
});

test("default equilibria match independent quadratic solutions", () => {
  const results = model.solve(config, defaults);
  close(results[1].stock, Math.sqrt(1.1));
  close(results[2].stock, (0.1 + Math.sqrt(0.01 + 4)) / 2);
  close(results[3].stock, (0.1 + Math.sqrt(0.01 + 4.4)) / 2);
  for (const r of results) close(r.rent * r.stock, r.bridge ? 1.1 : 1);
});

test("zero intervention assumptions collapse all four scenarios", () => {
  const results = model.solve(config, { ...defaults, bridgeDemandPercent: 0, redevelopmentFlowPercent: 0 });
  for (const r of results) for (const key of ["rent", "price", "stock", "flow"]) close(r[key], 1);
});

test("bridge demand raises fixed-stock rent; net delivery moderates long-run rent", () => {
  const [baseline, bridge, redevelopment, combined] = model.solve(config, defaults);
  close(bridge.shortRunRent, 1.1);
  close(combined.shortRunRent, bridge.shortRunRent);
  close(redevelopment.shortRunRent, baseline.shortRunRent);
  assert.ok(bridge.rent > baseline.rent && bridge.stock > baseline.stock);
  assert.ok(redevelopment.rent < baseline.rent && redevelopment.stock > baseline.stock);
  assert.ok(combined.rent < bridge.rent && combined.stock > bridge.stock);
  assert.ok(redevelopment.marketFlow < baseline.marketFlow);
});

test("common cap-rate, delivery-cost and loss factors change no-intervention relative to reference", () => {
  const base = model.solve(config, defaults)[0];
  const cap = model.solve(config, { ...defaults, capRateFactor: 2 })[0];
  const cost = model.solve(config, { ...defaults, costFactor: 2 })[0];
  const loss = model.solve(config, { ...defaults, lossFactor: 2 })[0];
  assert.ok(cap.price < base.price && cap.stock < base.stock && cap.rent > base.rent);
  assert.ok(cost.stock < base.stock && cost.rent > base.rent);
  assert.ok(loss.stock < base.stock && loss.rent > base.rent);
  close(cap.price * 2, cap.rent);
  close(loss.flow, loss.stock * 2);
});

test("negative bridge-demand shifts remain valid and are not forced into premiums", () => {
  const result = model.solve(config, { ...defaults, bridgeDemandPercent: -30 });
  assert.ok(result[1].rent < result[0].rent);
  close(result[1].shortRunRent, 0.7);
});

test("all 128 parameter-range corners satisfy every quadrant and stock-flow identity", () => {
  for (let mask = 0; mask < 2 ** config.parameters.length; mask++) {
    const inputs = Object.fromEntries(config.parameters.map((p, i) => [p.id, mask & (1 << i) ? p.max : p.min]));
    const before = JSON.stringify(inputs);
    for (const r of model.solve(config, inputs)) {
      const demand = r.bridge ? 1 + inputs.bridgeDemandPercent / 100 : 1;
      const extra = r.redevelopment ? inputs.redevelopmentFlowPercent / 100 : 0;
      close(r.rent, demand * r.stock ** (-1 / inputs.demandElasticity));
      close(r.price, r.rent / inputs.capRateFactor);
      close(r.flow, (r.price / inputs.costFactor) ** inputs.supplyElasticity + extra);
      close(r.flow, inputs.lossFactor * r.stock);
      close(r.extraFlow, extra);
      assert.ok(r.marketFlow > 0);
    }
    assert.equal(JSON.stringify(inputs), before);
  }
});

test("blank-shaped values, nonnumeric, nonfinite and out-of-range assumptions are rejected", () => {
  for (const p of config.parameters) {
    for (const value of [undefined, "", null, "1", NaN, Infinity, p.min - 1, p.max + 1]) {
      assert.throws(() => model.solve(config, { ...defaults, [p.id]: value }), /Invalid explanatory scenario/);
    }
  }
});

for (const [label, change] of [
  ["schema", (c) => { c.schema_version = 2; }],
  ["calibration claim", (c) => { c.status = "calibrated"; }],
  ["missing parameter", (c) => { c.parameters.pop(); }],
  ["duplicate parameter", (c) => { c.parameters[1].id = c.parameters[0].id; }],
  ["unmarked assumption", (c) => { c.parameters[0].note = "Measured"; }],
  ["zero elasticity", (c) => { c.parameters[0].min = 0; }],
  ["nonpositive demand", (c) => { c.parameters[2].min = -100; }],
  ["invalid default", (c) => { c.parameters[0].default = 99; }],
]) {
  test(`invalid scenario config rejected: ${label}`, () => {
    const copy = structuredClone(config);
    change(copy);
    assert.throws(() => model.validateConfig(copy), /Invalid explanatory scenario/);
  });
}
