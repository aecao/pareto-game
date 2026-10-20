const test = require("node:test");
const assert = require("node:assert/strict");
const { boundedValue, bindHandle, dragGeometry } = require("../model-interaction.js");
const configs = [require("../assets/market/far.json"), require("../assets/market/scenario.json")];

test("diagram gestures clamp and snap every parameter to its declared range and precision", () => {
  for (const config of configs) {
    for (const p of config.parameters) {
      assert.equal(boundedValue(p.min - 1000, p), p.min);
      assert.equal(boundedValue(p.max + 1000, p), p.max);
      assert.equal(boundedValue(p.default, p), p.default);
      assert.equal(boundedValue(p.min + p.step * 0.4, p), p.min);
      assert.equal(boundedValue(p.min + p.step * 0.6, p), Number((p.min + p.step).toFixed(10)));
      for (let i = 0; i <= 100; i++) {
        const value = boundedValue(p.min + (p.max - p.min) * i / 100, p);
        assert.ok(value >= p.min && value <= p.max);
        assert.ok(Math.abs((value - p.min) / p.step - Math.round((value - p.min) / p.step)) < 1e-8);
      }
    }
  }
});

test("diagram gestures reject nonfinite values rather than writing invalid assumptions", () => {
  const p = configs[0].parameters[0];
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => boundedValue(value, p), /nonfinite value/);
  }
});

function fixture() {
  class Element extends EventTarget {
    constructor() { super(); this.attributes = {}; this.children = []; this.ownerDocument = doc; }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(child) { this.children.push(child); }
    focus() { doc.activeElement = this; }
    querySelector() {
      return this.children.find((node) => node.attributes["data-parameter"])
        ?? this.children.map((node) => node.querySelector()).find(Boolean);
    }
  }
  const doc = { createElementNS: () => new Element(), activeElement: null };
  const host = new Element();
  const captured = new Set();
  host.setPointerCapture = (id) => captured.add(id);
  host.hasPointerCapture = (id) => captured.has(id);
  host.releasePointerCapture = (id) => captured.delete(id);
  const parameter = { id: "value", label: "Value", min: 0, max: 10, step: 0.1, note: "ASSUMPTION: test" };
  const input = { id: "test-value", value: "5" };
  const geometry = { scale: 1 };
  let updates = 0;
  const render = () => {
    const svg = new Element();
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    host.children = [svg];
    bindHandle(svg, { host, parameter, input, geometry, x: 0, y: 5, label: "Value",
      valueFromPoint: (_x, y) => y, onChange: () => { updates++; render(); } });
  };
  render();
  const send = (target, type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    target.dispatchEvent(event);
  };
  const pointer = { pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 5 };
  return { host, input, geometry, pointer, send, handle: () => host.querySelector(),
    updates: () => updates, focused: () => doc.activeElement };
}

test("keyboard adjustment survives redraw, retains focus and respects configured steps and bounds", () => {
  const f = fixture();
  for (const [key, shiftKey, expected] of [
    ["ArrowUp", false, "5.1"], ["ArrowDown", true, "4.1"],
    ["Home", false, "0"], ["ArrowLeft", false, "0"],
    ["End", false, "10"], ["ArrowRight", false, "10"],
  ]) {
    f.send(f.handle(), "keydown", { key, shiftKey });
    assert.equal(f.input.value, expected);
  }
  assert.equal(f.focused(), f.handle());
  assert.equal(f.updates(), 4);
});

test("captured pointer drags survive SVG redraw and hold geometry until release", () => {
  const f = fixture();
  f.send(f.handle(), "pointerdown", f.pointer);
  assert.equal(f.host.hasPointerCapture(1), true);
  assert.equal(dragGeometry(f.host), f.geometry);
  f.send(f.host, "pointermove", { ...f.pointer, clientY: 7.16 });
  assert.equal(f.input.value, "7.2");
  assert.equal(dragGeometry(f.host), f.geometry);
  f.send(f.host, "pointermove", { ...f.pointer, clientY: 50 });
  assert.equal(f.input.value, "10");
  f.send(f.host, "pointerup", { ...f.pointer, clientY: 50 });
  assert.equal(dragGeometry(f.host), undefined);
  assert.equal(f.focused(), f.handle());
  assert.equal(f.updates(), 3);
});

test("Escape restores the pre-drag value; cancellation keeps the last valid value and releases geometry", () => {
  const f = fixture();
  f.send(f.handle(), "pointerdown", f.pointer);
  f.send(f.host, "pointermove", { ...f.pointer, clientY: 8 });
  f.send(f.host, "keydown", { key: "Escape" });
  assert.equal(f.input.value, "5");
  assert.equal(f.host.hasPointerCapture(1), false);
  assert.equal(dragGeometry(f.host), undefined);
  f.send(f.handle(), "pointerdown", f.pointer);
  f.send(f.host, "pointermove", { ...f.pointer, clientY: 8 });
  f.send(f.host, "pointercancel", f.pointer);
  assert.equal(f.input.value, "8");
  assert.equal(dragGeometry(f.host), undefined);
});

test("Escape preserves precise typed values and blanks rather than quantizing or coercing them", () => {
  for (const initial of ["5.03", ""]) {
    const f = fixture();
    f.input.value = initial;
    f.send(f.handle(), "pointerdown", f.pointer);
    f.send(f.host, "pointermove", { ...f.pointer, clientY: 8 });
    f.send(f.host, "keydown", { key: "Escape" });
    assert.equal(f.input.value, initial);
  }
});

test("grabbing the edge of a handle preserves its offset and unrelated pointers cannot change it", () => {
  const f = fixture();
  f.send(f.handle(), "pointerdown", { ...f.pointer, clientY: 7 });
  f.send(f.host, "pointermove", { ...f.pointer, pointerId: 2, clientY: 10 });
  assert.equal(f.input.value, "5");
  f.send(f.host, "pointermove", { ...f.pointer, clientY: 8 });
  assert.equal(f.input.value, "6");
});
