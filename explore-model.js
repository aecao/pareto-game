"use strict";

(function (root) {
  function validateIndex(data) {
    if (data?.schema_version !== 1 || data.tile_zoom !== 14 || data.min_zoom !== 14 ||
        !Array.isArray(data.layers) || !data.layers.length || !data.groups ||
        !Array.isArray(data.bounds) || data.bounds.length !== 4 || !data.bounds.every(Number.isFinite)) {
      throw new Error("Invalid Explore layer catalog.");
    }
    const ids = new Set();
    for (const layer of data.layers) {
      if (!/^[a-z]+$/.test(layer.id) || ids.has(layer.id) || typeof layer.label !== "string" ||
          !data.groups[layer.group] || !Array.isArray(layer.categories) || !layer.categories.length ||
          typeof layer.visible !== "boolean" || typeof layer.collapsed !== "boolean") {
        throw new Error("Invalid Explore layer definition.");
      }
      ids.add(layer.id);
      const categories = new Set();
      let total = 0;
      for (const category of layer.categories) {
        if (!/^c\d+$/.test(category.id) || categories.has(category.id) || typeof category.label !== "string" ||
            !/^#[a-f0-9]{6}$/i.test(category.color) || !Number.isSafeInteger(category.count) || category.count < 0) {
          throw new Error(`Invalid category for ${layer.id}.`);
        }
        categories.add(category.id);
        total += category.count;
      }
      if (total !== layer.features) throw new Error(`Category counts do not reconcile for ${layer.id}.`);
    }
    for (const [group, definition] of Object.entries(data.groups)) {
      if (!/^[a-z]+$/.test(group) || !definition.tiles) throw new Error("Invalid tile group.");
      for (const [key, info] of Object.entries(definition.tiles)) {
        if (!/^\d+_\d+$/.test(key) || !Number.isSafeInteger(info.features) || info.features < 1 ||
            !Number.isSafeInteger(info.bytes) || info.bytes < 1 || !/^[0-9a-f]{64}$/.test(info.sha256)) {
          throw new Error(`Invalid tile metadata: ${group}/${key}.`);
        }
      }
    }
    return data;
  }

  function tilesForBounds(bounds, zoom) {
    const size = 2 ** zoom;
    const x = (lon) => Math.max(0, Math.min(size - 1, Math.floor((lon + 180) / 360 * size)));
    const y = (lat) => {
      const radians = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
      return Math.max(0, Math.min(size - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size)));
    };
    const keys = [];
    for (let column = x(bounds.west); column <= x(bounds.east); column++) {
      for (let row = y(bounds.north); row <= y(bounds.south); row++) keys.push(`${column}_${row}`);
    }
    return keys;
  }

  function visibleFeatures(collections, layer, selected) {
    const known = new Set(layer.categories.map((category) => category.id));
    const features = new Map();
    for (const collection of collections) {
      if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
        throw new Error("Invalid Explore spatial tile.");
      }
      for (const feature of collection.features) {
        if (feature.type !== "Feature" || typeof feature.id !== "string" ||
            !["Polygon", "MultiPolygon"].includes(feature.geometry?.type) ||
            !feature.properties?.categories || !feature.properties.attributes) {
          throw new Error("Invalid Explore feature.");
        }
        const category = feature.properties.categories[layer.id];
        if (category !== undefined && !known.has(category)) throw new Error(`Unknown category in ${layer.id}.`);
        if (selected.has(category)) features.set(feature.id, feature);
      }
    }
    return [...features.values()];
  }

  const api = { validateIndex, tilesForBounds, visibleFeatures };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ExploreModel = api;
})(globalThis);
