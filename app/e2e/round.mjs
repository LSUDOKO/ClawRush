// Real end-to-end round in a phone-sized browser, against devnet + MagicBlock TEE.
//   URL=http://localhost:4321 KEY=../keys/webtest.json node e2e/round.mjs
// The funded devnet test key is injected as the page's burner wallet via localStorage (test-only; never in the build).
import { chromium, devices } from "playwright";
import fs from "fs";
import anchorPkg from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
const URL = process.env.URL ?? "http://localhost:4321";
const KEY = process.env.KEY ?? "../keys/webtest.json";
const OUT = process.env.OUT ?? "e2e/shots";
fs.mkdirSync(OUT, { recursive: true });
const secret = fs.readFileSync(KEY, "utf8").trim();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// swiftshader flags let headless Chrome render the WebGL cabinet; VIDEO=<dir> records the run as real demo footage.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, ...(process.env.VIDEO ? { recordVideo: { dir: process.env.VIDEO, size: { width: 390, height: 844 } } } : {}) });
await ctx.addInitScript((sk) => {
  localStorage.setItem("clawrush.burner.v1", sk);
  localStorage.setItem("clawrush.useBurner", "1");
  localStorage.setItem("clawrush.muted", "1");
}, secret);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") log("console.error", m.text().slice(0, 200)); });
await page.goto(URL);
// Title screen → PLAY NOW, then the first-run how-to-play dialog.
await page.getByRole("button", { name: "PLAY NOW" }).waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/00-title-390.png` });
await page.getByRole("button", { name: "PLAY NOW" }).click();
await page.getByRole("dialog").waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
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
// Leftover profile from an interrupted run ("WELCOME BACK"): settle it first, then start fresh.
if (await page.getByText("WELCOME BACK").isVisible() && !(await startBtn.isVisible()) && !(await insert.isVisible())) {
  log("leftover profile: cash out first"); await cashBtn.first().click();
  await page.getByText(/Paid to your wallet|No prizes pending/).first().waitFor({ timeout: 120000 });
  await Promise.race([startBtn.waitFor({ timeout: 60000 }), insert.waitFor({ timeout: 60000 })]).catch(() => {});
}
if (await startBtn.isVisible()) {
  // Pick a credit pack the wallet can already afford (the demo faucet is limited to one claim per hour).
  const have = Number((await page.getByText(/You have [0-9.]+ dUSDC/).textContent().catch(() => "You have 0 dUSDC")).match(/[0-9.]+/)[0]);
  if (have >= 1 && have < 5) await page.getByRole("button", { name: have >= 3 ? /^3\s*CREDITS/ : /^1\s*CREDITS/ }).click().catch(() => {});
  log("start session"); await startBtn.click();
}
await (await step("INSERT CREDIT", 120000));
await page.screenshot({ path: `${OUT}/03-ready-390.png` });
log("join"); await insert.click();
const dropBtn = await step("DROP", 120000);
log("my turn: aiming");
if (process.env.AIM) {
  // AIM=1: steer the joystick toward the nearest prize capsule using the live on-chain cabinet state.
  const idl = JSON.parse(fs.readFileSync("src/lib/idl.json", "utf8"));
  const dev = JSON.parse(fs.readFileSync("src/lib/devnet.json", "utf8"));
  const coder = new anchorPkg.BorshAccountsCoder(idl);
  const er = new Connection("https://devnet-tee.magicblock.app", "confirmed");
  const { PublicKey } = await import("@solana/web3.js");
  const read = async () => { const d = coder.decode("CabinetState", (await er.getAccountInfo(new PublicKey(dev.cabinet))).data); return { ...d, clawX: d.claw_x, clawZ: d.claw_z }; };
  const pad = await page.getByRole("application").boundingBox();
  const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2, R = pad.width / 2 * 0.8;
  const t0 = Date.now();
  let c = await read();
  const caps = c.capsules.filter((k) => k.active && k.kind !== 2);
  const tgt = caps.sort((a, b) => Math.hypot(a.x - c.clawX, a.z - c.clawZ) - Math.hypot(b.x - c.clawX, b.z - c.clawZ))[0];
  log("aim target", tgt.x, tgt.z, "from", c.clawX, c.clawZ);
  // The app moves round(v * 80) grid units per 120 ms tick, so pick n ticks and a vector that lands exactly.
  for (let it = 0; it < 3 && Date.now() - t0 < 7500; it++) {
    const dx = tgt.x - c.clawX, dz = tgt.z - c.clawZ, d = Math.hypot(dx, dz);
    if (d < 15) break;
    const n = Math.ceil(d / 80), vx = dx / n / 80, vz = dz / n / 80;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + vx * R, cy - vz * R);
    await page.waitForTimeout(n * 120 - 50);
    await page.mouse.up();
    await page.waitForTimeout(1100);
    c = await read();
    log("claw at", c.clawX, c.clawZ, "dist", Math.round(Math.hypot(tgt.x - c.clawX, tgt.z - c.clawZ)));
  }
  await page.screenshot({ path: `${OUT}/04b-aimed-390.png` });
} else {
  await page.keyboard.down("ArrowRight"); await page.waitForTimeout(900); await page.keyboard.up("ArrowRight");
  await page.keyboard.down("ArrowUp"); await page.waitForTimeout(700); await page.keyboard.up("ArrowUp");
}
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
