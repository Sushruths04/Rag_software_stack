// Captures a screenshot of the demo canvas for design verification.
// Usage: npm run build && npm run preview -- --port 5183 & npm run screenshot
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "screenshots");
mkdirSync(outDir, { recursive: true });

const url = process.env.STUDIO_URL ?? "http://localhost:5183";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
await page.emulateMedia({ colorScheme: "dark" });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".block-node");
// let mount animations (A2) and badge count-ups (A12) settle
await page.waitForTimeout(900);
await page.getByTitle("Fit view (F)").click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(outDir, "demo-canvas-dark.png") });

// light theme pass
await page.getByTitle("Toggle light / dark theme").click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, "demo-canvas-light.png") });

await browser.close();
console.log("Screenshots written to", outDir);
