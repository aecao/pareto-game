(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModelInteraction = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const hosts = new WeakMap();
  const tooltips = new WeakMap();
  const definitions = {
    rent: "Rent is what occupants pay to use housing. Here it means annual rent per unit of housing area, shown as an index rather than dollars.",
    price: "Price is what an investor would pay to own housing, per unit of housing area. It is different from the rent paid to use it. Here it is an index, not a dollar appraisal.",
    stock: "Stock is all the housing space that exists at a point in time, like water already in a tank. Here it is an index of floor area, not a measured square-foot total.",
    construction: "Construction is new housing space delivered each year, like water flowing into a tank. Here it is net of project removals but before background losses. It is a flow, not the total housing stock.",
    valuation: "Asset Market: Valuation asks how rental income translates into an ownership price. For example, investors may pay more for a building when its income rises or when they accept a lower return. This simplified model treats net income as a constant share of rent.",
    rentDetermination: "Property Market: Rent Determination asks what rent balances demand for housing space with the space available. For example, if more households want the same amount of housing, rent tends to rise in this model.",
    constructionMarket: "Asset Market: Construction asks how much new housing gets delivered when property values change relative to development costs. For example, higher values can make more construction worthwhile. This teaching model does not check actual project feasibility.",
    stockAdjustment: "Property Market: Stock Adjustment tracks how deliveries and losses change the amount of housing. If annual additions exceed losses, stock grows. The long-run balance shown here has additions equal to losses.",
    bridgeDemandPercent: "Demand shift changes how much people are assumed willing to pay at the same housing stock. For example, +40% means rent demand at a fixed stock is 40% higher. It is a deliberately strong teaching assumption, not a measured bridge premium.",
    demandElasticity: "Demand elasticity describes how strongly the amount of housing people want responds to rent. At an elasticity of 1, a small 1% rent increase reduces space demanded by about 1%, holding other factors fixed. Larger values mean a stronger response.",
    capRateFactor: "The cap rate links annual net rental income to an ownership price: price equals income divided by the cap rate. For example, $50,000 of annual net income at 5% implies $1 million. This handle multiplies an unspecified reference rate; 1 does not mean a 1% cap rate.",
    costFactor: "Delivery cost changes the property value needed to support construction. A higher multiplier means development is harder to justify at the same value, so less market housing is delivered. It is a relative assumption, not a dollar cost estimate.",
    supplyElasticity: "Supply elasticity describes how strongly annual market construction responds to property value relative to cost. At an elasticity of 1, a small 1% increase in that ratio raises market delivery by about 1%. Larger values mean a stronger response; extra delivery is separate.",
    redevelopmentFlowPercent: "Extra delivery adds an assumed, sustained flow of housing beyond the market response. For example, 40% adds 40 units of annual flow if the reference annual flow is 100. It is not 40% of all existing housing, and funding is assumed rather than demonstrated.",
    lossFactor: "Stock loss represents housing space leaving use, for example through demolition or retirement. A multiplier of 2 doubles losses per unit of stock relative to the unspecified reference rate. It does not mean 2% of housing disappears each year.",
    priceIntercept: "Price level moves the housing sale-price curve up or down. It is the assumed value per unit of housing area at FAR zero, used as a starting point for the line, not the price of an actual zero-size building. Values are arbitrary, not dollars.",
    priceSlope: "Price slope controls how quickly assumed sale value per unit of housing area falls as FAR rises. For example, a slope of 15 lowers that value by 15 arbitrary units for each extra unit of FAR. This density tradeoff is an assumption, not a measured local effect.",
    costIntercept: "Cost level moves the average non-land development-cost curve up or down. It is the line's starting cost per unit of housing area at FAR zero. Land is excluded; this is an illustrative cost level, not an actual project estimate.",
    costSlope: "Cost slope controls how quickly average non-land cost per unit of housing area rises with FAR. For example, a slope of 10 adds 10 arbitrary cost units for each extra unit of FAR. Average cost is not the marginal cost of the next square foot.",
    farCap: "The FAR ceiling limits floor area relative to land area. FAR 4 allows four units of gross residential floor area per unit of lot area: a 10,000 sq. ft. lot would allow 40,000 sq. ft. in this illustration. This is a hypothetical ceiling, not verified zoning; building to it is not always optimal.",
  };

  function hideDefinition(doc) {
    const state = tooltips.get(doc);
    if (!state) return;
    clearTimeout(state.timer);
    state.tooltip.hidden = true;
    state.target = null;
  }

  function bindDefinition(target, key) {
    const definition = definitions[key];
    if (!definition) throw new Error(`Unknown diagram definition: ${key}`);
    const doc = target.ownerDocument;
    let state = tooltips.get(doc);
    if (!state) {
      const tooltip = doc.createElement("div");
      tooltip.id = "model-definition";
      tooltip.className = "model-definition";
      tooltip.setAttribute("role", "tooltip");
      tooltip.hidden = true;
      doc.body.append(tooltip);
      state = { tooltip, target: null, timer: null };
      tooltips.set(doc, state);
      tooltip.addEventListener("pointerenter", () => clearTimeout(state.timer));
      tooltip.addEventListener("pointerleave", () => hideDefinition(doc));
      doc.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hideDefinition(doc);
      });
      doc.addEventListener("pointerdown", () => hideDefinition(doc), true);
      doc.addEventListener("focusin", (event) => {
        if (state.target && !state.target.contains(event.target)) hideDefinition(doc);
      });
      doc.addEventListener("scroll", () => {
        if (state.target) state.position();
      }, true);
      doc.defaultView.addEventListener("resize", () => hideDefinition(doc));
    }
    const describedBy = target.getAttribute("aria-describedby");
    const description = doc.createElementNS("http://www.w3.org/2000/svg", "desc");
    description.id = `model-definition-${key}`;
    description.textContent = definition;
    target.append(description);
    target.setAttribute("aria-describedby", [describedBy, description.id].filter(Boolean).join(" "));
    target.setAttribute("data-definition", key);
    const position = () => {
      const rect = target.getBoundingClientRect();
      if (!target.isConnected || rect.width === 0 || rect.height === 0
        || rect.bottom < 0 || rect.top > doc.defaultView.innerHeight) {
        hideDefinition(doc);
        return;
      }
      const box = state.tooltip.getBoundingClientRect();
      const width = doc.documentElement.clientWidth, height = doc.defaultView.innerHeight;
      state.tooltip.style.left = `${Math.max(8, Math.min(rect.left, width - box.width - 8))}px`;
      const below = rect.bottom + 10;
      state.tooltip.style.top = `${Math.max(8, Math.min(below + box.height <= height ? below
        : rect.top - box.height - 10, height - box.height - 8))}px`;
    };
    const show = () => {
      const host = target.closest(".scenario-chart, .far-chart");
      if (host && hosts.get(host)?.active) return;
      clearTimeout(state.timer);
      state.target = target;
      state.position = position;
      state.tooltip.textContent = definition;
      state.tooltip.hidden = false;
      position();
    };
    target.addEventListener("pointerenter", show);
    target.addEventListener("focus", show);
    target.addEventListener("pointerleave", () => {
      if (state.target === target) state.timer = setTimeout(() => hideDefinition(doc), 180);
    });
    target.addEventListener("blur", () => {
      if (state.target === target) hideDefinition(doc);
    });
    target.addEventListener("pointerdown", () => hideDefinition(doc));
  }

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
    const instructions = node("desc", { id: `${input.id}-drag-help` }, handle,
      `Drag ${orientation === "horizontal" ? "left/right" : "up/down"}; arrow keys adjust, Home/End select limits. Escape cancels a drag.`);
    handle.setAttribute("aria-describedby", `${input.id}-note ${instructions.id}`);
    node("circle", { r: 14, class: "model-handle-hit" }, handle);
    node("circle", { r: 6, class: "model-handle-dot" }, handle);
    node("text", { x: labelX, y: labelY, "text-anchor": labelX < 0 ? "end" : "start" }, handle, label);
    if (Object.hasOwn(definitions, parameter.id)) bindDefinition(handle, parameter.id);
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
      hideDefinition(svg.ownerDocument);
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
  return { boundedValue, bindHandle, dragGeometry, bindDefinition, hideDefinition, definitions };
}));
