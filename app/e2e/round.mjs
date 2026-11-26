// Real end-to-end round in a phone-sized browser, against devnet + MagicBlock TEE.
//   URL=http://localhost:4321 KEY=../keys/webtest.json node e2e/round.mjs
// The funded devnet test key is injected as the page's burner wallet via localStorage (test-only; never in the build).
import { chromium, devices } from "playwright";
import fs from "fs";
const URL = process.env.URL ?? "http://localhost:4321";
const KEY = process.env.KEY ?? "../keys/webtest.json";
const OUT = process.env.OUT ?? "e2e/shots";
fs.mkdirSync(OUT, { recursive: true });
const secret = fs.readFileSync(KEY, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
await ctx.addInitScript((sk) => {
  localStorage.setItem("clawrush.burner.v1", sk);
  localStorage.setItem("clawrush.useBurner", "1");
  localStorage.setItem("clawrush.muted", "1");
}, secret);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") log("console.error", m.text().slice(0, 200)); });
await page.goto(URL);
await page.getByRole("dialog").screenshot({ path: `${OUT}/00-onboarding.png` }).catch(() => {});
await page.screenshot({ path: `${OUT}/01-onboarding-390.png` });
await page.getByRole("button", { name: "Skip" }).click();
await page.getByText(/capsules$/).first().waitFor({ timeout: 30000 });
await page.screenshot({ path: `${OUT}/02-lobby-390.png` });

const step = async (name, timeout = 90000) => {
  const start = page.getByRole("button", { name });
  await start.waitFor({ timeout });
  return start;
};
// Start or resume
const startBtn = page.getByRole("button", { name: "START SESSION" });
const cashBtn = page.getByRole("button", { name: /Cash out/ });
const insert = page.getByRole("button", { name: "INSERT CREDIT" });
await Promise.race([startBtn.waitFor(), insert.waitFor(), cashBtn.first().waitFor()]).catch(() => {});
if (await startBtn.isVisible()) { log("start session"); await startBtn.click(); }
await (await step("INSERT CREDIT", 120000));
await page.screenshot({ path: `${OUT}/03-ready-390.png` });
log("join"); await insert.click();
const dropBtn = await step("DROP", 120000);
log("my turn: aiming");
await page.keyboard.down("ArrowRight"); await page.waitForTimeout(900); await page.keyboard.up("ArrowRight");
await page.keyboard.down("ArrowUp"); await page.waitForTimeout(700); await page.keyboard.up("ArrowUp");
await page.getByRole("button", { name: "side" }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/04-aiming-side-390.png` });
await page.getByRole("button", { name: "front" }).click();
log("drop"); await dropBtn.click();
const status = page.getByRole("status").filter({ hasText: /won|SLIP|MISS/ });
await status.first().waitFor({ timeout: 60000 });
const result = await status.first().innerText();
log("result:", result);
await page.screenshot({ path: `${OUT}/05-result-390.png` });
await page.getByRole("button", { name: /Live Proof/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/06-proof-390.png`, fullPage: true });
const links = await page.locator("section a[href*='explorer.solana.com/tx']").evaluateAll((as) => as.map((a) => `${a.textContent} ${a.href}`));
log("proof links:\n" + links.join("\n"));
// Cash out & claim
await page.getByRole("button", { name: /Cash out/ }).first().click();
await page.getByRole("status").filter({ hasText: /Paid to your wallet|No prizes pending/ }).first().waitFor({ timeout: 120000 });
log("settled:", await page.getByRole("status").filter({ hasText: /Paid|No prizes/ }).first().innerText());
await page.screenshot({ path: `${OUT}/07-settled-390.png`, fullPage: true });
const links2 = await page.locator("section a[href*='explorer.solana.com/tx']").evaluateAll((as) => as.map((a) => `${a.textContent} ${a.href}`));
fs.writeFileSync(`${OUT}/proof-links.txt`, `${new Date().toISOString()} ${URL}\nresult: ${result}\n` + links2.join("\n") + "\n");
// 375x812 screenshot
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/08-375x812.png` });
await browser.close();
log("done");
