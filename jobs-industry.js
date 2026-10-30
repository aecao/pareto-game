"use strict";

function jobsIndustryPopup(feature) {
  const p = feature.properties;
  const m = incomeData.metadata;
  const mode = document.getElementById("jobs-classification").value;
  const { definition, counts, winners, count } = JobsIndustryModel.breakdown(p, m, mode);
  const wrapper = incomeNode("div", null, null);
  incomeNode("h2", p.name, wrapper);
  incomeNode("p", `${incomeNumber(p.total)} primary workplace jobs (2023 JT01).`, wrapper);
  incomeNode("p", !p.total ? "Zero primary jobs: no dots." : definition.proportional
    ? `${definition.label}: dots split among categories in proportion to jobs.`
    : `Dominant category: ${definition.groups[winners[0]].label}. All dots use this color, including jobs in other categories.`, wrapper);
  if (!definition.proportional && winners.length > 1) incomeNode("p", `Tied categories: ${winners.map(key => definition.groups[key].label).join("; ")}. First category ID sets the color.`, wrapper);
  for (const [key, group] of Object.entries(definition.groups)) {
    incomeNode("p", `${group.label}: ${incomeNumber(counts[key])} jobs`, wrapper);
  }
  if (mode === "earnings") incomeNode("p", "Published monthly job earnings bins, not household income.", wrapper);
  incomeNode("p", `${incomeNumber(count)} synthetic dots: one per ${m.jobs_per_dot} jobs${definition.proportional ? " within each category" : ""}, with smaller final dots for remainders. Seeded random land locations, not actual workplaces.`, wrapper);
  return wrapper;
}

const JobsIndustryLayer = L.Layer.extend({
  initialize(data) {
    this.data = data;
    this.bounds = incomeHomeBounds;
    this.mode = document.getElementById("jobs-classification").value;
    this.properties = new Map(data.features.map(f => [f.properties.geoid, f.properties]));
  },
  getBounds() { return this.bounds; },
  onAdd(mapInstance) {
    this.mapInstance = mapInstance;
    this.canvas = L.DomUtil.create("canvas", "jobs-industry-canvas");
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.position = "absolute";
    mapInstance.getPanes().overlayPane.appendChild(this.canvas);
    this.areas = [];
    this.worker = new Worker("jobs-industry-worker.js?v=jobs-v6");
    this.control = document.getElementById("jobs-classification");
    this.changeClassification = () => {
      this.mode = this.control.value;
      jobsIndustryLegend(this.data);
      mapInstance.closePopup();
      this.redraw();
    };
    this.control.addEventListener("change", this.changeClassification);
    const fail = (message) => {
      document.getElementById("income-state").textContent = `Jobs dots unavailable: ${message}. Retry Data to regenerate.`;
      document.getElementById("income-retry").hidden = false;
      console.error("Jobs/industry dots failed", message);
    };
    this.worker.onerror = (event) => { fail(event.message); };
    this.worker.onmessage = ({ data }) => {
      if (data.error) { fail(data.error); return; }
      this.areas = data.areas;
      this.redraw();
      document.getElementById("income-state").textContent =
        `${incomeNumber(this.data.metadata.total_jobs)} primary jobs across ${incomeNumber(this.data.features.length)} areas. One dot per ${this.data.metadata.jobs_per_dot} jobs; category views use smaller remainder dots within each category.`;
    };
    this.worker.postMessage({
      areas: this.data.features.filter(f => f.properties.total > 0).map(f => f.properties),
      metadata: this.data.metadata,
    });
    mapInstance.on("moveend zoomend resize viewreset", this.redraw, this);
    mapInstance.on("movestart zoomstart", this.hide, this);
    this.redraw();
  },
  hide() {
    cancelAnimationFrame(this.frame);
    this.canvas.style.visibility = "hidden";
  },
  onRemove(mapInstance) {
    cancelAnimationFrame(this.frame);
    this.worker.terminate();
    this.worker.onmessage = null;
    this.control.removeEventListener("change", this.changeClassification);
    mapInstance.off("moveend zoomend resize viewreset", this.redraw, this);
    mapInstance.off("movestart zoomstart", this.hide, this);
    this.canvas.remove();
    this.areas = [];
  },
  redraw() {
    cancelAnimationFrame(this.frame);
    const mapInstance = this.mapInstance;
    const size = mapInstance.getSize();
    const ratio = devicePixelRatio || 1;
    this.canvas.width = size.x * ratio;
    this.canvas.height = size.y * ratio;
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, mapInstance.containerPointToLayerPoint([0, 0]));
    this.canvas.style.visibility = "visible";
    const ctx = this.canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.globalAlpha = 1;
    const bounds = mapInstance.getPixelBounds();
    const scale = 256 * 2 ** mapInstance.getZoom();
    const baseRadius = JobsIndustryModel.dotRadius(mapInstance.getZoom());
    let areaIndex = 0, pointIndex = 0;
    const draw = () => {
      const start = performance.now();
      while (areaIndex < this.areas.length) {
        const area = this.areas[areaIndex];
        const { bands, count } = JobsIndustryModel.breakdown(this.properties.get(area.geoid), this.data.metadata, this.mode);
        for (; pointIndex < area.order.length; pointIndex++) {
          const slot = area.order[pointIndex];
          if (slot >= count) continue;
          const band = bands.find(b => slot >= b.start && slot < b.end);
          ctx.fillStyle = band.color;
          const x = area.points[slot * 2] * scale - bounds.min.x;
          const y = area.points[slot * 2 + 1] * scale - bounds.min.y;
          if (x >= -2 && y >= -2 && x <= size.x + 2 && y <= size.y + 2) {
            const remainder = band.total % this.data.metadata.jobs_per_dot;
            const radius = baseRadius * (slot === band.end - 1 && remainder
              ? Math.sqrt(remainder / this.data.metadata.jobs_per_dot) : 1);
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
          if (pointIndex % 1000 === 999 && performance.now() - start > 8) {
            pointIndex++;
            this.frame = requestAnimationFrame(draw);
            return;
          }
        }
        pointIndex = 0;
        areaIndex++;
      }
    };
    this.frame = requestAnimationFrame(draw);
  },
});
