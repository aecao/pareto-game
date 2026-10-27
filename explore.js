"use strict";

const exploreLayers = new Map();
const exploreCache = new Map();
let exploreIndex = null;
let exploreIndexLoading = false;
let exploreController = null;
let exploreEpoch = 0;
let exploreMoveTimer = null;
const exploreState = document.getElementById("explore-state");
const exploreRetry = document.getElementById("explore-retry");

function exploreNode(tag, text, parent, attributes = {}) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

function exploreCheckbox(parent, text, checked, onChange) {
  const label = exploreNode("label", null, parent, { class: "explore-check" });
  const checkbox = exploreNode("input", null, label, { type: "checkbox" });
  checkbox.checked = checked;
  checkbox.addEventListener("change", onChange);
  exploreNode("span", text, label);
  return checkbox;
}

function syncExploreControls(state) {
  state.master.checked = state.enabled;
  state.all.checked = state.selected.size === state.definition.categories.length;
  state.all.indeterminate = state.selected.size > 0 && !state.all.checked;
  for (const [id, input] of state.inputs) input.checked = state.selected.has(id);
}

function renderExploreControls() {
  const container = document.getElementById("explore-layers");
  container.replaceChildren();
  for (const definition of exploreIndex.layers) {
    const state = {
      definition, enabled: definition.visible, selected: new Set(definition.categories.map((category) => category.id)),
      group: L.featureGroup(), renderer: L.canvas({ padding: 0.2 }), inputs: new Map(),
    };
    exploreLayers.set(definition.id, state);
    const section = exploreNode("section", null, container, { class: "explore-layer" });
    const heading = exploreNode("div", null, section, { class: "explore-filter-heading" });
    const expanded = !definition.collapsed;
    const toggle = exploreNode("button", null, heading, {
      type: "button", class: "explore-filter-toggle", "aria-expanded": String(expanded),
      "aria-controls": `explore-categories-${definition.id}`,
    });
    const chevron = exploreNode("span", expanded ? "\u25be" : "\u25b8", toggle, { "aria-hidden": "true" });
    exploreNode("span", definition.label, toggle);
    state.master = exploreCheckbox(heading, "", state.enabled, () => {
      state.enabled = state.master.checked;
      if (state.enabled && !state.selected.size) state.selected = new Set(definition.categories.map((category) => category.id));
      syncExploreControls(state);
      updateExplore();
    });
    state.master.setAttribute("aria-label", `Show ${definition.label}`);
    const content = exploreNode("div", null, section, {
      id: `explore-categories-${definition.id}`, class: "explore-filter-content",
    });
    content.hidden = !expanded;
    toggle.addEventListener("click", () => {
      content.hidden = !content.hidden;
      toggle.setAttribute("aria-expanded", String(!content.hidden));
      chevron.textContent = content.hidden ? "\u25b8" : "\u25be";
    });
    state.all = exploreCheckbox(content, "All", true, () => {
      state.selected = new Set(state.all.checked ? definition.categories.map((category) => category.id) : []);
      state.enabled = state.all.checked;
      syncExploreControls(state);
      updateExplore();
    });
    state.all.setAttribute("aria-label", `All ${definition.label} categories`);
    for (const category of definition.categories) {
      const row = exploreNode("div", null, content, { class: "explore-category" });
      const swatch = exploreNode("span", null, row, { class: "explore-swatch", "aria-hidden": "true" });
      swatch.style.backgroundColor = category.color;
      const input = exploreCheckbox(row, `${category.label} (${category.count.toLocaleString("en-US")})`, true, () => {
        if (input.checked) { state.selected.add(category.id); state.enabled = true; }
        else state.selected.delete(category.id);
        if (!state.selected.size) state.enabled = false;
        syncExploreControls(state);
        updateExplore();
      });
      state.inputs.set(category.id, input);
    }
    exploreNode("p", `${definition.features.toLocaleString("en-US")} NYC features`, content, { class: "section-note" });
  }
}

function leaveExplore() {
  exploreEpoch++;
  clearTimeout(exploreMoveTimer);
  if (exploreController) exploreController.abort();
  for (const state of exploreLayers.values()) {
    map.removeLayer(state.group);
    state.group.clearLayers();
    map.removeLayer(state.renderer);
  }
}

function configureExploreMap() {
  const [west, south, east, north] = exploreIndex.bounds;
  map.setMinZoom(9);
  map.setMaxBounds(L.latLngBounds([south, west], [north, east]).pad(0.15));
  map.invalidateSize();
}

async function loadExplore() {
  if (exploreIndex) { configureExploreMap(); updateExplore(); return; }
  if (exploreIndexLoading) return;
  exploreIndexLoading = true;
  exploreState.textContent = "Loading GeoPackage layer catalog...";
  exploreRetry.hidden = true;
  try {
    const response = await fetch("assets/explore_lite8/index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    exploreIndex = ExploreModel.validateIndex(await response.json());
    renderExploreControls();
    if (document.body.dataset.mode === "exploration") { configureExploreMap(); updateExplore(); }
  } catch (error) {
    exploreIndex = null;
    exploreState.textContent = `Explore layers unavailable: ${error.message}`;
    exploreRetry.hidden = false;
    console.error("Explore catalog failed", error);
  } finally {
    exploreIndexLoading = false;
  }
}

async function fetchExploreTile(group, key, signal) {
  const url = `assets/explore_lite8/${group}/${key}.json.gz`;
  if (exploreCache.has(url)) {
    const data = exploreCache.get(url);
    exploreCache.delete(url);
    exploreCache.set(url, data);
    return data;
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${group}/${key}: HTTP ${response.status}`);
  const compressed = await response.arrayBuffer();
  const expected = exploreIndex.groups[group].tiles[key];
  if (compressed.byteLength !== expected.bytes) throw new Error(`Truncated tile: ${group}/${key}`);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", compressed))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== expected.sha256) throw new Error(`Tile checksum mismatch: ${group}/${key}`);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const data = await new Response(stream).json();
  if (data?.features?.length !== expected.features) throw new Error(`Unexpected tile count: ${group}/${key}`);
  exploreCache.set(url, data);
  while (exploreCache.size > 32) exploreCache.delete(exploreCache.keys().next().value);
  return data;
}

function explorePopup(feature, definition) {
  const wrapper = exploreNode("div", null, null, { class: "explore-popup" });
  exploreNode("h2", definition.label, wrapper);
  const category = definition.categories.find((item) => item.id === feature.properties.categories[definition.id]);
  exploreNode("p", category.label, wrapper);
  const details = exploreNode("dl", null, wrapper);
  for (const [key, value] of Object.entries(feature.properties.attributes)) {
    if (value === null || value === "") continue;
    exploreNode("dt", key, details);
    exploreNode("dd", String(value), details);
  }
  return wrapper;
}

async function updateExplore() {
  if (!exploreIndex || document.body.dataset.mode !== "exploration") return;
  const epoch = ++exploreEpoch;
  if (exploreController) exploreController.abort();
  exploreController = new AbortController();
  const signal = exploreController.signal;
  for (const state of exploreLayers.values()) {
    map.removeLayer(state.group);
    state.group.clearLayers();
  }
  map.closePopup();
  exploreRetry.hidden = true;
  const active = [...exploreLayers.values()].filter((state) => state.enabled && state.selected.size);
  if (!active.length) { exploreState.textContent = "All GeoPackage layers are off."; return; }
  if (map.getZoom() < exploreIndex.min_zoom) {
    exploreState.textContent = `Zoom to level ${exploreIndex.min_zoom}+ to see layer detail. All NYC is available.`;
    return;
  }
  const bounds = map.getBounds();
  const keys = ExploreModel.tilesForBounds({
    west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth(),
  }, exploreIndex.tile_zoom);
  const tasks = [];
  const results = new Map();
  for (const group of new Set(active.map((state) => state.definition.group))) {
    results.set(group, []);
    for (const key of keys) {
      if (Object.hasOwn(exploreIndex.groups[group].tiles, key)) tasks.push({ group, key });
    }
  }
  exploreState.textContent = `Loading ${tasks.length} visible-area tiles...`;
  try {
    let position = 0;
    await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (position < tasks.length) {
        if (signal.aborted) return;
        const { group, key } = tasks[position++];
        const data = await fetchExploreTile(group, key, signal);
        results.get(group).push(data);
      }
    }));
    if (epoch !== exploreEpoch || document.body.dataset.mode !== "exploration") return;
    let rendered = 0;
    for (const state of active) {
      const definition = state.definition;
      const features = ExploreModel.visibleFeatures(results.get(definition.group), definition, state.selected);
      const colors = new Map(definition.categories.map((category) => [category.id, category.color]));
      L.geoJSON({ type: "FeatureCollection", features }, {
        renderer: state.renderer,
        style: (feature) => {
          const color = colors.get(feature.properties.categories[definition.id]);
          return { color, fillColor: color, weight: 1, fillOpacity: 0.3 };
        },
        onEachFeature(feature, layer) {
          layer.bindPopup(() => explorePopup(feature, definition), { maxWidth: 330, maxHeight: 350 });
        },
      }).addTo(state.group);
      state.group.addTo(map);
      rendered += features.length;
    }
    exploreState.textContent = `${rendered.toLocaleString("en-US")} features in visible-area tiles. Categories and layers can be toggled independently.`;
  } catch (error) {
    if (epoch !== exploreEpoch || signal.aborted) return;
    exploreController.abort();
    exploreCache.clear();
    for (const state of exploreLayers.values()) { map.removeLayer(state.group); state.group.clearLayers(); }
    exploreState.textContent = `Explore layers unavailable: ${error.message}. No GeoPackage overlay displayed.`;
    exploreRetry.hidden = false;
    console.error("Explore tile load failed", error);
  }
}

exploreRetry.addEventListener("click", () => exploreIndex ? updateExplore() : loadExplore());
document.getElementById("explore-fit").addEventListener("click", () => {
  if (!exploreIndex) return;
  const [west, south, east, north] = exploreIndex.bounds;
  map.fitBounds([[south, west], [north, east]], { padding: [20, 20], animate: false });
});
map.on("moveend", () => {
  clearTimeout(exploreMoveTimer);
  exploreMoveTimer = setTimeout(updateExplore, 150);
});
loadExplore();
document.getElementById("explore-buildings").addEventListener("change", (event) => {
  if (event.target.checked && document.body.dataset.mode === "exploration") buildingLayer.addTo(map);
  else map.removeLayer(buildingLayer);
});
