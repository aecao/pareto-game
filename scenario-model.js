(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ScenarioModel = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ids = ["demandElasticity", "supplyElasticity", "bridgeDemandPercent",
    "redevelopmentFlowPercent", "capRateFactor", "costFactor", "lossFactor"];
  const definitions = [
    { id: "baseline", label: "No intervention", bridge: false, redevelopment: false },
    { id: "bridge", label: "Bridge only", bridge: true, redevelopment: false },
    { id: "redevelopment", label: "Redevelopment only", bridge: false, redevelopment: true },
    { id: "combined", label: "Bridge + redevelopment", bridge: true, redevelopment: true },
  ];
  function check(ok, message) {
    if (!ok) throw new Error(`Invalid explanatory scenario: ${message}`);
  }
  function validateConfig(config) {
    check(config?.schema_version === 1 && config.status === "illustrative_not_locally_calibrated"
      && config.reference_index === 100, "configuration status/reference");
    check(typeof config.assumption_note === "string" && config.assumption_note.length > 0, "assumption note");
    check(Array.isArray(config.parameters) && config.parameters.length === ids.length, "parameters");
    const seen = new Set();
    for (const p of config.parameters) {
      check(ids.includes(p.id) && !seen.has(p.id), "unknown/duplicate parameter");
      seen.add(p.id);
      check([p.min, p.max, p.step, p.default].every(Number.isFinite) && p.min < p.max
        && p.step > 0 && p.default >= p.min && p.default <= p.max, "parameter limits/default");
      check(typeof p.label === "string" && typeof p.note === "string"
        && p.note.startsWith("ASSUMPTION:"), "parameter labels");
      check(p.id === "bridgeDemandPercent" ? p.min > -100
        : p.id === "redevelopmentFlowPercent" ? p.min >= 0 : p.min > 0, "unsafe parameter domain");
    }
    return config;
  }
  function defaults(config) {
    validateConfig(config);
    return Object.fromEntries(config.parameters.map((p) => [p.id, p.default]));
  }
  function validateInputs(config, inputs) {
    validateConfig(config);
    for (const p of config.parameters) {
      check(typeof inputs[p.id] === "number" && Number.isFinite(inputs[p.id])
        && inputs[p.id] >= p.min && inputs[p.id] <= p.max, `${p.label} must be between ${p.min} and ${p.max}`);
    }
  }
  function factors(inputs, definition) {
    return {
      demand: definition.bridge ? 1 + inputs.bridgeDemandPercent / 100 : 1,
      extra: definition.redevelopment ? inputs.redevelopmentFlowPercent / 100 : 0,
    };
  }
  function rent(stock, inputs, definition) {
    check(Number.isFinite(stock) && stock > 0, "stock must be positive");
    return factors(inputs, definition).demand * stock ** (-1 / inputs.demandElasticity);
  }
  function delivery(price, inputs, definition) {
    check(Number.isFinite(price) && price >= 0, "value must be nonnegative");
    return (price / inputs.costFactor) ** inputs.supplyElasticity + factors(inputs, definition).extra;
  }
  function solve(config, inputs) {
    validateInputs(config, inputs);
    return definitions.map((definition) => {
      const { extra } = factors(inputs, definition);
      const residual = (stock) => delivery(rent(stock, inputs, definition) / inputs.capRateFactor, inputs, definition)
        - inputs.lossFactor * stock;
      let low = 1e-12, high = Math.max(1, extra / inputs.lossFactor + 1);
      while (residual(high) > 0 && high < 1e12) high *= 2;
      check(residual(low) > 0 && residual(high) <= 0, "could not bracket stock equilibrium");
      for (let i = 0; i < 160; i++) {
        const mid = (low + high) / 2;
        if (residual(mid) > 0) low = mid;
        else high = mid;
      }
      const stock = (low + high) / 2;
      const r = rent(stock, inputs, definition), price = r / inputs.capRateFactor;
      const flow = delivery(price, inputs, definition);
      check([stock, r, price, flow].every((n) => Number.isFinite(n) && n > 0)
        && Math.abs(flow - inputs.lossFactor * stock) < 1e-9, "equilibrium failed stock-flow identity");
      return {
        ...definition, stock, rent: r, price, flow,
        marketFlow: flow - extra, extraFlow: extra,
        shortRunRent: rent(1, inputs, definition),
        shortRunPrice: rent(1, inputs, definition) / inputs.capRateFactor,
      };
    });
  }
  return { definitions, validateConfig, defaults, validateInputs, factors, rent, delivery, solve };
}));
