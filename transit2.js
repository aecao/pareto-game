"use strict";

let transit2Config = null;
let transit2Loading = false;
const transit2Fields = document.getElementById("transit2-fields");
const transit2Content = document.getElementById("transit2-content");
const transit2State = document.getElementById("transit2-state");
const transit2Error = document.getElementById("transit2-error");
const transit2Retry = document.getElementById("transit2-retry");
const transit2Reset = document.getElementById("transit2-reset");
const transit2TramwayDemandNote = document.getElementById("transit2-tramway-demand-note");
const transit2TramwayDemandSource = document.getElementById("transit2-tramway-demand-source");
let transit2DefaultValues = null;
const transit2Inputs = {
  arrival: document.getElementById("transit2-arrival-load"),
  subwayHeadway: document.getElementById("transit2-subway-headway"),
  busHeadway: document.getElementById("transit2-bus-headway"),
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

function transit2Range(results, getValue) {
  const values = results.map(getValue);
  return `${transit2Format(Math.min(...values))}–${transit2Format(Math.max(...values))}`;
}

function transit2ComparisonCard(title, currentLabel, currentValue, capacityLabel, capacityValue, detail, badge) {
  const card = document.createElement("article");
  card.className = "transit2-comparison-card";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const track = document.createElement("div");
  track.className = "transit2-capacity-track";
  track.setAttribute("role", "img");
  const fill = document.createElement("div");
  fill.className = "transit2-capacity-fill";
  const currentIsKnown = Number.isFinite(currentValue);
  const share = currentIsKnown && capacityValue > 0
    ? Math.max(0, Math.min(1, currentValue / capacityValue))
    : 0;
  fill.style.width = `${share * 100}%`;
  track.setAttribute("aria-label", currentIsKnown
    ? `${title}: ${transit2Format(currentValue)} estimated current, ${transit2Format(capacityValue)} modeled capacity`
    : `${title}: current demand not identified, ${transit2Format(capacityValue)} modeled capacity`);
  track.append(fill);
  const current = document.createElement("div");
  current.className = "transit2-comparison-values";
  const currentText = document.createElement("span");
  currentText.textContent = currentLabel;
  const currentNumber = document.createElement("strong");
  currentNumber.textContent = currentIsKnown ? transit2Format(currentValue) : "Not identified";
  current.append(currentText, currentNumber);
  const capacity = document.createElement("div");
  capacity.className = "transit2-comparison-values";
  const capacityText = document.createElement("span");
  capacityText.textContent = capacityLabel;
  const capacityNumber = document.createElement("strong");
  capacityNumber.textContent = transit2Format(capacityValue);
  capacity.append(capacityText, capacityNumber);
  const note = document.createElement("p");
  note.className = "transit2-comparison-detail";
  note.textContent = detail;
  card.append(heading, track, current, capacity, note);
  if (badge) {
    const tag = document.createElement("span");
    tag.className = "transit2-bottleneck";
    tag.textContent = badge;
    card.append(tag);
  }
  return card;
}

function transit2ConfigForInputs() {
  const config = structuredClone(transit2Config);
  config.parameters.subway_arrival_load = Number(transit2Inputs.arrival.value);
  config.parameters.peak_hour_share = Number(transit2Inputs.peak.value);
  config.parameters.in_person = Number(transit2Inputs.inPerson.value);
  config.parameters.subway.tph = 60 / Number(transit2Inputs.subwayHeadway.value);
  config.parameters.bus.trips_per_hour = 60 / Number(transit2Inputs.busHeadway.value);
  config.parameters.tram.headway_min = Number(transit2Inputs.tramHeadway.value);
  config.parameters.ferry.headway_min = Number(transit2Inputs.ferryHeadway.value);
  return config;
}

function renderTransit2() {
  const config = transit2ConfigForInputs();
  const selected = Transit2Model.run(config, config.parameters.subway_arrival_load);
  const p = config.parameters;
  const scenarioResults = transit2Config.subway_arrival_load_scenarios.map((arrival) =>
    Transit2Model.run(config, arrival));
  document.getElementById("transit2-arrival-load-value").textContent = transit2Percent(p.subway_arrival_load);
  document.getElementById("transit2-subway-headway-value").textContent = `${(60 / p.subway.tph).toFixed(1)} min`;
  document.getElementById("transit2-bus-headway-value").textContent = `${(60 / p.bus.trips_per_hour).toFixed(0)} min`;
  document.getElementById("transit2-peak-share-value").textContent = transit2Percent(p.peak_hour_share);
  document.getElementById("transit2-in-person-value").textContent = transit2Percent(p.in_person);
  document.getElementById("transit2-tram-headway-value").textContent = `${p.tram.headway_min.toFixed(1)} min`;
  document.getElementById("transit2-ferry-headway-value").textContent = `${p.ferry.headway_min.toFixed(0)} min`;

  const knownDemand = transit2Config.acs_demand_identified
    .reduce((sum, mode) => sum + selected.existing[mode], 0);
  const tramwayDemand = selected.tramwayDemandEstimate;
  const tramwayCrowding = selected.tramwayCrowdingScenario;
  transit2TramwayDemandNote.textContent =
    `${transit2Format(tramwayDemand.averageDailyRiders)} estimated Tramway riders/day on average in ${tramwayDemand.month} `
    + `(${transit2Format(tramwayDemand.monthlyRiders)} for ${tramwayDemand.daysInMonth} calendar days). `
    + `${tramwayDemand.periodNote} This is daily context only; it is not included in the ACS-based AM-peak or residential calculations. `
    + tramwayDemand.attributionStatus;
  transit2TramwayDemandSource.href = tramwayDemand.sourceUrl;
  const totalCapacity = document.getElementById("transit2-total-capacity");
  totalCapacity.replaceChildren(transit2ComparisonCard(
    "All modeled modes",
    "Identified ACS AM-peak demand",
    knownDemand,
    "Modeled usable spaces",
    selected.totalCapacity,
    "Demand is estimated from ACS usual commute modes and the selected peak-hour share. The separate Tramway estimate lacks a peak-hour/direction split and is not included here.",
  ));

  const modeCapacity = document.getElementById("transit2-mode-capacity");
  modeCapacity.replaceChildren();
  for (const mode of Transit2Model.modes) {
    const demandKnown = transit2Config.acs_demand_identified.includes(mode);
    const utilization = demandKnown && selected.usable[mode] > 0
      ? `${transit2Percent(selected.existing[mode] / selected.usable[mode])} of modeled capacity`
      : "Net utilization unknown";
    const currentValue = mode === "tram"
      ? tramwayCrowding.estimatedPeakDemand
      : demandKnown ? selected.existing[mode] : null;
    const currentLabel = mode === "tram" ? "Full-load AM-peak scenario" : "ACS AM-peak demand";
    const capacityLabel = mode === "tram" ? "85% planning capacity" : "Modeled capacity";
    const detail = mode === "tram"
      ? `User-reported frequent crowding is represented by a full-load scenario: ${transit2Format(tramwayCrowding.estimatedPeakDemand)} riders/hour at ${(60 / p.tram.headway_min).toFixed(1)} departures/hour. This is ${transit2Format(tramwayCrowding.excessOverPlanning)} above the 85% planning capacity and leaves ${transit2Format(tramwayCrowding.grossHeadroom)} gross spaces. ${tramwayCrowding.status} This reduces only AM full-reallocation headroom; the daily estimate is excluded from daily residential calculations.`
      : demandKnown
      ? `${transit2Format(selected.headroom[mode])} modeled spaces remain after the ACS demand estimate; ${utilization}.`
      : `Modeled gross capacity is shown; ACS does not identify this mode's riders, so net headroom cannot be estimated.`;
    modeCapacity.append(transit2ComparisonCard(
      transit2ModeLabels[mode],
      currentLabel,
      currentValue,
      capacityLabel,
      selected.usable[mode],
      detail,
      mode === selected.bindingMode ? "Fixed-share household bottleneck" : null,
    ));
  }

  const householdCapacity = document.getElementById("transit2-household-capacity");
  householdCapacity.replaceChildren();
  householdCapacity.append(
    transit2ComparisonCard(
      "Current ACS mode split",
      `Estimated existing households (±${transit2Format(p.hh_existing_moe)})`,
      p.hh_existing,
      "Total households supported",
      selected.residentialCapacity.fixed.totalHouseholds,
      `${transit2Format(selected.residentialCapacity.fixed.additionalHouseholds)} additional households; constrained by ${transit2ModeLabels[selected.bindingMode]}.`,
    ),
    transit2ComparisonCard(
      "Full mode reallocation",
      `Estimated existing households (±${transit2Format(p.hh_existing_moe)})`,
      p.hh_existing,
      "Total households supported",
      selected.residentialCapacity.reallocated.totalHouseholds,
      `${transit2Format(selected.residentialCapacity.reallocated.additionalHouseholds)} additional households; optimistic upper bound if trips can shift freely across modes, including the Tram full-load AM assumption.`,
    ),
  );
  document.getElementById("transit2-household-note").textContent =
    `Current baseline: ${transit2Format(p.hh_existing)} ACS-estimated households across the three-tract Roosevelt Island proxy. Capacity is shown at the selected ${transit2Percent(p.subway_arrival_load)} subway arrival-load assumption.`;

  const residentCapacity = document.getElementById("transit2-resident-capacity");
  residentCapacity.replaceChildren(
    transit2ComparisonCard(
      "Current ACS mode split",
      `Estimated existing residents (±${transit2Format(p.current_population_moe)})`,
      p.current_population,
      "Total residents supported",
      selected.residentialCapacity.fixed.totalResidents,
      `${transit2Format(selected.residentialCapacity.fixed.additionalResidents)} additional residents at ${p.average_household_size.toFixed(2)} people per occupied household.`,
    ),
    transit2ComparisonCard(
      "Full mode reallocation",
      `Estimated existing residents (±${transit2Format(p.current_population_moe)})`,
      p.current_population,
      "Total residents supported",
      selected.residentialCapacity.reallocated.totalResidents,
      `${transit2Format(selected.residentialCapacity.reallocated.additionalResidents)} additional residents at ${p.average_household_size.toFixed(2)} people per occupied household; optimistic upper bound including the Tram full-load AM assumption.`,
    ),
  );

  const aggregateBody = document.getElementById("transit2-aggregate-ranges");
  aggregateBody.replaceChildren();
  [
    {
      label: `AM peak hour (${transit2Config.selected_peak_hour})`,
      capacity: (result) => result.totalCapacity,
      fixed: (result) => result.residentialCapacity.fixed.totalHouseholds,
      reallocated: (result) => result.residentialCapacity.reallocated.totalHouseholds,
      fixedResidents: (result) => result.residentialCapacity.fixed.totalResidents,
      reallocatedResidents: (result) => result.residentialCapacity.reallocated.totalResidents,
    },
    {
      label: "Whole weekday service day",
      capacity: (result) => result.daily.totalCapacity,
      fixed: (result) => result.daily.residentialCapacity.fixed.totalHouseholds,
      reallocated: (result) => result.daily.residentialCapacity.reallocated.totalHouseholds,
      fixedResidents: (result) => result.daily.residentialCapacity.fixed.totalResidents,
      reallocatedResidents: (result) => result.daily.residentialCapacity.reallocated.totalResidents,
    },
  ].forEach((period) => {
    const row = document.createElement("tr");
    [
      period.label,
      `${transit2Range(scenarioResults, period.capacity)} passenger places`,
      transit2Range(scenarioResults, period.fixed),
      transit2Range(scenarioResults, period.reallocated),
      transit2Range(scenarioResults, period.fixedResidents),
      transit2Range(scenarioResults, period.reallocatedResidents),
    ].forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      row.append(cell);
    });
    aggregateBody.append(row);
  });

  const headroom = document.getElementById("transit2-headroom");
  headroom.replaceChildren();
  for (const mode of Transit2Model.modes) {
    const card = document.createElement("article");
    card.className = "transit2-card";
    const title = document.createElement("h4");
    title.textContent = transit2ModeLabels[mode];
    const demandKnown = transit2Config.acs_demand_identified.includes(mode);
    const value = document.createElement("strong");
    value.textContent = mode === "tram"
      ? `${transit2Format(tramwayCrowding.estimatedPeakDemand)} riders/hour, full-load scenario`
      : demandKnown
        ? `${transit2Format(selected.headroom[mode])} passengers/hour`
        : "Net headroom unknown";
    const detail = document.createElement("p");
    detail.textContent = mode === "tram"
      ? `Full-load estimate ${transit2Format(tramwayCrowding.estimatedPeakDemand)}; 85% planning capacity ${transit2Format(tramwayCrowding.planningCapacity)}; ${transit2Format(tramwayCrowding.excessOverPlanning)} above planning and ${transit2Format(tramwayCrowding.grossHeadroom)} gross spaces remaining. This is an assumption, not observed peak ridership.`
      : demandKnown
        ? `Usable ${transit2Format(selected.usable[mode])}; ACS-estimated demand ${transit2Format(selected.existing[mode])}; ${transit2Percent(selected.existing[mode] / selected.usable[mode])} utilized.`
        : `Modeled gross capacity ${transit2Format(selected.usable[mode])}; ACS demand and net headroom are unknown for this mode.`;
    card.append(title, value, detail);
    if (mode === selected.bindingMode) {
      const badge = document.createElement("span");
      badge.className = "transit2-bottleneck";
      badge.textContent = "Fixed-share household bottleneck";
      card.append(badge);
    }
    headroom.append(card);
  }

  const body = document.getElementById("transit2-scenarios");
  body.replaceChildren();
  for (const result of scenarioResults) {
    const arrival = result.arrivalLoad;
    const tr = document.createElement("tr");
    [
      `${Math.round(arrival * 100)}%`,
      transit2Format(result.headroom.subway),
      transit2Format(result.fixed.subway),
      transit2Format(result.fixedBindingHouseholds),
      transit2ModeLabels[result.bindingMode],
      transit2Format(result.fullReallocationHouseholds),
      transit2Format(result.residentialCapacity.fixed.additionalResidents),
      transit2Format(result.residentialCapacity.reallocated.additionalResidents),
    ].forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      tr.append(cell);
    });
    body.append(tr);
  }
  document.getElementById("transit2-intro").textContent =
    `Each household generates ${selected.r.toFixed(3)} outbound transit trips in the AM peak under the selected assumptions. Current demand is an ACS usual-commute estimate, not observed ridership.`;
  document.getElementById("transit2-takeaway").textContent =
    `At ${transit2Percent(p.subway_arrival_load)} subway arrival load, ${transit2ModeLabels[selected.bindingMode]} is the fixed-share household bottleneck. The model supports ${transit2Format(selected.residentialCapacity.fixed.additionalResidents)} additional residents with current mode shares, or up to ${transit2Format(selected.residentialCapacity.reallocated.additionalResidents)} if trips fully reallocate across modes.`;
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
    const parameters = transit2Config.parameters;
    const subwayRange = transit2Config.slider_ranges.subway_headway_min;
    const busRange = transit2Config.slider_ranges.bus_headway_min;
    transit2Inputs.subwayHeadway.min = subwayRange.min;
    transit2Inputs.subwayHeadway.max = subwayRange.max;
    transit2Inputs.subwayHeadway.step = subwayRange.step;
    transit2Inputs.busHeadway.min = busRange.min;
    transit2Inputs.busHeadway.max = busRange.max;
    transit2Inputs.busHeadway.step = busRange.step;
    transit2DefaultValues = {
      arrival: transit2Config.default_subway_arrival_load,
      subwayHeadway: 60 / parameters.subway.tph,
      busHeadway: 60 / parameters.bus.trips_per_hour,
      peak: parameters.peak_hour_share,
      inPerson: parameters.in_person,
      tramHeadway: parameters.tram.headway_min,
      ferryHeadway: parameters.ferry.headway_min,
    };
    for (const [name, value] of Object.entries(transit2DefaultValues)) {
      transit2Inputs[name].value = value;
    }
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
transit2Reset.addEventListener("click", () => {
  for (const [name, value] of Object.entries(transit2DefaultValues)) {
    transit2Inputs[name].value = value;
  }
  renderTransit2();
});
transit2Retry.addEventListener("click", loadTransit2);
