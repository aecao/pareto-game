"use strict";
importScripts("jobs-industry-model.js?v=jobs-v6");

self.onmessage = ({ data }) => {
  try {
    const areas = data.areas.map(p => {
      const count = JobsIndustryModel.sampleCapacity(p, data.metadata);
      return {
        geoid: p.geoid, dominant: p.dominant, total: p.total,
        points: JobsIndustryModel.sample({ ...p, total: count * data.metadata.jobs_per_dot }, data.metadata),
        order: JobsIndustryModel.drawOrder(count, data.metadata.random_seed),
      };
    });
    self.postMessage({ areas }, areas.flatMap(a => [a.points.buffer, a.order.buffer]));
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
