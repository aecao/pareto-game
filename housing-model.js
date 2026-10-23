"use strict";

(function (root) {
  const components = [
    { label: "Operating fund revenue", column: 4, color: "#0035ff" },
    { label: "Capital fund revenue", column: 6, color: "#839cff" },
    { label: "Ground rent", column: 9, color: "#2a6c68" },
    { label: "Public safety reimbursement", column: 10, color: "#b8432f" },
  ];
  const unitComponents = [
    { label: "Market-rent", column: 10, color: "#0035ff" },
    { label: "Market-condo", column: 11, color: "#839cff" },
    { label: "Institutional", column: 12, color: "#2a6c68" },
    { label: "Affordable", column: 13, color: "#b8432f" },
    { label: "Unclassified remainder", color: "#ccc" },
  ];

  function csv(text) {
    const rows = [], row = [];
    let value = "", quoted = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { value += '"'; i++; }
        else if (quoted || value === "") quoted = !quoted;
        else throw new Error("Unexpected quote in sheet CSV.");
      } else if (c === "," && !quoted) { row.push(value); value = ""; }
      else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(value); rows.push(row.splice(0)); value = "";
      } else value += c;
    }
    if (quoted) throw new Error("Unclosed quote in sheet CSV.");
    if (value !== "" || row.length) { row.push(value); rows.push(row); }
    return rows;
  }

  function number(value, label, optional = false) {
    const text = (value || "").trim();
    if (!text && optional) return null;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
      throw new Error(`Invalid or missing ${label}: "${text}".`);
    }
    const result = Number(text.replaceAll(",", ""));
    if (!Number.isFinite(result)) throw new Error(`Nonfinite ${label}.`);
    return result;
  }

  function parse(developmentCsv, buildingCsv) {
    const rows = csv(developmentCsv), buildings = csv(buildingCsv);
    const header = rows[1]?.map((s) => s.trim().toLowerCase());
    for (const [index, label] of [[0, "development"], [1, "# buildings"], [4, "revenue"],
      [6, "revenue"], [9, "ground rent"], [10, "public safety reimbursement"], [11, "total revenue"]]) {
      if (header?.[index] !== label) throw new Error(`Developments column ${index + 1} must be "${label}".`);
    }
    if (!rows[0]?.[0]?.startsWith("REVENUE BY BUILDING")) throw new Error("Missing revenue period heading.");
    for (const [index, label] of [[0, "building"], [1, "development"], [3, "aka"], [4, "address"], [6, "# floors"],
      [10, "market - rent"], [11, "market - condo"], [12, "institutional"], [13, "affordable"], [14, "total units"]]) {
      if (buildings[0]?.[index]?.trim().toLowerCase() !== label) throw new Error(`Buildings column ${index + 1} must be "${label}".`);
    }
    const developments = [], names = new Set(), warnings = [];
    let general = null;
    for (const row of rows.slice(2)) {
      if (!row.some((cell) => cell.trim())) break;
      const name = row[0]?.trim();
      if (!name || names.has(name)) throw new Error("Missing or duplicate development name.");
      names.add(name);
      const values = components.map((c) => number(row[c.column], `${name}: ${c.label}`));
      const total = number(row[11], `${name}: total revenue`);
      if (Math.abs(values.reduce((a, b) => a + b, 0) - total) > 0.005) throw new Error(`${name}: revenue components do not match total.`);
      const count = number(row[1], `${name}: building count`, name === "General");
      if (count !== null && (!Number.isInteger(count) || count < 1)) throw new Error(`${name}: invalid building count.`);
      const item = { name, values, total, count, buildings: [], tallest: null };
      if (name === "General") general = item;
      else developments.push(item);
    }
    if (!developments.length) throw new Error("No development revenue records found.");
    const byName = new Map(developments.map((d) => [d.name, d]));
    const unitBuildings = [], buildingNames = new Set();
    for (const row of buildings.slice(1)) {
      const name = row[0]?.trim() || row[3]?.trim(), development = row[1]?.trim();
      if (!name) continue;
      const displayName = row[3]?.trim() || name, address = row[4]?.trim() || null;
      const hasUnits = row.slice(10, 15).some((cell) => cell.trim());
      if (hasUnits || byName.has(development)) {
        const key = `${development || "Unassigned"}|${name}`;
        if (buildingNames.has(key)) throw new Error(`Duplicate building: ${name}.`);
        buildingNames.add(key);
        const count = (value, label) => {
          if (value?.trim().toLowerCase() === "some") return null;
          const result = number(value, label, true);
          if (result !== null && !Number.isSafeInteger(result)) throw new Error(`${label}: units must be a nonnegative safe integer.`);
          return result;
        };
        const raw = unitComponents.slice(0, 4).map((c) => row[c.column]?.trim() || "");
        const values = raw.map((value, index) => count(value, `${name}: ${unitComponents[index].label}`));
        const total = count(row[14], `${name}: total units`);
        const known = values.reduce((sum, value) => sum + (value ?? 0), 0);
        if (total !== null && (known > total || (values.every((v) => v !== null) && known !== total))) {
          throw new Error(`${name}: unit categories do not reconcile with reported total.`);
        }
        unitBuildings.push({ name, displayName, address, development: development || "Unassigned", values, raw, total, known,
          remainder: total === null ? null : total - known });
      }
      if (!development || !byName.has(development)) {
        warnings.push(`Building row "${name}" has no matched development; not used for floors.`);
        continue;
      }
      const floors = number(row[6], `${name}: floors`, true);
      if (floors !== null && (!Number.isInteger(floors) || floors < 1 || floors > 300)) throw new Error(`${name}: floors must be an integer from 1 to 300.`);
      const item = byName.get(development);
      if (item.buildings.some((b) => b.name === name)) throw new Error(`Duplicate building: ${name}.`);
      item.buildings.push({ name, displayName, address, floors });
      if (floors !== null && (item.tallest === null || floors > item.tallest.floors)) item.tallest = { name, displayName, address, floors };
    }
    for (const d of developments) {
      if (d.buildings.length > d.count) warnings.push(`${d.name}: linked building rows exceed the reported building count.`);
    }
    developments.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "en"));
    const order = new Map(developments.map((d, index) => [d.name, index]));
    unitBuildings.sort((a, b) => (order.get(a.development) ?? developments.length) - (order.get(b.development) ?? developments.length)
      || a.development.localeCompare(b.development, "en")
      || a.name.localeCompare(b.name, "en", { numeric: true }));
    return { period: rows[0][0], developments, general, warnings, unitBuildings };
  }

  const api = { csv, parse, components, unitComponents };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HousingModel = api;
})(globalThis);
