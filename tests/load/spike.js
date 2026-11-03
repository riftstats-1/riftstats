import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.API_URL || "https://api.riftstats.se";
const PEAK = Number(__ENV.PEAK || 400); // requests per sekund på toppen

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: 20,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { duration: "1m", target: 50 },   // uppvärmning
        { duration: "2m", target: PEAK }, // öka
        { duration: "4m", target: PEAK }, // håll, här ska HPA skala upp
        { duration: "1m", target: 0 },    // släpp
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],    // under 1 % fel
    http_req_duration: ["p(95)<500"],  // 95 % snabbare än 500 ms
  },
};

export default function () {
  const res = http.get(`${BASE}/`);
  check(res, { "status 200": (r) => r.status === 200 });
}
