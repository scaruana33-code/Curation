// Local launcher: runs the app on this computer at http://localhost:3000.
// Settings come from a .env file next to this one, if present. Without an
// ANTHROPIC_API_KEY it runs on the sample (mock) agent so you can try the screens.
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
process.env.NODE_ENV = "development"; // local runs use plain http
process.env.BASE_URL ||= `http://localhost:${process.env.PORT || 3000}`;
if (!process.env.ANTHROPIC_API_KEY && !process.env.MOCK_AGENT) {
  process.env.MOCK_AGENT = "true";
  console.log("\nNo ANTHROPIC_API_KEY in .env: using SAMPLE articles. Add the key to .env for real curation.\n");
}
process.env.PUBLISH_MODE ||= "dry-run";
const { start } = await import("./src/server.js");
start();
console.log(`\nOpen http://localhost:${process.env.PORT || 3000} in your browser. Press Ctrl+C to stop.\n`);
