(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FarModel = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ids = ["priceIntercept", "priceSlope", "costIntercept", "costSlope", "farCap"];
  function check(ok, message) {
    if (!ok) throw new Error(`Invalid Optimal FAR model: ${message}`);
  }
  function validateConfig(config) {
    check(config?.schema_version === 1 && config.status === "illustrative_not_locally_calibrated", "configuration status");
    check(typeof config.assumption_note === "string" && config.assumption_note.length > 0, "assumption note");
    check(Array.isArray(config.parameters) && config.parameters.length === ids.length, "parameter scope");
    const seen = new Set();
    for (const p of config.parameters) {
      check(ids.includes(p.id) && !seen.has(p.id), "duplicate/unknown parameter");
      seen.add(p.id);
      check([p.min, p.max, p.default, p.step].every(Number.isFinite)
        && p.min < p.max && p.min >= 0 && p.step > 0
        && p.default >= p.min && p.default <= p.max, "parameter bounds/default");
      check(p.id !== "priceSlope" || p.min > 0, "price slope must be positive");
      check(typeof p.label === "string" && typeof p.note === "string"
        && p.note.startsWith("ASSUMPTION:"), "assumption labels");
    }
    return config;
  }
  function defaults(config) {
    validateConfig(config);
    return Object.fromEntries(config.parameters.map((p) => [p.id, p.default]));
  }
  function values(far, inputs) {
    check(typeof far === "number" && Number.isFinite(far) && far >= 0, "FAR must be nonnegative");
    const price = inputs.priceIntercept - inputs.priceSlope * far;
    const cost = inputs.costIntercept + inputs.costSlope * far;
    return { far, price, cost, land: far === 0 ? 0 : far * (price - cost) };
  }
  function solve(config, inputs) {
    validateConfig(config);
    for (const p of config.parameters) {
      check(typeof inputs[p.id] === "number" && Number.isFinite(inputs[p.id])
        && inputs[p.id] >= p.min && inputs[p.id] <= p.max, `${p.label} must be between ${p.min} and ${p.max}`);
    }
    const spread = inputs.priceIntercept - inputs.costIntercept;
    const slope = inputs.priceSlope + inputs.costSlope;
    const crossing = spread >= 0 ? spread / slope : null;
    const unconstrained = values(Math.max(0, spread / (2 * slope)), inputs);
    const chosen = values(Math.min(unconstrained.far, inputs.farCap), inputs);
    const cap = values(inputs.farCap, inputs);
    const capBinding = unconstrained.far > inputs.farCap;
    return {
      unconstrained, chosen, cap, crossing,
      crossingValue: crossing === null ? null : values(crossing, inputs),
      capBinding, positiveResidual: chosen.land > 0,
      landOpportunityGap: unconstrained.land - chosen.land,
      derivativeAtChosen: spread - 2 * slope * chosen.far,
    };
  }
  return { validateConfig, defaults, values, solve };
}));
