// Whole generation from a description, per-section revise, wipe and undo. Mock host and mock aux model only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'persona-forge.plugin.js'), 'utf8');
const checks = [];
function ok(v, label) { assert(v, label); checks.push(label); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://localhost/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><body></body></html>' }));
      await page.goto('http://localhost/');
      await page.evaluate(() => {
        const storage = new Map();
        window.calls = [];
        window.Risuai = {
          pluginStorage: { getItem: async (k) => storage.get(k), setItem: async (k, v) => storage.set(k, v) },
          addRisuReplacer: async () => {}, registerSetting: async () => {}, registerButton: async () => {}, getRootDocument: async () => null,
          getDatabase: async () => ({ personas: [], selectedPersona: -1 }), showContainer: async () => {}, hideContainer: async () => {},
          getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, getChatFromIndex: async () => null,
          getCharacter: async () => null, readImage: async () => null,
          runLLMModel: async ({ messages }) => {
            const [sys, user] = messages.map((m) => m.content); calls.push({ sys, user });
            if (/NovelAI character tags/.test(sys)) return { result: JSON.stringify({tags: '1girl, black hair, black hair, brown eyes'}) };
            if (/full character sheet/.test(sys)) return { result: JSON.stringify({ name: '', gender: 'female', ageMode: 'input', age: '22', era: 'medieval', job: 'SHOULD NOT APPLY', basic: 'Height: 160cm', look: '- Hair: silver; long', personality: '- Temper: cold outside; soft inside', past: 'Youngest daughter of a fallen house.', skills: '- Heraldry: reads crests' }) };
            if (/You edit one section \("look"\)/.test(sys)) return { result: '{"look": "- Hair: black; long"}' };
            return { result: '{}' };
          },
        };
      });
      await page.addScriptTag({ content: source });
      await page.evaluate(() => __personaForge.openForge());
      const val = (sel) => page.locator(sel).inputValue();
      const preview = () => page.evaluate(() => document.getElementById('preview2')?.textContent || '');

      ok(await page.locator('#briefcard[open]').count() === 1, `${width}: description card open on basic step`);
      await page.locator('#wholegen').click();
      ok(await page.evaluate(() => calls.length) === 0, `${width}: empty description does not call the model`);

      await page.locator('[data-f="job"]').fill('Archivist');
      await page.locator('[data-dir="brief"]').fill('Fallen noble daughter, silver hair, cold but soft, good at heraldry.');
      await page.locator('#wholegen').click();
      await page.waitForFunction(() => calls.length === 1);
      await page.waitForFunction(() => /silver/.test(document.getElementById('preview2')?.textContent || ''));
      const c1 = await page.evaluate(() => calls[0]);
      ok(c1.user.includes('Fallen noble daughter'), `${width}: description sent`);
      ok(/Write only these keys: .*look/.test(c1.user) && !/Write only these keys: [^\n]*\bjob\b/.test(c1.user), `${width}: filled job is not requested`);
      let pv = await preview();
      ok(pv.includes('Archivist') && !pv.includes('SHOULD NOT APPLY'), `${width}: filled job kept`);
      ok(pv.includes('22') && /female/i.test(pv) && pv.includes('Height: 160cm') && pv.includes('Heraldry') && pv.includes('fallen house'), `${width}: empty fields filled`);
      ok(await page.locator('[data-undo]').count() >= 1, `${width}: undo offered`);

      await page.locator('.steps [data-step="look"]').click();
      ok((await val('[data-f="look"]')).includes('silver'), `${width}: look text written`);
      await page.locator('[data-revise="look"]').click();
      ok(await page.evaluate(() => calls.length) === 1, `${width}: revise without request does not call the model`);
      await page.locator('[data-dir="look"]').fill('make the hair black');
      await page.locator('[data-revise="look"]').click();
      await page.waitForFunction(() => calls.length === 2);
      await page.waitForFunction(() => (document.querySelector('[data-f="look"]')?.value || '').includes('black'));
      const c2 = await page.evaluate(() => calls[1]);
      ok(c2.user.includes('Current Appearance:\n- Hair: silver; long') && c2.user.includes('Change request: make the hair black'), `${width}: revise sends current text and request`);
      ok(c2.user.includes('Youngest daughter'), `${width}: revise sees other sections`);

      await page.locator('#nai-generate').click();
      await page.waitForFunction(() => document.querySelector('#nai-tags')?.value === '1girl, black hair, brown eyes');
      const naiCall = await page.evaluate(() => calls.at(-1));
      ok(naiCall.sys.includes('Exclude artist names, art style, quality'), `${width}: character-only instruction`);
      ok(JSON.parse(naiCall.user).appearance.includes('black'), `${width}: current appearance supplied`);
      await page.locator('#nai-tags').fill('1girl, silver hair');
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable:true, value: {writeText:async text => { window.copiedTags=text; }} }));
      await page.locator('#nai-copy').click();
      ok(await page.evaluate(() => copiedTags) === '1girl, silver hair', `${width}: copy edited tags`);
      await page.locator('.steps [data-step="skills"]').click();
      ok(await page.locator('[data-revise="skills"]').count() === 1 && await page.locator('[data-gen="skills"]').count() === 1, `${width}: skills text mode has generate and revise`);

      await page.locator('.steps [data-step="basic"]').click();
      await page.locator('#wipeall').click();
      ok((await val('[data-f="job"]')) === 'Archivist', `${width}: wipe asks twice`);
      await page.locator('#wipeall').click();
      pv = await preview();
      ok((await val('[data-f="job"]')) === '' && !pv.includes('silver') && !pv.includes('black') && !pv.includes('Heraldry'), `${width}: wipe clears all fields`);
      await page.locator('[data-undo]').first().click();
      pv = await preview();
      ok((await val('[data-f="job"]')) === 'Archivist' && pv.includes('black'), `${width}: undo restores wiped draft`);
      ok(!errors.length, `${width}: no page errors ${errors.join('; ')}`);
    }
    console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); console.error('passed before failure:', checks.length); process.exit(1); });
