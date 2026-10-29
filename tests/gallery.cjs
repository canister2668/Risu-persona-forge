// Browser checks with a mock host. No live data, paid model, or remote download.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/personas/manifest.json')));
const source = fs.readFileSync(path.join(ROOT, 'persona-forge.plugin.js'), 'utf8');
const checks = [];
function ok(value, label) { assert(value, label); checks.push(label); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://localhost/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><body></body></html>' }));
      await page.route('https://raw.githubusercontent.com/**', (r) => {
        const file = new URL(r.request().url()).pathname.split('/').pop();
        assert(manifest.items.some((x) => x.file === file));
        return r.fulfill({ contentType: 'image/webp', body: fs.readFileSync(path.join(ROOT, 'templates/personas', file)) });
      });
      await page.goto('http://localhost/');
      await page.evaluate(() => {
        const assets = new Map(), storage = new Map();
        window.testStorage = storage;
        window.probe = { downloads: 0, saves: 0, writes: 0, mode: 'ok' };
        window.Risuai = {
          pluginStorage: { getItem: async (key) => storage.get(key), setItem: async (key, value) => { probe.writes++; storage.set(key, value); } },
          addRisuReplacer: async () => {}, registerSetting: async () => {}, registerButton: async () => {}, getRootDocument: async () => null,
          getDatabase: async () => ({ personas: [], selectedPersona: -1 }), showContainer: async () => {}, hideContainer: async () => {},
          getCurrentCharacterIndex: async () => 0, getCurrentChatIndex: async () => 0, getChatFromIndex: async () => null,
          nativeFetch: async (url, options) => {
            probe.downloads++;
            if (probe.mode === 'delay') await new Promise((resolve) => { window.releaseDownload = resolve; });
            if (probe.mode === 'fail') return new Response('offline', { status: 503 });
            const res = await fetch(url, options), bytes = new Uint8Array(await res.arrayBuffer());
            if (probe.mode === 'corrupt') bytes[bytes.length - 1] ^= 1;
            return new Response(bytes, { status: 200 });
          },
          saveAsset: async (bytes) => { if (probe.mode === 'savefail') throw new Error('저장 실패'); probe.saves++; const key = 'assets/test-' + probe.saves + '.webp'; assets.set(key, bytes); return key; },
          readImage: async (key) => assets.get(key),
        };
      });
      await page.addScriptTag({ content: source });
      await page.evaluate(() => __personaForge.openForge());
      await page.locator('[data-f="name"]').fill('기존 이름');
      await page.locator('[data-f="job"]').fill('기존 직업');
      const open = async () => { await page.locator('#ava').click(); await page.locator('#iconlibrary').click(); await page.locator('.portrait-sheet').waitFor(); };
      const choose = async (id) => { await page.locator('[data-portrait-category="전체"]').click(); await page.locator(`[data-portrait="${id}"]`).click(); };
      const beforePreview = await page.locator('#preview2').textContent();
      await open();
      ok((await page.locator('[data-portrait]').first().getAttribute('data-portrait')).startsWith('belladonna-'), `${width}: new images first`);
      ok(await page.locator('[data-portrait]').count() === manifest.items.length, `${width}: all images available`);
      ok(await page.evaluate(() => { const nodes=[document.querySelector('.portrait-sheet'),...document.querySelectorAll('.portrait-sheet *')]; const scroll=nodes.filter(e=>/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1); return scroll.length===1 && scroll[0].classList.contains('portrait-body'); }), `${width}: only one scrolling region in image chooser`);
      const footerBefore = await page.locator('#portrait-use').boundingBox();
      await page.locator('.portrait-body').evaluate(e => e.scrollTop=e.scrollHeight);
      const footerAfter = await page.locator('#portrait-use').boundingBox();
      ok(Math.abs(footerBefore.y-footerAfter.y)<1 && footerAfter.y+footerAfter.height<=900, `${width}: apply stays visible while browsing`);
      await page.locator('.portrait-body').evaluate(e => e.scrollTop=0);
      ok(await page.evaluate(() => probe.downloads === 0 && probe.saves === 0), `${width}: gallery loads without network or writes`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('.sheet').getBoundingClientRect().right <= innerWidth), `${width}: gallery fits viewport`);
      ok(await page.evaluate(() => [...document.querySelectorAll('.portrait-tile')].every((tile) => tile.querySelector('b').getBoundingClientRect().bottom <= tile.getBoundingClientRect().bottom + 1)), `${width}: portrait names are not clipped`);
      ok(await page.evaluate(() => { const r = document.querySelector('.portrait-detail img').getBoundingClientRect(); return Math.abs(r.width / r.height - 13 / 19) < 0.02; }), `${width}: detail preview keeps portrait aspect ratio`);
      await page.locator('[data-portrait-category="판타지"]').click();
      ok(await page.locator('[data-portrait]:visible').count() === manifest.items.filter(p => p.category === '판타지').length, `${width}: category filter`);
      await page.locator('[data-portrait-category="전체"]').click();
      await page.locator('#portrait-species').selectOption('인간');
      await page.locator('#portrait-age').selectOption('노년');
      ok(await page.locator('[data-portrait]:visible').count() === manifest.items.filter(p => p.species === '인간' && p.ageGroup === '노년').length, `${width}: species and age intersect with both genders`);
      await page.locator('#portrait-species').selectOption('엘프');
      await page.locator('[data-portrait-category="SF"]').click();
      ok(await page.locator('[data-portrait]:visible').count() === 0 && await page.locator('#portrait-use').isDisabled(), `${width}: empty filters prevent apply`);
      await page.locator('#portrait-species').selectOption('인간');
      await page.locator('[data-portrait-category="전체"]').click();
      ok(await page.locator('#portrait-use').isEnabled(), `${width}: recovering filters enables apply`);
      await page.keyboard.press('Escape');
      ok(await page.locator('.sheet').count() === 0 && await page.evaluate(() => document.activeElement.id === 'ava'), `${width}: Escape restores avatar focus`);
      ok(await page.locator('#preview2').textContent() === beforePreview, `${width}: cancel preserves text`);
      await open(); await choose('modern-man');
      await page.evaluate(() => { probe.mode = 'fail'; }); await page.locator('#portrait-use').click();
      await page.locator('#portrait-status.error').waitFor();
      ok(await page.evaluate(() => probe.saves === 0 && !document.querySelector('#portrait-use').disabled), `${width}: download failure offers retry without mutation`);
      await page.evaluate(() => { probe.mode = 'ok'; }); await page.locator('#portrait-use').click();
      await page.locator('.sheet').waitFor({ state: 'detached' });
      ok(await page.evaluate(() => probe.downloads === 2 && probe.saves === 1 && probe.writes === 0), `${width}: retry downloads once and saves only an asset`);
      ok(await page.locator('[data-f="name"]').inputValue() === '기존 이름' && await page.locator('[data-f="job"]').inputValue() === '기존 직업' && await page.locator('#preview2').textContent() === beforePreview, `${width}: applying image preserves authored settings`);
      const icon = await page.locator('#ava').getAttribute('style');
      ok(icon.includes('blob:'), `${width}: saved portrait renders`);
      await open(); await choose('modern-man'); await page.locator('#portrait-use').click(); await page.locator('.sheet').waitFor({ state: 'detached' });
      ok(await page.evaluate(() => probe.downloads === 2), `${width}: successful download is reused`);
      await open(); await choose('modern-woman'); await page.evaluate(() => { probe.mode = 'corrupt'; }); await page.locator('#portrait-use').click();
      await page.locator('#portrait-status.error').waitFor();
      ok((await page.locator('#portrait-status').textContent()).includes('일치하지'), `${width}: hash mismatch rejected`);
      const savesBefore = await page.evaluate(() => probe.saves);
      await page.locator('#portrait-cancel').click();
      await open(); await choose('sf-man'); await page.evaluate(() => { probe.mode = 'delay'; }); await page.locator('#portrait-use').click();
      await page.waitForFunction(() => !!window.releaseDownload);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { probe.mode = 'ok'; window.releaseDownload(); });
      await page.waitForTimeout(200);
      ok(await page.evaluate(() => probe.saves) === savesBefore && await page.locator('.sheet').count() === 0, `${width}: close during download prevents later save`);
      await open(); await choose('fantasy-man'); await page.evaluate(() => { probe.mode = 'savefail'; }); await page.locator('#portrait-use').click();
      await page.locator('#portrait-status.error').waitFor();
      ok(await page.evaluate(() => probe.saves) === savesBefore, `${width}: failed asset write preserves draft`);
      await page.locator('#portrait-cancel').click();
      await open(); await choose('dragon-elder-woman');
      await page.evaluate(() => { probe.mode = 'ok'; }); await page.locator('#portrait-use').click();
      await page.locator('.sheet').waitFor({ state: 'detached' });
      ok(await page.evaluate(() => probe.saves) === savesBefore + 1, `${width}: added portrait downloads and saves`);
      const savedManual = await page.locator('#ava').getAttribute('style');
      await page.locator('[data-seg="gender"] [data-v="female"]').click();
      ok(await page.locator('#ava').getAttribute('style') === savedManual, `${width}: manually selected image survives toggles`);
      await page.locator('[data-sel="era"]').selectOption('medieval');
      await page.locator('#portrait-auto').click();
      await page.locator('[data-f="age"]').fill('10');
      ok((await page.locator('#portrait-auto-status').textContent()).includes('서연 · 아동'), `${width}: child female auto match`);
      await page.evaluate(() => { probe.mode = 'fail'; });
      const writesBeforeAuto = await page.evaluate(() => probe.writes);
      await page.locator('#tovault').click();
      await page.waitForFunction(() => !document.querySelector('#tovault').disabled);
      ok(await page.evaluate(() => probe.writes) === writesBeforeAuto, `${width}: failed auto download does not persist profile`);
      await page.evaluate(() => { probe.mode = 'delay'; window.releaseDownload = null; });
      await page.locator('#tovault').click();
      await page.waitForFunction(() => !!window.releaseDownload);
      await page.locator('[data-seg="gender"] [data-v="male"]').click();
      await page.evaluate(() => { probe.mode = 'ok'; window.releaseDownload(); });
      await page.waitForFunction(() => !document.querySelector('#tovault').disabled);
      ok(await page.evaluate(() => probe.writes) === writesBeforeAuto, `${width}: auto selection change during download prevents stale profile write`);
      await page.locator('[data-seg="gender"] [data-v="female"]').click();
      const beforeAuto = await page.evaluate(() => probe.downloads);
      await page.locator('[data-f="age"]').fill('74');
      ok((await page.locator('#portrait-auto-status').textContent()).includes('서연 · 노년'), `${width}: age changes auto portrait`);
      await page.locator('[data-sel="race"]').selectOption('dragon');
      ok((await page.locator('#portrait-auto-status').textContent()).includes('세린 · 노년'), `${width}: species changes auto portrait`);
      ok(await page.evaluate(() => probe.downloads) === beforeAuto, `${width}: auto preview needs no download`);
      await page.locator('#tovault').click();
      await page.waitForFunction(() => [...testStorage.values()].some(x => Array.isArray(x) && x.some(p => p.portraitMode === 'auto' && p.portraitId === 'belladonna-p10-elder-1' && p.icon)));
      ok(true, `${width}: saving resolves auto image to persistent asset`);
      await page.locator('[data-seg="gender"] [data-v="male"]').click();
      ok((await page.locator('#portrait-auto-status').textContent()).includes('카엘 · 노년'), `${width}: auto mode remains active after save`);
      await page.locator('[data-f="age"]').fill('10');
      ok((await page.locator('#portrait-auto-status').textContent()).includes('카엘 · 아동'), `${width}: new dragon child combination available`);
      await page.locator('[data-sel="race"]').selectOption('human');
      await page.locator('[data-f="age"]').fill('25');
      await page.locator('[data-sel="era"]').selectOption('future');
      ok((await page.locator('#portrait-auto-status').textContent()).includes('우주 항해사'), `${width}: future era selects SF portrait`);
      await page.locator('#iconfile').setInputFiles({ name: 'custom.webp', mimeType: 'image/webp', buffer: fs.readFileSync(path.join(ROOT, 'templates/personas', manifest.items[0].file)) });
      await page.waitForFunction(() => document.querySelector('#portrait-auto-status')?.textContent.includes('직접 선택'));
      const customIcon = await page.locator('#ava').getAttribute('style');
      await page.locator('[data-seg="gender"] [data-v="female"]').click();
      ok(await page.locator('#ava').getAttribute('style') === customIcon, `${width}: uploaded custom image survives toggles`);
      await page.locator('#portrait-templates').click();
      ok(await page.locator('.portrait-sheet').count() === 1, `${width}: direct template chooser opens`);
      await page.keyboard.press('Escape');
      ok(errors.length === 0, `${width}: no uncaught browser errors`);
      await context.close();
    }
    const groups = new Map();
    for (const item of manifest.items) {
      const key = item.species + '/' + item.ageGroup;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(item.gender);
    }
    for (const [key, genders] of groups) ok(genders.has('male') && genders.has('female'), key + ': both gender counterparts present');
    for (const item of manifest.items) {
      const bytes = fs.readFileSync(path.join(ROOT, 'templates/personas', item.file));
      ok(bytes.length === item.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === item.sha256, item.id + ': manifest matches image');
    }
    console.log(JSON.stringify({ passed: true, checks: checks.length, details: checks }, null, 2));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
