"use strict";

let transitData = null;
let transitLoading = false;
const transitCapacity = document.getElementById("transit-ferry-capacity");
const transitState = document.getElementById("transit-state");
const transitError = document.getElementById("transit-error");
const transitRetry = document.getElementById("transit-retry");
const transitContent = document.getElementById("transit-content");

function renderTransit() {
  const capacity = Number(transitCapacity.value);
  const rows = TransitModel.rows(transitData, capacity);
  const body = document.getElementById("transit-values");
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = row.mode;
    tr.append(heading);
    const cell = (text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
      return td;
    };
    cell(row.borough);
    for (const [value, options] of [[row.to, row.toOptions], [row.from, row.fromOptions]]) {
      const td = cell(value === null ? "No direct service" : value.toLocaleString("en-US"));
      if (options) {
        const detail = document.createElement("small");
        detail.className = "transit-breakdown";
        detail.textContent = options.map((option) => `${option.landing}: ${option.trips} trips / ${option[`places_${capacity}`].toLocaleString("en-US")} places`).join("; ");
        td.append(detail);
      }
    }
    cell(row.basis);
    body.append(tr);
  }
  transitState.textContent = `Baseline loaded. Ferry illustration: ${capacity} places per vessel.`;
  const commuteBody = document.getElementById("transit-commute-values");
  commuteBody.replaceChildren();
  for (const mode of transitData.commute.modes) {
    const tr = document.createElement("tr");
    [mode.label, mode.estimate.toLocaleString("en-US"),
      `${(mode.estimate / transitData.commute.total * 100).toFixed(1)}%`,
      mode.moe.toLocaleString("en-US")].forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      tr.append(cell);
    });
    commuteBody.append(tr);
  }
  document.getElementById("transit-commute-summary").textContent =
    `${transitData.commute.total.toLocaleString("en-US")} estimated resident workers +/- ${transitData.commute.total_moe.toLocaleString("en-US")} across ${transitData.commute.source_geographies.length} tracts.`;
}

async function loadTransit() {
  if (transitData || transitLoading) return;
  transitLoading = true;
  transitState.textContent = "Loading transit snapshots...";
  transitError.hidden = true;
  transitRetry.hidden = true;
  try {
    const entries = await Promise.all(["subway", "tram", "q102", "ferry"].map(async (name) => {
      const response = await fetch(`assets/transit/roosevelt_island_${name}_throughput_20261021_provisional.json`);
      if (!response.ok) throw new Error(`${name} snapshot unavailable (HTTP ${response.status})`);
      return [name === "q102" ? "bus" : name, await response.json()];
    }));
    const commuteResponse = await fetch("assets/transit/roosevelt_island_commute_modes_2020_2024.json");
    if (!commuteResponse.ok) throw new Error(`commute mode snapshot unavailable (HTTP ${commuteResponse.status})`);
    entries.push(["commute", await commuteResponse.json()]);
    transitData = TransitModel.validate(Object.fromEntries(entries));
    renderTransit();
    transitCapacity.disabled = false;
    transitContent.hidden = false;
  } catch (error) {
    transitData = null;
    transitContent.hidden = true;
    transitCapacity.disabled = true;
    transitError.textContent = `Transit data could not be loaded: ${error.message}`;
    transitError.hidden = false;
    transitRetry.hidden = false;
    transitState.textContent = "Transit baseline unavailable.";
    console.error("Transit data load failed", error);
  } finally {
    transitLoading = false;
  }
}

transitCapacity.addEventListener("change", renderTransit);
transitRetry.addEventListener("click", loadTransit);
