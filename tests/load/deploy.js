import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.API_URL || "https://api.riftstats.se";

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "6m",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ["rate==0"], // inte en enda misslyckad request
  },
};

export default function () {
  const res = http.get(`${BASE}/health`);
  check(res, { "status 200": (r) => r.status === 200 });
}
