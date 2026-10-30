"""Build whole-frame 832x1216 WebPs and one gallery thumbnail sprite (loaded on demand). No retouching."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets-src/personas'
DEST = ROOT / 'templates/personas'
PLUGIN = ROOT / 'persona-forge.plugin.js'


def atomic(path, content):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        f.write(content)
        name = f.name
    os.replace(name, path)


def main():
    catalog = json.loads((SOURCE / 'catalog.json').read_text())
    assert catalog['baseUrl'].startswith('https://raw.githubusercontent.com/') and catalog['baseUrl'].endswith('/')
    original = PLUGIN.read_bytes()
    DEST.mkdir(parents=True, exist_ok=True)
    items, manifest, seen, thumbs = [], [], set(), []
    TW, TH, COLS = 208, 304, 10
    for entry in catalog['items']:
        slug = entry['id']
        assert re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', slug) and slug not in seen
        seen.add(slug)
        src = SOURCE / (slug + '.png')
        source_bytes = src.read_bytes()
        with Image.open(src) as image:
            native = image.size
            assert abs(native[0] / native[1] - 832 / 1216) < 0.005, 'Source aspect ratio needs review; do not crop'
            portrait = image.convert('RGB').resize((832, 1216), Image.Resampling.LANCZOS)
        full = io.BytesIO()
        portrait.save(full, format='WEBP', quality=90, method=6)
        payload = full.getvalue()
        digest = hashlib.sha256(payload).hexdigest()
        filename = f'{slug}-{digest[:12]}.webp'
        atomic(DEST / filename, payload)
        thumbs.append(portrait.resize((TW, TH), Image.Resampling.LANCZOS))
        item = dict(entry, file=filename, width=832, height=1216, bytes=len(payload), sha256=digest, cell=len(thumbs) - 1)
        manifest.append(dict(item, source=src.relative_to(ROOT).as_posix(), nativeWidth=native[0], nativeHeight=native[1], sourceSha256=hashlib.sha256(source_bytes).hexdigest()))
        items.append(item)
    rows = (len(thumbs) + COLS - 1) // COLS
    sheet = Image.new('RGB', (TW * COLS, TH * rows), (0, 0, 0))
    for i, t in enumerate(thumbs):
        sheet.paste(t, ((i % COLS) * TW, (i // COLS) * TH))
    buf = io.BytesIO()
    sheet.save(buf, format='WEBP', quality=78, method=6)
    sprite = buf.getvalue()
    sprite_digest = hashlib.sha256(sprite).hexdigest()
    sprite_name = f'thumbs-{sprite_digest[:12]}.webp'
    for old in DEST.glob('thumbs-*.webp'):
        if old.name != sprite_name:
            old.unlink()
    atomic(DEST / sprite_name, sprite)
    sprite_meta = dict(file=sprite_name, bytes=len(sprite), sha256=sprite_digest, cols=COLS, w=TW, h=TH, width=TW * COLS, height=TH * rows)
    start = '// BEGIN GENERATED PORTRAIT CATALOG (scripts/build-portraits.py)'
    end = '// END GENERATED PORTRAIT CATALOG'
    text = original.decode()
    assert text.count(start) == text.count(end) == 1
    before, rest = text.split(start, 1)
    _, after = rest.split(end, 1)
    block = start + '\nconst PORTRAIT_BASE = ' + json.dumps(catalog['baseUrl']) + ';\nconst PORTRAIT_THUMBS = ' + json.dumps(sprite_meta) + ';\nconst PORTRAITS = ' + json.dumps(items, ensure_ascii=False, separators=(',', ':')) + ';\n' + end
    assert PLUGIN.read_bytes() == original, 'Plugin changed while building; retry with current file'
    atomic(PLUGIN, (before + block + after).encode())
    atomic(ROOT / 'templates/personas/manifest.json', json.dumps({'schema': 1, 'width': 832, 'height': 1216, 'baseUrl': catalog['baseUrl'], 'thumbs': sprite_meta, 'items': manifest}, ensure_ascii=False, indent=2).encode())
    print(json.dumps({'portraits': len(items), 'dimensions': [832, 1216], 'downloadBytes': sum(x['bytes'] for x in items), 'thumbSprite': sprite_meta, 'pluginBytes': PLUGIN.stat().st_size}))


if __name__ == '__main__':
    main()
