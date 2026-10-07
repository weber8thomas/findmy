import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8766);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: "bash ./start-server.sh",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(port) },
  },
  // The map and location sources are checked on every size; the rest on the desktop, and phone
  // gestures on the phone. Only Chromium is installed: the iPad is emulated with it.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(mobile|map|sources)\.spec\.ts$/ },
    { name: "tablet", use: { ...devices["iPad (gen 7)"], browserName: "chromium" }, testMatch: /(map|sources)\.spec\.ts$/ },
  ],
});
