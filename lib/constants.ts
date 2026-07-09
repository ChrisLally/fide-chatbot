import { generateDummyPassword } from "./db/utils";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = generateDummyPassword();

export const suggestions = [
  "Which Rome hotel is best for a 10th anniversary couple?",
  "How should we get from Rome to Val d'Orcia?",
  "What are the strongest food and wine experiences in Tuscany?",
  "Build a relaxed Rome and Val d'Orcia itinerary for an anniversary trip.",
];
