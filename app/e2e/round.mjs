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
  try { await start.waitFor({ timeout }); }
  catch (e) {
    await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, "_")}.png` });
    log("page text at failure:", (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
    throw e;
  }
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
await page.getByText("Dropping…").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/05-result-390.png` });
await page.getByRole("button", { name: /Live Proof/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/06-proof-390.png`, fullPage: true });
const links = await page.locator("section a[href*='explorer.solana.com/tx']").evaluateAll((as) => as.map((a) => `${a.textContent} ${a.href}`));
log("proof links:\n" + links.join("\n"));
// Round 2 in the same session: join again, then let the turn time out on purpose (no drop).
// The app must clear its own expired turn (expire_turn with the session key) and offer INSERT CREDIT / Cash out again.
// Stop scripts/keeper.ts before this run so the app, not the keeper, clears the turn.
log("round 2: join and idle until the turn expires");
await (await step("INSERT CREDIT", 60000)).click();
await step("DROP", 120000);
const t0 = Date.now();
await page.getByRole("button", { name: "INSERT CREDIT" }).or(page.getByRole("button", { name: "No credits" })).first().waitFor({ timeout: 60000 });
const recovered = `turn expired and cleared after ${((Date.now() - t0) / 1000).toFixed(1)} s`;
log(recovered);
await page.screenshot({ path: `${OUT}/05b-timeout-recovered-390.png` });

// Cash out & claim
await page.getByRole("button", { name: /Cash out/ }).first().click();
await page.getByRole("status").filter({ hasText: /Paid to your wallet|No prizes pending/ }).first().waitFor({ timeout: 120000 });
log("settled:", await page.getByRole("status").filter({ hasText: /Paid|No prizes/ }).first().innerText());
await page.screenshot({ path: `${OUT}/07-settled-390.png`, fullPage: true });
const links2 = await page.locator("section a[href*='explorer.solana.com/tx']").evaluateAll((as) => as.map((a) => `${a.textContent} ${a.href}`));
fs.writeFileSync(`${OUT}/proof-links.txt`, `${new Date().toISOString()} ${URL}\nround 1 result: ${result}\nround 2: ${recovered}\n` + links2.join("\n") + "\n");
// 375x812 screenshot
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/08-375x812.png` });
await browser.close();
log("done");
