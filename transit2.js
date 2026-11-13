"use strict";

let transit2Config = null;
let transit2Loading = false;
const transit2Fields = document.getElementById("transit2-fields");
const transit2Content = document.getElementById("transit2-content");
const transit2State = document.getElementById("transit2-state");
const transit2Error = document.getElementById("transit2-error");
const transit2Retry = document.getElementById("transit2-retry");
const transit2Inputs = {
  arrival: document.getElementById("transit2-arrival-load"),
  peak: document.getElementById("transit2-peak-share"),
  inPerson: document.getElementById("transit2-in-person"),
  tramHeadway: document.getElementById("transit2-tram-headway"),
  ferryHeadway: document.getElementById("transit2-ferry-headway"),
};
const transit2ModeLabels = {
  subway: "Subway",
  bus: "Bus",
  tram: "Roosevelt Island Tram",
  ferry: "Astoria Ferry",
};

function transit2Format(value) {
  return Math.round(value).toLocaleString("en-US");
}

function transit2Percent(value) {
  const percent = value * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function transit2ConfigForInputs() {
  const config = structuredClone(transit2Config);
  config.parameters.subway_arrival_load = Number(transit2Inputs.arrival.value);
  config.parameters.peak_hour_share = Number(transit2Inputs.peak.value);
  config.parameters.in_person = Number(transit2Inputs.inPerson.value);
  config.parameters.tram.headway_min = Number(transit2Inputs.tramHeadway.value);
  config.parameters.ferry.headway_min = Number(transit2Inputs.ferryHeadway.value);
  return config;
}

function renderTransit2() {
  const config = transit2ConfigForInputs();
  const selected = Transit2Model.run(config, config.parameters.subway_arrival_load);
  const p = config.parameters;
  document.getElementById("transit2-arrival-load-value").textContent = transit2Percent(p.subway_arrival_load);
  document.getElementById("transit2-peak-share-value").textContent = transit2Percent(p.peak_hour_share);
  document.getElementById("transit2-in-person-value").textContent = transit2Percent(p.in_person);
  document.getElementById("transit2-tram-headway-value").textContent = `${p.tram.headway_min.toFixed(1)} min`;
  document.getElementById("transit2-ferry-headway-value").textContent = `${p.ferry.headway_min.toFixed(0)} min`;

  const headroom = document.getElementById("transit2-headroom");
  headroom.replaceChildren();
  for (const mode of Transit2Model.modes) {
    const card = document.createElement("article");
    card.className = "transit2-card";
    const title = document.createElement("h4");
    title.textContent = transit2ModeLabels[mode];
    const value = document.createElement("strong");
    value.textContent = `${transit2Format(selected.headroom[mode])} passengers/hour`;
    const detail = document.createElement("p");
    detail.textContent = p.split[mode] === 0
      ? `Usable ${transit2Format(selected.usable[mode])}; existing demand is not identified by ACS.`
      : `Usable ${transit2Format(selected.usable[mode])}; existing ${transit2Format(selected.existing[mode])}.`;
    card.append(title, value, detail);
    headroom.append(card);
  }

  const body = document.getElementById("transit2-scenarios");
  body.replaceChildren();
  for (const arrival of transit2Config.subway_arrival_load_scenarios) {
    const result = Transit2Model.run(config, arrival);
    const tr = document.createElement("tr");
    [
      `${Math.round(arrival * 100)}%`,
      transit2Format(result.headroom.subway),
      transit2Format(result.fixed.subway),
      transit2Format(result.fixedBindingHouseholds),
      transit2ModeLabels[result.bindingMode],
      transit2Format(result.fullReallocationHouseholds),
    ].forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      tr.append(cell);
    });
    body.append(tr);
  }
  document.getElementById("transit2-intro").textContent =
    `Each household generates ${(selected.r).toFixed(3)} outbound transit trips in the AM peak under the selected assumptions.`;
  document.getElementById("transit2-provenance").textContent = transit2Config.provenance_note;
  document.getElementById("transit2-replacements").textContent =
    transit2Config.replace_with_real_data.map((item) => `Still unresolved: ${item}`).join(" ");
  transit2State.textContent = "Model ready. Sliders update results live.";
}

async function loadTransit2() {
  if (transit2Config || transit2Loading) return;
  transit2Loading = true;
  transit2State.textContent = "Loading model configuration...";
  transit2Error.hidden = true;
  transit2Retry.hidden = true;
  try {
    const response = await fetch("assets/transit/transit2-config.json");
    if (!response.ok) throw new Error(`configuration unavailable (HTTP ${response.status})`);
    transit2Config = Transit2Model.validate(await response.json());
    transit2Inputs.arrival.value = transit2Config.default_subway_arrival_load;
    transit2Inputs.peak.value = transit2Config.parameters.peak_hour_share;
    transit2Inputs.inPerson.value = transit2Config.parameters.in_person;
    transit2Inputs.tramHeadway.value = transit2Config.parameters.tram.headway_min;
    transit2Inputs.ferryHeadway.value = transit2Config.parameters.ferry.headway_min;
    transit2Fields.disabled = false;
    transit2Content.hidden = false;
    renderTransit2();
  } catch (error) {
    transit2Config = null;
    transit2Fields.disabled = true;
    transit2Content.hidden = true;
    transit2Error.textContent = `Transit 2 could not be loaded: ${error.message}`;
    transit2Error.hidden = false;
    transit2Retry.hidden = false;
    transit2State.textContent = "Transit 2 unavailable.";
    console.error("Transit 2 load failed", error);
  } finally {
    transit2Loading = false;
  }
}

Object.values(transit2Inputs).forEach((input) => input.addEventListener("input", renderTransit2));
transit2Retry.addEventListener("click", loadTransit2);
