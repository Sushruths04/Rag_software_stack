// Captures the in-app Documentation panel for design verification.
// Usage: npm run build && npm run preview -- --port 5183 & node scripts/screenshot-docs.mjs
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
await page.waitForTimeout(600);

await page.getByTitle("Open the block guide (what every block does, with examples)").click();
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(300);
await page.screenshot({ path: join(outDir, "documentation-panel-dark.png") });

await browser.close();
console.log("Screenshot written to", outDir);
