"use strict";

const publicHousingBoroughs = { 1: "Manhattan", 2: "Bronx", 3: "Brooklyn", 4: "Queens", 5: "Staten Island" };

function publicHousingLabel(key, metadata = incomeData.metadata) {
  return metadata.types.find(t => t.key === key).label;
}

function publicHousingPopup(feature) {
  const p = feature.properties;
  const m = incomeData.metadata;
  const wrapper = incomeNode("div", null, null, { class: "income-popup-content" });
  incomeNode("h2", p.name, wrapper);
  incomeNode("p", `BBL ${p.bbl} · ${publicHousingBoroughs[p.bbl[0]]} CD ${p.cd}`, wrapper);
  incomeNode("p", `${p.units === null ? "Unknown number of" : incomeNumber(p.units)} residential unit${p.units === 1 ? "" : "s"}${p.buildings ? ` in ${incomeNumber(p.buildings)} building${p.buildings === 1 ? "" : "s"}` : ""}${p.year_built ? `, built ${p.year_built}` : ""}.`, wrapper);
  if (p.owner) incomeNode("p", `Owner: ${p.owner}`, wrapper);
  const others = p.types.filter(k => k !== p.primary_type).map(k => publicHousingLabel(k));
  incomeNode("p", `Primary type (color): ${publicHousingLabel(p.primary_type)}.${others.length ? ` Also counted under: ${others.join(", ")}.` : ""}`, wrapper);
  if (p.programs.length) {
    const table = incomeNode("table", null, wrapper);
    incomeNode("caption", "Source program flags and dates", table);
    const head = incomeNode("tr", null, incomeNode("thead", null, table));
    for (const label of ["Program", "Start", "End"]) incomeNode("th", label, head, { scope: "col" });
    const body = incomeNode("tbody", null, table);
    for (const program of p.programs) {
      const row = incomeNode("tr", null, body);
      incomeNode("td", program.code, row);
      incomeNode("td", PublicHousingModel.formatDate(program.start) ?? "—", row);
      incomeNode("td", PublicHousingModel.formatDate(program.end) ?? "—", row);
    }
  }
  incomeNode("p", `Program codes are the source's prog_* fields. ${m.citation}. Points use the source latitude/longitude.`, wrapper);
  return wrapper;
}

function publicHousingLotPopup(feature) {
  const p = feature.properties;
  const m = incomeData.metadata;
  const wrapper = incomeNode("div", null, null, { class: "income-popup-content" });
  incomeNode("h2", `PLUTO lot ${p.bbl}`, wrapper);
  incomeNode("p", `${publicHousingBoroughs[p.bbl[0]]} · MapPLUTO ${m.pluto_version}`, wrapper);
  incomeNode("p", `${p.units === null ? "Unknown number of" : incomeNumber(p.units)} residential unit${p.units === 1 ? "" : "s"} across ${incomeNumber(p.members.length)} propert${p.members.length === 1 ? "y" : "ies"}${p.unknown_units ? ` (${p.unknown_units} with unknown units, not counted)` : ""}.`, wrapper);
  const others = p.types.filter(k => k !== p.primary_type).map(k => publicHousingLabel(k));
  incomeNode("p", `Lot color: ${publicHousingLabel(p.primary_type)} (highest-precedence type on the lot).${others.length ? ` Also on this lot: ${others.join(", ")}.` : ""}`, wrapper);
  if (p.spatial_matches) {
    incomeNode("p", `${p.spatial_matches} propert${p.spatial_matches === 1 ? "y's" : "ies'"} BBL is not in MapPLUTO; assigned to this lot because its point falls inside it.`, wrapper);
  }
  const table = incomeNode("table", null, wrapper);
  incomeNode("caption", "Subsidized properties on this lot", table);
  const head = incomeNode("tr", null, incomeNode("thead", null, table));
  for (const label of ["Property", "Units", "Type"]) incomeNode("th", label, head, { scope: "col" });
  const body = incomeNode("tbody", null, table);
  for (const member of p.members) {
    const row = incomeNode("tr", null, body);
    incomeNode("td", `${member.name} (${member.bbl})${member.bbl === p.bbl ? "" : " *"}`, row);
    incomeNode("td", member.units === null ? "—" : incomeNumber(member.units), row);
    incomeNode("td", publicHousingLabel(member.primary_type), row);
  }
  if (p.members.some(member => member.bbl !== p.bbl)) {
    incomeNode("p", "* Property BBL differs from the lot BBL (condo billing lot, merged lot or spatial match). Switch Display to \"by property\" for program dates.", wrapper);
  }
  incomeNode("p", `${m.citation}.`, wrapper);
  return wrapper;
}

function publicHousingLegend(data, filter) {
  const legend = document.getElementById("public-housing-legend");
  legend.replaceChildren();
  const m = data.metadata;
  const lots = m.dataset === "public_housing_lots";
  const shown = data.features.filter(f => PublicHousingModel.matches(f.properties, filter));
  for (const type of m.types) {
    const count = shown.filter(f => f.properties.primary_type === type.key).length;
    const item = incomeNode("p", null, legend);
    if (lots) {
      for (const color of m.colors[type.key]) incomeNode("span", "\u25a0", item, { style: `color:${color}`, "aria-hidden": "true" });
      incomeNode("span", " ", item);
    } else {
      incomeNode("span", "\u25cf ", item, { style: `color:${type.color}`, "aria-hidden": "true" });
    }
    incomeNode("span", `${type.label} (${incomeNumber(count)} shown)`, item);
  }
  const units = shown.reduce((n, f) => n + (f.properties.units ?? 0), 0);
  if (lots) {
    const b = m.unit_breaks;
    const classes = [`<${b[0]}`, ...b.slice(0, -1).map((v, i) => `${v}-${b[i + 1] - 1}`), `${b.at(-1)}+`];
    const properties = shown.reduce((n, f) => n + f.properties.members.length, 0);
    incomeNode("p", `${incomeNumber(shown.length)} lots (${incomeNumber(properties)} properties), ${incomeNumber(units)} units shown. Shades light to dark: ${classes.join(" | ")} units per lot; unknown units use the lightest shade.`, legend, { class: "section-note" });
  } else {
    incomeNode("p", `${incomeNumber(shown.length)} properties, ${incomeNumber(units)} units shown. Dot area grows with residential units up to ${incomeNumber(m.radius.ref_units)} units; unknown unit counts use the smallest dot.`, legend, { class: "section-note" });
  }
}
