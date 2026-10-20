(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModelInteraction = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const hosts = new WeakMap();

  function boundedValue(value, parameter) {
    if (!Number.isFinite(value)) throw new Error(`Cannot adjust ${parameter.label}: nonfinite value.`);
    const bounded = Math.max(parameter.min, Math.min(parameter.max, value));
    const snapped = parameter.min + Math.round((bounded - parameter.min) / parameter.step) * parameter.step;
    return Math.max(parameter.min, Math.min(parameter.max, Number(snapped.toFixed(10))));
  }

  function bindHandle(svg, options) {
    const { host, parameter, input, onChange, x, y, label, valueFromPoint, geometry, orientation = "vertical",
      labelX = 15, labelY = -14 } = options;
    let state = hosts.get(host);
    if (!state) {
      state = { active: null };
      hosts.set(host, state);
      const move = (event) => {
        const active = state.active;
        if (!active || event.pointerId !== active.pointerId) return;
        event.preventDefault();
        const point = active.point.matrixTransform(active.inverse);
        active.point.x = event.clientX;
        active.point.y = event.clientY;
        const current = active.point.matrixTransform(active.inverse);
        if (point.x === current.x && point.y === current.y) return;
        active.apply(active.valueFromPoint(current.x + active.offset.x, current.y + active.offset.y));
      };
      host.addEventListener("pointermove", move);
      const finish = (event) => {
        if (state.active?.pointerId !== event.pointerId) return;
        const active = state.active;
        state.active = null;
        active.onChange();
        host.querySelector(`[data-parameter="${active.parameterId}"]`)?.focus({ preventScroll: true });
      };
      host.addEventListener("pointerup", (event) => {
        move(event);
        finish(event);
      });
      for (const type of ["pointercancel", "lostpointercapture"]) {
        host.addEventListener(type, finish);
      }
      host.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !state.active) return;
        event.preventDefault();
        const active = state.active;
        state.active = null;
        active.input.value = active.initial;
        active.onChange();
        host.querySelector(`[data-parameter="${active.parameterId}"]`)?.focus({ preventScroll: true });
        if (host.hasPointerCapture(active.pointerId)) host.releasePointerCapture(active.pointerId);
      });
    }
    const node = (tag, attributes, parent, text) => {
      const element = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
      if (text !== undefined) element.textContent = text;
      parent.append(element);
      return element;
    };
    const handle = node("g", { class: "model-handle", transform: `translate(${x} ${y})`, tabindex: 0,
      role: "slider", "data-parameter": parameter.id, "aria-label": parameter.label,
      "aria-valuemin": parameter.min, "aria-valuemax": parameter.max, "aria-valuenow": input.value,
      "aria-valuetext": `${input.value}. ${parameter.note}`, "aria-orientation": orientation,
      "aria-describedby": `${input.id}-note`,
    }, svg);
    node("title", {}, handle, `${parameter.label}: ${input.value}. Drag ${orientation === "horizontal" ? "left/right" : "up/down"}; arrow keys adjust, Home/End select limits. Escape cancels a drag.`);
    node("circle", { r: 14, class: "model-handle-hit" }, handle);
    node("circle", { r: 6, class: "model-handle-dot" }, handle);
    node("text", { x: labelX, y: labelY, "text-anchor": labelX < 0 ? "end" : "start" }, handle, label);
    const apply = (value) => {
      const next = boundedValue(value, parameter);
      if (input.value.trim() !== "" && Number(input.value) === next) return;
      input.value = String(next);
      onChange();
      host.querySelector(`[data-parameter="${parameter.id}"]`)?.focus({ preventScroll: true });
    };
    handle.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0 || state.active) return;
      event.preventDefault();
      const matrix = svg.getScreenCTM();
      if (!matrix) throw new Error("Cannot start diagram drag: SVG screen transform unavailable.");
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const inverse = matrix.inverse();
      const start = point.matrixTransform(inverse);
      state.active = { pointerId: event.pointerId, inverse, point, apply,
        offset: { x: x - start.x, y: y - start.y }, valueFromPoint,
        initial: input.value, input, geometry, onChange, parameterId: parameter.id };
      handle.focus({ preventScroll: true });
      host.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("keydown", (event) => {
      const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
      if (!direction && !["Home", "End"].includes(event.key)) return;
      event.preventDefault();
      apply(event.key === "Home" ? parameter.min : event.key === "End" ? parameter.max
        : Number(input.value) + direction * parameter.step * (event.shiftKey ? 10 : 1));
    });
    return handle;
  }
  function dragGeometry(host) {
    return hosts.get(host)?.active?.geometry;
  }
  return { boundedValue, bindHandle, dragGeometry };
}));
