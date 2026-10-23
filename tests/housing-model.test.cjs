const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const model = require("../housing-model.js");
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures/housing", `${name}.csv`), "utf8");
const developments = fixture("developments"), buildings = fixture("buildings");

test("live-sheet fixture sorts seven developments by revenue and separates General", () => {
  const data = model.parse(developments, buildings);
  assert.equal(data.period, "REVENUE BY BUILDING, MONTH TO DATE, 3/31/2026");
  assert.deepEqual(data.developments.map((d) => d.total), [778949, 562185, 259697, 236573, 61676, 44166, 18514]);
  assert.equal(data.developments[0].name, "Manhattan Park");
  assert.equal(data.general.total, 6141014);
  for (const d of data.developments) assert.equal(d.values.reduce((a, b) => a + b), d.total);
  assert.deepEqual(data.developments[1].values, [98144, 0, 401342, 62699]);
});

test("tallest known floor counts preserve missingness and exact development joins", () => {
  const data = model.parse(developments, buildings);
  const southtown = data.developments[1];
  assert.equal(southtown.tallest.floors, 30);
  assert.equal(southtown.buildings.length, 9);
  assert.equal(southtown.buildings.filter((b) => b.floors !== null).length, 7);
  assert.equal(southtown.buildings[0].floors, null);
  assert.equal(data.developments.find((d) => d.name === "Island House").tallest.floors, 19);
  assert.equal(data.developments[0].tallest, null);
  assert.equal(data.warnings.length, 3);
});

test("unit mix groups buildings naturally and preserves unknowns without guessing allocations", () => {
  const data = model.parse(developments, buildings);
  assert.equal(data.unitBuildings.length, 11);
  assert.deepEqual(data.unitBuildings.slice(0, 9).map((b) => b.name),
    Array.from({ length: 9 }, (_, i) => `Southtown Building #${i + 1}`));
  const seventh = data.unitBuildings[6], eighth = data.unitBuildings[7];
  assert.deepEqual(seventh.values, [null, 0, null, 0]);
  assert.equal(seventh.remainder, 266);
  assert.deepEqual(seventh.raw, ["some", "0", "some", "0"]);
  assert.deepEqual(eighth.values, [0, null, null, 341]);
  assert.equal(eighth.remainder, 0);
  const island = data.unitBuildings[9], house = data.unitBuildings[10];
  assert.equal(island.name, "Island House");
  assert.equal(island.total, null);
  assert.equal(island.values.every((v) => v === null), true);
  assert.equal(house.name, "The House");
  assert.equal(house.development, "Unassigned");
  assert.equal(house.total, 352);
  assert.deepEqual(house.values, [0, 0, 352, 0]);
  assert.equal(data.unitBuildings.some((b) => b.name.includes("Reimbursement")), false);
  assert.equal(data.unitBuildings[0].displayName, "Riverwalk 1");
  assert.equal(data.unitBuildings[0].address, "475 Main Street");
  assert.equal(data.unitBuildings[2].displayName, "Riverwalk Place");
  assert.equal(house.address, "1 East Loop Road");
  const fallback = model.parse(developments, buildings.replace(",Riverwalk 1,475 Main Street,", ",,,"));
  assert.equal(fallback.unitBuildings[0].displayName, "Southtown Building #1");
  assert.equal(fallback.unitBuildings[0].address, null);
});

test("CSV supports CRLF, quoted commas, escaped quotes, multiline and BOM", () => {
  assert.deepEqual(model.csv('\uFEFFa,"b,b","c""d"\r\n"x\ny",,0'), [["a", "b,b", 'c"d'], ["x\ny", "", "0"]]);
  assert.throws(() => model.csv('"unclosed'), /Unclosed/);
});

for (const [name, dev, bld, message] of [
  ["changed revenue header", developments.replace("total revenue", "profit"), buildings, /column/],
  ["nonmatching total", developments.replace("562185", "562186"), buildings, /do not match/],
  ["missing revenue", developments.replace("98144", ""), buildings, /Invalid or missing/],
  ["negative revenue", developments.replace("98144", "-98144"), buildings, /Invalid/],
  ["noninteger floors", developments, buildings.replace(",30,83059", ",30.5,83059"), /floors must/],
  ["changed building header", developments, buildings.replace("# floors", "height"), /column/],
  ["changed unit header", developments, buildings.replace("market - rent", "market"), /column/],
  ["invalid unit count", developments, buildings.replace(",0,0,256,0,256", ",0,0,256.5,0,256"), /safe integer/],
  ["inconsistent unit total", developments, buildings.replace(",0,0,256,0,256", ",0,0,257,0,256"), /reconcile/],
]) test(`reject ${name} explicitly`, () => assert.throws(() => model.parse(dev, bld), message));

test("revenue stacks retain exact totals without floor overlays and unit icons preserve exact counts", () => {
  class Node {
    constructor(tag, namespaceURI = "") { this.tag = tag; this.namespaceURI = namespaceURI; this.children = []; this.attributes = {}; }
    append(child) { this.children.push(child); }
    setAttribute(key, value) { this.attributes[key] = value; }
    replaceChildren() { this.children = []; }
    addEventListener() {}
  }
  const nodes = new Map();
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node("div")); return nodes.get(id); },
    createElement: (tag) => new Node(tag),
    createElementNS: (ns, tag) => new Node(tag, ns),
  };
  const context = vm.createContext({ document, HousingModel: model, Intl });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../housing.js"), "utf8"), context);
  context.data = model.parse(developments, buildings);
  vm.runInContext("renderHousing(data)", context);
  const svg = nodes.get("housing-chart").children[0];
  const rects = svg.children.filter((n) => n.attributes.class === "housing-revenue");
  assert.equal(rects.length, 28);
  const maximum = 778949 * 1.12;
  context.data.developments.forEach((d, index) => {
    const parts = rects.slice(index * 4, index * 4 + 4);
    let stacked = 0;
    parts.forEach((rect, component) => {
      const height = Number(rect.attributes.height);
      assert.ok(Math.abs(height - d.values[component] / maximum * 375) < 1e-9);
      assert.ok(Math.abs(Number(rect.attributes.y) + height + stacked - 440) < 1e-9);
      stacked += height;
    });
    assert.ok(Math.abs(stacked - d.total / maximum * 375) < 1e-9);
  });
  for (let i = 0; i < 6; i++) {
    const a = rects[i * 4].attributes, b = rects[(i + 1) * 4].attributes;
    assert.ok(Math.abs(Number(a.x) + Number(a.width) - Number(b.x)) < 1e-9);
  }
  const groups = svg.children.filter((n) => n.attributes.class === "housing-building");
  assert.equal(groups.length, 0);
  assert.equal(svg.children.some((n) => /floors/i.test(n.textContent || "")), false);
  assert.equal(nodes.get("housing-values").children.length, 7);
  assert.equal(nodes.get("housing-values").children[0].children.length, 6);
  const unitSvg = nodes.get("housing-unit-chart").children[0];
  const categories = unitSvg.children.filter((n) => n.attributes.class === "housing-unit-category");
  const barWidth = (Number(unitSvg.attributes.viewBox.split(" ")[2]) - 110) / 11;
  const bottom = 65 + Math.ceil(357 / 10) * 11;
  context.data.unitBuildings.forEach((b, index) => {
    const groups = categories.filter((g) => g.attributes["data-building"] === b.name);
    const center = 70 + (index + 0.5) * barWidth;
    let unitsDrawn = 0;
    [...b.values, b.remainder].forEach((count, component) => {
      const group = groups.find((g) => g.attributes["data-category"] === String(component));
      const icons = group ? group.children.filter((n) => n.attributes.class === "housing-unit-icon") : [];
      assert.equal(icons.length, count ?? 0, `${b.name}: category ${component}`);
      for (const icon of icons) {
        assert.equal(Number(icon.attributes.width), 8);
        assert.equal(Number(icon.attributes.height), 8);
        assert.equal(icon.attributes.fill, model.unitComponents[component].color);
        assert.ok(Math.abs(Number(icon.attributes.x) - (center - 107 / 2 + (unitsDrawn % 10) * 11)) < 1e-9);
        assert.equal(Number(icon.attributes.y), bottom - Math.floor(unitsDrawn / 10) * 11 - 8);
        unitsDrawn++;
      }
    });
    assert.equal(unitsDrawn, b.total ?? b.known);
  });
  assert.equal(nodes.get("housing-unit-values").children.length, 11);
  const labels = unitSvg.children.filter((n) => n.attributes.class === "housing-building-name");
  const addresses = unitSvg.children.filter((n) => n.attributes.class === "housing-building-address");
  assert.equal(labels[0].children.map((n) => n.textContent).join(" "), "Riverwalk 1");
  assert.equal(addresses[0].children.map((n) => n.textContent).join(" "), "475 Main Street");
  assert.ok(Number(addresses[0].attributes.y) > Number(labels[0].attributes.y));
  assert.equal(nodes.get("housing-unit-values").children[0].children[0].children[0].textContent, "Riverwalk 1");
});
