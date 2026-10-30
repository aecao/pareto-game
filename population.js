"use strict";

function populationPopup(feature) {
  const p = feature.properties;
  const wrapper = incomeNode("div", null, null, { class: "income-popup-content" });
  incomeNode("h2", p.name, wrapper);
  incomeNode("p", `${IncomeModel.scales[p.scale].label} ${p.geoid}`, wrapper);
  incomeNode("p", `${incomeNumber(p.total)} residents +/- ${incomeNumber(p.total_moe)} (${p.scale === "block_group" ? "original" : "approximate"} 90% margin of error).`, wrapper);
  incomeNode("p", p.density === null ? "No land area: population density is not applicable."
    : `${incomeNumber(Math.round(p.density))} people per square mile of land.`, wrapper);
  incomeNode("p", `Land area: ${p.land_sq_miles.toLocaleString("en-US", { maximumFractionDigits: 4 })} square miles (${Math.round(p.land_sqft).toLocaleString("en-US")} square US feet). Water is excluded from the denominator.`, wrapper);
  if (p.total === 0) incomeNode("p", "Zero estimated residents, not missing data.", wrapper);
  incomeNode("p", "2020-2024 ACS five-year B01003 via IPUMS NHGIS. Survey estimates, not an exact census count or a 2024 point-in-time population.", wrapper);
  if (p.scale !== "block_group") {
    incomeNode("p", `Sum of ${incomeNumber(p.member_count)} whole block groups. Approximate 90% MOE uses root sum of squared source MOEs, rounded up; covariance is unavailable. Density uses summed population divided by summed official land area, not an average of block-group densities.`, wrapper);
  }
  if (p.scale === "neighborhood") incomeNode("p", p.custom_neighborhood
    ? "Custom split: Roosevelt Island is tracts 238.02, 238.03 and 238.04, separated from Upper East Side-Lenox Hill."
    : "2020 NTA relationships applied to whole 2024 TIGER block groups, including special areas.", wrapper);
  incomeNode("p", "Full area polygons include water for selection; fill color encodes density on land, not residents living on water.", wrapper);
  return wrapper;
}

function populationLegend(data) {
  const legend = document.getElementById("population-legend");
  legend.replaceChildren();
  const m = data.metadata;
  const labels = [
    `Under ${incomeNumber(m.breaks[0])}`,
    ...m.breaks.slice(0, -1).map((low, i) => `${incomeNumber(low)} to under ${incomeNumber(m.breaks[i + 1])}`),
    `${incomeNumber(m.breaks.at(-1))} or more`,
    "No land area: density not applicable",
  ];
  labels.forEach((label, index) => {
    const item = incomeNode("p", null, legend);
    incomeNode("span", "\u25a0 ", item, { style: `color:${[...m.colors, m.no_land_color][index]}`, "aria-hidden": "true" });
    incomeNode("span", label, item);
  });
}
