"use strict";

const housingModeLabels = {
  renter: "Renter-majority",
  mixed: "Mixed",
  owner: "Owner-majority",
};
const housingModeSources = {
  block_group: "its block group",
  tract: "its census tract (block-group cell had no occupied units)",
  pilot: "the whole pilot area (block-group and tract cells had no occupied units)",
};

function housingModePopup(feature) {
  const p = feature.properties;
  const m = incomeData.metadata;
  const wrapper = incomeNode("div", null, null, { class: "income-popup-content" });
  const percent = value => `${Math.round(value * 100)}%`;
  incomeNode("h2", p.name, wrapper);
  incomeNode("p", `BBL ${p.bbl} · Building class ${p.bldg_class || "unknown"} · PLUTO LandUse ${p.land_use}`, wrapper);
  incomeNode("p", `${incomeNumber(p.units)} residential unit${p.units === 1 ? "" : "s"} in ${incomeNumber(p.buildings)} building${p.buildings === 1 ? "" : "s"}${p.year_built ? `, built ${p.year_built}` : ""}. Units, not residents.`, wrapper);
  incomeNode("p", `${housingModeLabels[p.tenure_group]}: modeled ${percent(p.owner_share)} owner-occupied, ${percent(1 - p.owner_share)} renter-occupied.`, wrapper);
  incomeNode("p", `Estimate from ACS B25032 for ${p.bucket}-unit structures in ${housingModeSources[p.share_source]} (${p.geoid}): ${incomeNumber(p.acs_owner)} owner and ${incomeNumber(p.acs_renter)} renter occupied units.`, wrapper);
  if (p.condo) incomeNode("p", "Condominium billing lot: the polygon carries all condo units. ACS cannot identify condos; the share reflects nearby structures of the same size, not this building.", wrapper);
  incomeNode("p", `Area-level survey estimate applied to this lot; not the lot's actual tenure. ${m.source}; MapPLUTO ${m.pluto_version}.`, wrapper);
  return wrapper;
}

function housingModeLegend(data) {
  const legend = document.getElementById("housing-mode-legend");
  legend.replaceChildren();
  const m = data.metadata;
  const table = incomeNode("table", null, legend, { class: "housing-mode-legend-table" });
  incomeNode("caption", "Color: modeled tenure. Darkness: residential units per lot.", table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  incomeNode("th", "Units", head, { scope: "col" });
  for (const group of HousingModeModel.groups) incomeNode("th", housingModeLabels[group], head, { scope: "col" });
  const body = incomeNode("tbody", null, table);
  m.unit_labels.forEach((label, index) => {
    const row = incomeNode("tr", null, body);
    incomeNode("th", label, row, { scope: "row" });
    for (const group of HousingModeModel.groups) {
      const cell = incomeNode("td", null, row);
      incomeNode("span", null, cell, { class: "housing-mode-swatch", style: `background:${m.colors[group][index]}`,
        role: "img", "aria-label": `${housingModeLabels[group]}, ${label} units` });
    }
  });
  const [low, high] = m.owner_share_breaks;
  incomeNode("p", `Renter-majority: under ${low * 100}% owner-occupied. Mixed: ${low * 100}-${high * 100}%. Owner-majority: over ${high * 100}%.`, legend);
}
