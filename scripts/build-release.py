"""Generate the GitHub update manifest from the release bundle."""
import hashlib,json,re
from pathlib import Path
root=Path(__file__).resolve().parent.parent
payload=(root/'persona-forge.plugin.js').read_bytes()
version=re.search(rb'^//@version (.+)$',payload,re.M)[1].decode()
assert f"const RELEASE_VERSION = '{version}';".encode() in payload
out=root/'update/latest.json';out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(dict(schema=1,name='persona_forge',version=version,url=f'https://raw.githubusercontent.com/canister2668/Risu-persona-forge/v{version}/persona-forge.plugin.js',bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest()),indent=2)+'\n')
print(version)
