const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../far-model.js");
const config = require("../assets/market/far.json");
const defaults = model.defaults(config);
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("default FAR maximum is not the price/cost crossing", () => {
  const before = JSON.stringify(config);
  const result = model.solve(config, defaults);
  close(result.unconstrained.far, 2);
  close(result.chosen.far, 2);
  close(result.chosen.price, 120);
  close(result.chosen.cost, 70);
  close(result.chosen.land, 100);
  close(result.crossing, 4);
  close(result.crossingValue.land, 0);
  assert.equal(result.capBinding, false);
  assert.equal(result.positiveResidual, true);
  close(result.derivativeAtChosen, 0);
  assert.equal(JSON.stringify(config), before);
});

test("a binding ceiling chooses the ceiling; ceiling beyond optimum does not force overbuilding", () => {
  const low = model.solve(config, { ...defaults, farCap: 1 });
  assert.equal(low.capBinding, true);
  close(low.chosen.far, 1);
  close(low.chosen.land, 75);
  close(low.landOpportunityGap, 25);
  assert.ok(low.derivativeAtChosen > 0);
  const high = model.solve(config, { ...defaults, farCap: 10 });
  close(high.chosen.far, 2);
  assert.ok(high.cap.land < 0);
  close(high.landOpportunityGap, 0);
});

test("zero ceiling and no positive spread choose no new building without fabricating land market value", () => {
  const zero = model.solve(config, { ...defaults, farCap: 0 });
  close(zero.chosen.far, 0);
  close(zero.chosen.land, 0);
  assert.equal(zero.positiveResidual, false);
  for (const costIntercept of [150, 200]) {
    const result = model.solve(config, { ...defaults, costIntercept });
    close(result.unconstrained.far, 0);
    close(result.chosen.land, 0);
    assert.equal(Object.is(result.chosen.land, -0), false);
    assert.equal(result.positiveResidual, false);
    assert.equal(result.crossing, costIntercept === 150 ? 0 : null);
    assert.ok(model.values(1, { ...defaults, costIntercept }).land < 0);
  }
});

test("higher housing prices raise unconstrained FAR; higher costs or stronger slopes lower it", () => {
  const base = model.solve(config, defaults).unconstrained;
  const price = model.solve(config, { ...defaults, priceIntercept: 200 }).unconstrained;
  const cost = model.solve(config, { ...defaults, costIntercept: 100 }).unconstrained;
  const slope = model.solve(config, { ...defaults, priceSlope: 30 }).unconstrained;
  assert.ok(price.far > base.far && price.land > base.land);
  assert.ok(cost.far < base.far && cost.land < base.land);
  assert.ok(slope.far < base.far);
});

test("all 32 input-range corners maximize residual against independent grid search and close identities", () => {
  for (let mask = 0; mask < 32; mask++) {
    const inputs = Object.fromEntries(config.parameters.map((p, i) => [p.id, mask & (1 << i) ? p.max : p.min]));
    const original = JSON.stringify(inputs);
    const r = model.solve(config, inputs);
    close(r.chosen.land, r.chosen.far * (r.chosen.price - r.chosen.cost));
    assert.ok(r.chosen.far >= 0 && r.chosen.far <= inputs.farCap);
    assert.ok(r.chosen.land >= 0);
    for (let i = 0; i <= 1000; i++) {
      const f = inputs.farCap * i / 1000;
      const land = f * (inputs.priceIntercept - inputs.costIntercept - (inputs.priceSlope + inputs.costSlope) * f);
      assert.ok(r.chosen.land + 1e-8 >= land);
    }
    if (r.unconstrained.far > 0) {
      close(r.unconstrained.price - r.unconstrained.far * inputs.priceSlope,
        r.unconstrained.cost + r.unconstrained.far * inputs.costSlope);
      close(r.crossing, 2 * r.unconstrained.far);
    }
    assert.equal(JSON.stringify(inputs), original);
  }
});

test("invalid, blank-shaped, out-of-range and nonfinite values fail explicitly", () => {
  for (const p of config.parameters) {
    for (const value of [null, undefined, "", "1", NaN, Infinity, p.min - 1, p.max + 1]) {
      assert.throws(() => model.solve(config, { ...defaults, [p.id]: value }), /Invalid Optimal FAR/);
    }
  }
  for (const f of [-1, null, NaN, Infinity]) assert.throws(() => model.values(f, defaults), /Invalid Optimal FAR/);
});

for (const [label, corrupt] of [
  ["schema", (c) => { c.schema_version = 99; }],
  ["calibration", (c) => { c.status = "observed"; }],
  ["duplicate parameter", (c) => { c.parameters[1].id = c.parameters[0].id; }],
  ["missing parameter", (c) => { c.parameters.pop(); }],
  ["nonconcave domain", (c) => { c.parameters[1].min = 0; }],
  ["missing assumption", (c) => { c.parameters[0].note = ""; }],
]) {
  test(`FAR rejects invalid config: ${label}`, () => {
    const copy = structuredClone(config);
    corrupt(copy);
    assert.throws(() => model.validateConfig(copy), /Invalid Optimal FAR/);
  });
}
