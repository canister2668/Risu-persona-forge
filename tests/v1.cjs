// 1.0.0 features: aux JSON repair/re-ask, relationship line, token estimate, file backup/import, version compare,
// injection refresh, bot default persona, thumbnail fallback. Mock host and mock model only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'persona-forge.plugin.js'), 'utf8');
const checks = [];
function ok(v, label) { assert(v, label); checks.push(label); }

async function setup(browser, width, { fetchFails = false } = {}) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('http://localhost/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><body></body></html>' }));
  await page.goto('http://localhost/');
  await page.evaluate((fetchFails) => {
    const storage = new Map(), assets = new Map();
    window.storage = storage; window.assets = assets; window.llm = []; window.llmQueue = [];
    window.chat = { id: 'chat-1', name: 'chat', bindedPersona: '' };
    window.Risuai = {
      pluginStorage: {
        getItem: async (k) => (storage.has(k) ? JSON.parse(JSON.stringify(storage.get(k))) : undefined),
        setItem: async (k, v) => storage.set(k, JSON.parse(JSON.stringify(v))), removeItem: async (k) => storage.delete(k),
      },
      addRisuReplacer: async () => {}, registerSetting: async () => {}, registerButton: async () => {}, getRootDocument: async () => null,
      getDatabase: async () => ({ personas: [], selectedPersona: -1 }), showContainer: async () => {}, hideContainer: async () => {},
      getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0,
      getChatFromIndex: async () => JSON.parse(JSON.stringify(window.chat)),
      getCharacter: async () => ({ chaId: 'bot-1', name: 'TestBot' }),
      readImage: async (k) => assets.get(k), saveAsset: async (b) => { const k = 'assets/a' + assets.size + '.png'; assets.set(k, b); return k; },
      nativeFetch: async () => (fetchFails ? new Response('offline', { status: 503 }) : new Response('x', { status: 500 })),
      runLLMModel: async ({ messages }) => { llm.push(messages); return { result: llmQueue.length ? llmQueue.shift() : '{}' }; },
    };
  }, fetchFails);
  await page.addScriptTag({ content: source });
  await page.waitForFunction(() => window.__personaForge);
  return { page, errors, F: (fn, arg) => page.evaluate(fn, arg) };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      const { page, errors, F } = await setup(browser, width);

      // aux JSON
      ok(await F(() => { const P = __personaForge.parseJsonLoose; return P('```json\n{"a":"x",}\n```').a === 'x' && P('{"a":"line1\nline2"}').a === 'line1\nline2' && P('no json') === null; }), `${width}: tolerant JSON parse`);
      await F(() => { llm.length = 0; llmQueue.push('Sure! Here it is: {broken', '{"look":"- Hair: black"}'); });
      ok((await F(() => __personaForge.auxJson('sys', 'user'))).look === '- Hair: black' && (await F(() => llm.length)) === 2, `${width}: unreadable reply is asked again once`);
      await F(() => { llm.length = 0; llmQueue.push('nope', 'still nope'); });
      ok(/JSON/.test(await F(() => __personaForge.auxJson('s', 'u').then(() => '', (e) => e.message))) && (await F(() => llm.length)) === 2, `${width}: two bad replies fail with a clear error`);

      // relationship + tokens
      const sheet = await F(() => __personaForge.composePersona({ ...{}, name: 'Ari', relation: "the hero's childhood friend", lang: 'en', gender: 'none', ageMode: 'omit', era: 'world', origin: 'native', race: 'human', build: 'omit', picks: {}, modes: {}, slots: [] }));
      ok(sheet.includes("- Relationship: the hero's childhood friend"), `${width}: relationship line in sheet`);
      ok((await F((t) => __personaForge.parsePersona(t).relation, sheet)) === "the hero's childhood friend", `${width}: relationship parsed back`);
      ok((await F(() => __personaForge.estTokens('abcdefgh') === 2 && __personaForge.estTokens('가나다나') >= 3)), `${width}: token estimate`);

      await F(() => __personaForge.openForge());
      await page.locator('[data-f="name"]').fill('Ari');
      await page.locator('[data-f="relation"]').fill('같은 반 친구');
      await page.locator('[data-f="relation"]').dispatchEvent('input');
      await page.waitForFunction(() => /같은 반 친구/.test(document.getElementById('preview2')?.textContent || ''));
      ok(/토큰/.test(await page.locator('#sheetcount').textContent()), `${width}: sheet size shows tokens`);

      // save two versions, inject one, then edit -> injection follows
      await page.locator('#tovault').click();
      await page.waitForFunction(() => [...storage.keys()].some((k) => k.startsWith('persona_forge:p:')));
      const pid = await F(() => storage.get('persona_forge:ids')[0]);
      // set an injection through the public path: beforeRequest reads settings.inject; use apply sheet "설명만 주입"
      await page.locator('#applymore').click();
      const injectRadio = page.locator('.sheet input[value="inject"], .sheet [data-mode="inject"], .sheet #ap-inject').first();
      if (await injectRadio.count()) {
        await injectRadio.check().catch(() => injectRadio.click());
        await page.locator('.sheet .btn.pri').last().click();
      } else { await page.keyboard.press('Escape'); }
      const hasInject = await F(() => !!(storage.get('persona_forge:inject') || {})['chat-1']);
      if (hasInject) {
        ok((await F(() => storage.get('persona_forge:inject')['chat-1'].pid)) === pid, `${width}: injection remembers its vault version`);
        await page.locator('[data-f="relation"]').fill('옆집 이웃');
        await page.locator('#tovault').click();
        await page.waitForFunction(() => /옆집 이웃/.test(storage.get('persona_forge:inject')['chat-1'].text));
        ok(true, `${width}: saving the version refreshes its injection`);
      }
      ok(hasInject, `${width}: inject applied from the apply sheet`);

      // second version for compare
      await page.locator('[data-f="label"]').fill('B판');
      await page.locator('#asnew').click().catch(() => {});
      await page.locator('[data-f="relation"]').fill('처음 만나는 사이');
      await page.locator('#tovault').click();
      await page.waitForFunction(() => storage.get('persona_forge:ids').length === 2);
      await page.locator('[data-tab="vault"]').click();
      await page.locator('[data-compare="Ari"]').click();
      await page.locator('#cmpout').waitFor();
      const diff = await page.locator('#cmpout').innerText();
      ok(/^- .*Relationship|^- .*관계/m.test(diff) && /^\+ .*(Relationship|관계)/m.test(diff), `${width}: compare shows removed and added lines`);
      await page.locator('#cmpx').click();

      // export -> wipe -> import
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('h2.sec [data-export=""]').click()]);
      const file = await dl.path(); const text = fs.readFileSync(file, 'utf8'); const data = JSON.parse(text);
      ok(data.format === 'persona_forge.backup' && data.profiles.length === 2, `${width}: backup file has both versions`);
      ok(await F(() => !!JSON.parse(JSON.stringify(window.storage.get('persona_forge:v1'))).lastBackupAt), `${width}: backup time remembered`);
      let st = await F((t) => __personaForge.importProfiles(t), text);
      ok(st.same === 2 && st.added === 0, `${width}: importing the same file adds nothing`);
      const changed = JSON.parse(text); changed.profiles[0].look = '- Hair: changed'; changed.profiles.push({ id: 'other-1', name: 'Bea', look: 'x' });
      st = await F((t) => __personaForge.importProfiles(t), JSON.stringify(changed));
      ok(st.copies === 1 && st.added === 1, `${width}: changed version kept as a copy, new one added`);
      ok(/JSON|백업/.test(await F(() => __personaForge.importProfiles('{"x":1}').then(() => '', (e) => e.message))), `${width}: wrong file rejected`);
      await page.locator('[data-tab="edit"]').click();
      await page.locator('[data-tab="vault"]').click();
      ok(await page.locator('.vgroup').count() === 2, `${width}: vault shows imported people`);
      await page.screenshot({ path: path.join(ROOT, 'shots', `v1-vault.${width}.png`) });

      // bot default persona (first remove the injection through the apply tab)
      await page.locator('[data-tab="apply"]').click();
      await page.locator('[data-unject="chat-1"]').click();
      await page.waitForFunction(() => !(window.storage.get('persona_forge:inject') || {})['chat-1']);
      const out1 = await F(() => __personaForge.beforeRequest([{ role: 'user', content: 'hi', memo: 'x' }], 'model'));
      ok(!out1.some((m) => m.role === 'system'), `${width}: no default yet, nothing injected`);
      await page.locator('[data-tab="apply"]').click();
      await page.locator('#botdef').waitFor();
      const opt = await page.locator('#botdef option').nth(1).getAttribute('value');
      await page.locator('#botdef').selectOption(opt);
      await page.waitForFunction(() => !!(window.storage.get('persona_forge:v1').botDefaults || {})['bot-1']);
      const out2 = await F(() => __personaForge.beforeRequest([{ role: 'user', content: 'hi', memo: 'x' }], 'model'));
      ok(out2.some((m) => m.role === 'system' && /Character Sheet|캐릭터 시트/.test(m.content)), `${width}: bot default injected into an unbound chat`);
      await F(() => { window.chat.bindedPersona = 'persona-x'; });
      const out3 = await F(() => __personaForge.beforeRequest([{ role: 'user', content: 'hi', memo: 'x' }], 'model'));
      ok(!out3.some((m) => m.role === 'system'), `${width}: chat with its own persona is left alone`);
      await F(() => { window.chat.bindedPersona = ''; });
      ok(await page.locator('[data-undef="bot-1"]').count() === 1, `${width}: bot default listed in apply tab`);
      await page.locator('[data-undef="bot-1"]').click();
      await page.waitForFunction(() => !(window.storage.get('persona_forge:v1').botDefaults || {})['bot-1']);
      ok(true, `${width}: bot default removed`);
      await page.screenshot({ path: path.join(ROOT, 'shots', `v1-apply.${width}.png`) });
      ok(errors.length === 0, `${width}: no page errors ${errors.join(' | ')}`);
    }

    // thumbnails unavailable: gallery still opens with name tiles
    const { page, errors, F } = await setup(browser, 390, { fetchFails: true });
    await F(() => __personaForge.openForge());
    await page.locator('#ava').click(); await page.locator('#iconlibrary').click();
    await page.locator('.portrait-sheet').waitFor();
    ok(await page.locator('.portrait-tile .nothumb').count() > 10 && await page.locator('.portrait-tile img').count() === 0, 'offline: gallery opens with placeholder tiles');
    ok(errors.length === 0, 'offline: no page errors');
    console.log(JSON.stringify({ ok: true, checks: checks.length }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
