// Window mode, size toggle and Escape. Mock host only. A fake badge sits in the top-right corner like bot badges do.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'persona-forge.plugin.js'), 'utf8');
const shots = process.env.SHOTS || '';
const checks = [];
function ok(v, label) { assert(v, label); checks.push(label); }
const BADGE = { w: 64, h: 64 }; // corner area a badge (top:8px;right:8px;56px) covers
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [w, h] of [[1920, 1080], [1280, 800], [390, 844], [320, 640]]) {
      const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://localhost/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><body></body></html>' }));
      await page.goto('http://localhost/');
      await page.evaluate(() => {
        const st = new Map(); window.st = st; window.hidden = 0;
        window.Risuai = { pluginStorage: { getItem: async (k) => st.get(k), setItem: async (k, v) => st.set(k, JSON.parse(JSON.stringify(v))) }, addRisuReplacer: async () => {}, registerSetting: async () => {}, registerButton: async () => {}, getRootDocument: async () => null,
          getDatabase: async () => ({ personas: [], selectedPersona: -1 }), showContainer: async () => {}, hideContainer: async () => { hidden++; }, getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, getChatFromIndex: async () => null, getCharacter: async () => null, readImage: async () => null };
      });
      await page.addScriptTag({ content: source });
      await page.evaluate(() => __personaForge.openForge());
      ok(await page.evaluate(() => document.documentElement.dataset.win) === 'window', `${w}: opens as a window by default`);
      for (const id of ['#close', '#winsize', '#opensettings']) {
        const b = await page.locator(id).boundingBox();
        ok(!(b.x + b.width > w - BADGE.w && b.y < BADGE.h), `${w}: ${id} clear of the top-right badge corner`);
        ok(b.y >= 0 && b.x + b.width <= w, `${w}: ${id} on screen`);
      }
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}: no horizontal overflow`);
      const bar = await page.locator('.bar').boundingBox();
      ok(bar && bar.y + bar.height <= h, `${w}: bottom bar visible inside the window`);
      if (shots) await page.screenshot({ path: `${shots}/pf-window-${w}.png` });
      await page.locator('#winsize').click();
      ok(await page.evaluate(() => document.documentElement.dataset.win) === 'full', `${w}: toggles to full screen`);
      ok(await page.evaluate(() => [...st.values()].some((v) => v && v.winSize === 'full')), `${w}: size choice saved`);
      const app = await page.locator('.app').boundingBox();
      ok(Math.abs(app.width - w) < 2 && Math.abs(app.height - h) < 2, `${w}: full screen fills the viewport`);
      await page.locator('#winsize').click();
      ok(await page.evaluate(() => document.documentElement.dataset.win) === 'window', `${w}: toggles back to window`);
      await page.locator('#opensettings').click();
      await page.locator('#scrim').waitFor();
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => hidden) === 0 && await page.locator('#scrim').count() === 0, `${w}: Escape closes an open sheet only`);
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => hidden) === 1, `${w}: Escape closes the workshop`);
      ok(!errors.length, `${w}: no page errors ${errors.join('; ')}`);
    }
    console.log(JSON.stringify({ ok: true, checks: checks.length }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); console.error('passed before failure:', checks.length); process.exit(1); });
