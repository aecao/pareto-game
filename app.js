const islandCenter = [40.7625, -73.9497];
const islandZoom = 15.2;
const themeStyles = getComputedStyle(document.documentElement);
const mapPalette = Object.fromEntries([
  "top", "ranked", "unranked", "selected", "corridor", "island",
  "building", "building-fill", "building-hover", "building-hover-fill",
].map((key) => [key, themeStyles.getPropertyValue(`--map-${key}`).trim()]));
const studyBounds = L.latLngBounds(
  [40.744, -73.970],
  [40.780, -73.925],
);

const map = L.map("map", {
  center: islandCenter,
  zoom: islandZoom,
  minZoom: 13,
  maxZoom: 19,
  maxBounds: studyBounds,
  maxBoundsViscosity: 0.95,
  zoomControl: false,
  attributionControl: true,
  scrollWheelZoom: true,
  worldCopyJump: false,
});

const lightLayer = L.tileLayer(
  "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community",
  },
);

const streetLayer = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  },
);

lightLayer.addTo(map);
L.control.scale({ position: "bottomright", metric: true, imperial: false }).addTo(map);

const buildingStatus = document.getElementById("building-state");
const buildingLayer = L.featureGroup().addTo(map);
let sitingHomeBounds = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function createBuildingPopup(record) {
  const content = document.createElement("div");
  content.className = "building-popup-content";

  const kicker = document.createElement("div");
  kicker.className = "popup-kicker";
  kicker.textContent = `BUILDING / BIN ${record.BIN}`;
  content.append(kicker);

  const title = document.createElement("h2");
  title.textContent = record.Name || record.Address || `BIN ${record.BIN}`;
  content.append(title);

  const details = document.createElement("dl");
  details.className = "popup-details";
  Object.entries(record).forEach(([label, value]) => {
    if (["BIN", "Name"].includes(label) || !String(value).trim()) return;
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  });
  content.append(details);
  return content;
}

async function loadBuildings() {
  try {
    const csvResponse = await fetch("assets/buildings/buildings.csv");
    if (!csvResponse.ok) throw new Error("Building data is unavailable");
    const records = parseCsv(await csvResponse.text()).filter((record) => record.BIN?.trim());
    const features = await Promise.all(records.map(async (record) => {
      const footprintResponse = await fetch(`assets/buildings/bin-${encodeURIComponent(record.BIN.trim())}.geojson`);
      if (!footprintResponse.ok) throw new Error(`Footprint unavailable for BIN ${record.BIN}`);
      const feature = await footprintResponse.json();
      feature.properties = { ...feature.properties, bin: record.BIN.trim() };
      return { feature, record };
    }));

    const recordsByBin = new Map(features.map(({ record }) => [record.BIN.trim(), record]));
    L.geoJSON(
      { type: "FeatureCollection", features: features.map(({ feature }) => feature) },
      {
        style: {
          color: mapPalette.building,
          weight: 1.2,
          opacity: 0.95,
          fillColor: mapPalette["building-fill"],
          fillOpacity: 0.66,
        },
        onEachFeature(feature, layer) {
          const bin = String(feature.properties.bin);
          const labelOffsets = [
            [0, -16], [14, -14], [20, 0], [14, 14],
            [0, 16], [-14, 14], [-20, 0], [-14, -14],
          ];
          layer.bindTooltip(`BIN ${bin}`, {
            permanent: true,
            direction: "center",
            offset: labelOffsets[Number(bin.slice(-2)) % labelOffsets.length],
            className: "building-bin-label",
            opacity: 0.96,
          });
          layer.bindPopup(createBuildingPopup(recordsByBin.get(bin)), {
            maxWidth: 340,
            className: "building-popup",
          });
          layer.on("mouseover", () => layer.setStyle({ color: mapPalette["building-hover"], fillColor: mapPalette["building-hover-fill"], fillOpacity: 0.9, weight: 2 }));
          layer.on("mouseout", () => layer.setStyle({ color: mapPalette.building, fillColor: mapPalette["building-fill"], fillOpacity: 0.66, weight: 1.2 }));
        },
      },
    ).addTo(buildingLayer);

    buildingStatus.textContent = `${features.length} ON MAP`;
    buildingStatus.classList.add("is-ready");
  } catch (error) {
    buildingStatus.textContent = "DATA UNAVAILABLE";
    buildingStatus.classList.add("is-error");
    console.error(error);
  }
}

loadBuildings();

document.querySelectorAll("[data-style]").forEach((button) => {
  button.addEventListener("click", () => {
    const useStreet = button.dataset.style === "street";
    map.removeLayer(useStreet ? lightLayer : streetLayer);
    (useStreet ? streetLayer : lightLayer).addTo(map);

    document.querySelectorAll("[data-style]").forEach((styleButton) => {
      const isActive = styleButton === button;
      styleButton.classList.toggle("is-active", isActive);
      styleButton.setAttribute("aria-pressed", String(isActive));
    });
  });
});

document.querySelector('[data-action="zoom-in"]').addEventListener("click", () => map.zoomIn());
document.querySelector('[data-action="zoom-out"]').addEventListener("click", () => map.zoomOut());
document.querySelector('[data-action="home"]').addEventListener("click", () => {
  if (document.body.dataset.mode === "siting" && sitingHomeBounds) {
    map.fitBounds(sitingHomeBounds, { padding: [30, 30] });
  } else if (document.body.dataset.mode === "connectivity" && connectivityData) {
    fitConnectivityMap();
  } else {
    map.setView(islandCenter, islandZoom, { animate: true });
  }
});