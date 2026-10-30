// 0.3.8 storage layout: per-version keys, inject split from settings, no-op skip, stale link pruning, storage panel.
// Mock host only.
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
        const put = (k, v) => storage.set(k, JSON.parse(JSON.stringify(v)));
        // 0.3.7 layout: whole vault in one key, injected sheets inside settings
        put('persona_forge:profiles', [
          { id: 'a', name: 'Alice', look: 'red', updated: 2 },
          { id: 'b', name: 'Bob', look: 'blue', updated: 1 },
        ]);
        put('persona_forge:v1', { lang: 'en', links: { 'persona-live': 'a', 'persona-gone': 'b', 'persona-live2': 'deleted-profile' }, inject: { 'chat-1': { text: 'INJECTED SHEET', name: 'Alice', label: '', where: 'Bot · chat' } } });
        window.writes = []; window.storage = storage;
        window.Risuai = {
          pluginStorage: {
            getItem: async (k) => (storage.has(k) ? JSON.parse(JSON.stringify(storage.get(k))) : undefined),
            setItem: async (k, v) => { writes.push(k); put(k, v); },
            removeItem: async (k) => { writes.push('-' + k); storage.delete(k); },
          },
          addRisuReplacer: async () => {}, registerSetting: async () => {}, registerButton: async () => {}, getRootDocument: async () => null,
          getDatabase: async () => ({ personas: [{ id: 'persona-live', name: 'Alice' }, { id: 'persona-live2', name: 'X' }], selectedPersona: -1 }),
          showContainer: async () => {}, hideContainer: async () => {},
          getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
          getChatFromIndex: async () => ({ id: 'chat-1', name: 'chat' }), getCharacter: async () => ({ name: 'Bot' }), readImage: async () => null,
          runLLMModel: async () => ({ result: '{}' }),
        };
      });
      await page.addScriptTag({ content: source });
      await page.waitForFunction(() => window.__personaForge);
      const F = (fn, arg) => page.evaluate(fn, arg);
      await page.waitForTimeout(200);

      // migration
      const list = await F(() => __personaForge.readProfiles());
      ok(list.length === 2 && list[0].id === 'a', `${width}: vault read after migration`);
      const keys = await F(() => [...storage.keys()].sort());
      ok(!keys.includes('persona_forge:profiles') && keys.includes('persona_forge:p:a') && keys.includes('persona_forge:p:b') && keys.includes('persona_forge:ids'), `${width}: one key per version, old key removed`);
      const st = await F(() => storage.get('persona_forge:v1'));
      ok(!('inject' in st) && (await F(() => storage.get('persona_forge:inject')['chat-1'].text)) === 'INJECTED SHEET', `${width}: injected sheets moved out of settings`);
      const out = await F(() => __personaForge.beforeRequest([{ role: 'user', content: 'hi', memo: 'x' }], 'model'));
      ok(out.some((m) => m.role === 'system' && m.content.includes('INJECTED SHEET')), `${width}: migrated injection still applied`);

      // writes
      await F(() => { writes.length = 0; });
      await F(() => __personaForge.saveSettings());
      ok((await F(() => writes.length)) === 0, `${width}: unchanged settings are not written`);
      const p = (await F(() => __personaForge.readProfiles())).find((x) => x.id === 'b');
      await F((p) => __personaForge.saveProfile({ ...p, look: 'green' }), p);
      ok(JSON.stringify(await F(() => writes)) === JSON.stringify(['persona_forge:p:b']), `${width}: editing one version writes only that version`);
      await F(() => { writes.length = 0; });
      const p2 = (await F(() => __personaForge.readProfiles())).find((x) => x.id === 'b');
      await F((p) => __personaForge.saveProfile(p), p2);
      ok((await F(() => writes.length)) === 0, `${width}: saving an unchanged version writes nothing`);
      await F(() => __personaForge.saveProfile({ name: 'Cara', look: 'new' }));
      const w3 = await F(() => writes);
      ok(w3.length === 2 && w3[0].startsWith('persona_forge:p:') && w3[1] === 'persona_forge:ids', `${width}: new version writes itself and the order`);
      await F(() => { writes.length = 0; });
      await F(() => __personaForge.deleteProfile('b'));
      ok(JSON.stringify(await F(() => writes)) === JSON.stringify(['persona_forge:ids', '-persona_forge:p:b']), `${width}: delete rewrites order and removes the version`);

      // storage panel; links: persona-gone (persona missing) and persona-live2 (profile missing) are stale. Opening
      // the forge prunes them automatically, so put them back first to see the panel's count.
      await F(() => __personaForge.openForge());
      ok(JSON.stringify(await F(() => Object.keys(storage.get('persona_forge:v1').links))) === JSON.stringify(['persona-live']), `${width}: opening prunes stale links`);
      await page.locator('#opensettings').click();
      await page.locator('#stor-box .stor').waitFor();
      const txt = await page.locator('#stor-box').textContent();
      ok(/보관함\s*2판/.test(txt) && /채팅 설명 주입\s*1개/.test(txt) && /연결 1개/.test(txt) && /합계/.test(txt), `${width}: storage panel shows vault, inject, links, total`);
      ok(await page.locator('#stor-prune').isDisabled(), `${width}: nothing to prune`);
      const geo = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
      ok(geo.sw <= geo.w + 1, `${width}: no horizontal overflow`);
      await page.locator('#stor-vault').click();
      await page.waitForFunction(() => document.querySelector('[data-tab="vault"]')?.classList.contains('on'));
      ok(/KB|B/.test(await page.locator('.item small').first().textContent()), `${width}: vault rows show size`);
      if (width === 390) await page.screenshot({ path: path.resolve(__dirname, '..', 'shots', 'storage-vault.390.png') });
      await page.locator('#opensettings').click();
      await page.locator('#stor-box .stor').waitFor();
      await page.locator('.sheet').screenshot({ path: path.resolve(__dirname, '..', 'shots', `storage-panel.${width}.png`) });
      ok(errors.length === 0, `${width}: no page errors ${errors.join(' | ')}`);
    }
    console.log(JSON.stringify({ ok: true, checks: checks.length }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
