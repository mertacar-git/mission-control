import { compareRoutes } from '../routeComparison';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      rows: compareRoutes(data.mission, data.speed, data.delay),
    });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
