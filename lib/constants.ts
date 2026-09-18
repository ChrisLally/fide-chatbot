import { generateDummyPassword } from "./db/utils";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";

// next.config `env` inlining does not always reach proxy.ts under `next start`.
// Fall back to IS_DEMO so systemd still prefixes /demo on auth redirects.
export const appBasePath =
  process.env.NEXT_PUBLIC_BASE_PATH ||
  (process.env.IS_DEMO === "1" ? "/demo" : "");

export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = generateDummyPassword();

export const suggestions = [
  "Suggest a first-timer Australia itinerary from the Catalina templates.",
  "What are the Top-10 things to do in Adelaide from the guide?",
  "Which Sydney hotels are in the Catalina inventory?",
  "Plan a Sydney → Melbourne → Queenstown route using our transport legs.",
];
