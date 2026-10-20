(function (root) {
  "use strict";

  const componentKeys = ["accommodation", "removal", "assembly"];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const nonnegative = (value) => finite(value) && value >= 0;

  function validateParameters(parameters) {
    if (!parameters || !Number.isSafeInteger(parameters.units) || parameters.units <= 0) {
      throw new Error("New affordable units must be a positive whole number.");
    }
    if (!finite(parameters.unitSize) || parameters.unitSize <= 0) {
      throw new Error("Net unit size must be greater than zero.");
    }
    if (!finite(parameters.efficiency) || parameters.efficiency <= 0 || parameters.efficiency > 1) {
      throw new Error("Net-to-gross efficiency must be greater than 0% and at most 100%.");
    }
    if (!parameters.weights || componentKeys.some((key) => !nonnegative(parameters.weights[key]))) {
      throw new Error("Each ranking weight must be a nonnegative number.");
    }
    const total = componentKeys.reduce((sum, key) => sum + parameters.weights[key], 0);
    if (Math.abs(total - 1) > 1e-9) {
      throw new Error("Ranking weights must total 100%.");
    }
    const area = parameters.units * parameters.unitSize / parameters.efficiency;
    if (!finite(area) || area <= 0) throw new Error("The requested floor area is outside the supported numeric range.");
    return area;
  }

  function validateSites(sites) {
    if (!Array.isArray(sites) || !sites.length) throw new Error("The pilot has no candidate sites.");
    const ids = new Set();
    for (const site of sites) {
      if (typeof site.site_id !== "string" || !site.site_id || ids.has(site.site_id)) {
        throw new Error("Pilot site IDs must be present and unique.");
      }
      ids.add(site.site_id);
      if (typeof site.rankable !== "boolean" || !Number.isSafeInteger(site.lot_count) || site.lot_count <= 0) {
        throw new Error(`Invalid ranking eligibility or lot count: ${site.site_id}`);
      }
      for (const key of ["base_far_proxy_gsf", "existing_units_removed", "lot_area_sqft"]) {
        if (site[key] !== null && !nonnegative(site[key])) throw new Error(`Invalid ${key}: ${site.site_id}`);
      }
      if (site.rankable && (site.lot_count < 2 || site.base_far_proxy_gsf === null || site.existing_units_removed === null)) {
        throw new Error(`Rankable site has incomplete inputs: ${site.site_id}`);
      }
      if (!site.rankable && (typeof site.unranked_reason !== "string" || !site.unranked_reason)) {
        throw new Error(`Unranked site is missing its reason: ${site.site_id}`);
      }
    }
  }

  function calculate(sites, parameters) {
    const requiredGsf = validateParameters(parameters);
    validateSites(sites);
    const cohort = sites.filter((site) => site.rankable);
    const range = (key) => {
      const values = cohort.map((site) => site[key]);
      return [Math.min(...values), Math.max(...values)];
    };
    const removalRange = range("existing_units_removed");
    const assemblyRange = range("lot_count");
    const inverse = (value, [low, high]) => high === low ? 1 : (high - value) / (high - low);
    const results = sites.map((site) => {
      const proxyUnits = site.base_far_proxy_gsf === null
        ? null : site.base_far_proxy_gsf * parameters.efficiency / parameters.unitSize;
      const components = {
        accommodation: site.base_far_proxy_gsf === null ? null : Math.min(site.base_far_proxy_gsf / requiredGsf, 1),
        removal: site.rankable ? inverse(site.existing_units_removed, removalRange) : null,
        assembly: site.rankable ? inverse(site.lot_count, assemblyRange) : null,
      };
      const score = site.rankable ? 100 * componentKeys.reduce(
        (sum, key) => sum + components[key] * parameters.weights[key], 0,
      ) : null;
      const requiredFar = site.lot_area_sqft > 0 ? requiredGsf / site.lot_area_sqft : null;
      if ((proxyUnits !== null && !finite(proxyUnits)) || (requiredFar !== null && !finite(requiredFar))) {
        throw new Error("The requested unit size or floor area is outside the supported numeric range.");
      }
      return {
        ...site, components, score, rank: null, requiredGsf, proxyUnits,
        requiredFar,
        shortfall: proxyUnits === null ? null : Math.max(parameters.units - proxyUnits, 0),
        targetMet: site.base_far_proxy_gsf === null ? null : site.base_far_proxy_gsf >= requiredGsf,
        netUnits: site.existing_units_removed === null ? null : parameters.units - site.existing_units_removed,
      };
    });
    results.sort((a, b) => {
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
      if (a.score !== b.score) return b.score - a.score;
      return a.site_id < b.site_id ? -1 : a.site_id > b.site_id ? 1 : 0;
    });
    let previousScore = null;
    let rank = null;
    results.forEach((site, index) => {
      if (site.score === null) return;
      if (site.score !== previousScore) rank = index + 1;
      site.rank = rank;
      previousScore = site.score;
    });
    return {
      sites: results, requiredGsf, ranked: cohort.length,
      unranked: sites.length - cohort.length,
      targetMet: results.filter((site) => site.rankable && site.targetMet).length,
    };
  }

  const api = { calculate, validateParameters, validateSites };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SitingModel = api;
})(globalThis);
