"""Build and verify a deterministic runtime-only Chrome ZIP."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
files = ['manifest.json', 'contentscript.js', 'site-rules.js', 'popup.html',
         'popup.js', 'options.html', 'options.js', 'ui.css', 'ui-settings.js',
         'icon48.png', 'icon64.png', 'icon128.png', 'icon256.png']
assert manifest['version'] == json.loads((root / 'package.json').read_text())['version']
output = root / 'dist' / f"chrome-backspace-back-v{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (root / name).read_bytes())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert sorted(archive.namelist()) == sorted(files)
    for name in files:
        assert archive.read(name) == (root / name).read_bytes(), name
checksum = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.zip.sha256').write_text(f'{checksum}  {output.name}\n')
print(f'{output}\n{len(files)} runtime files; {output.stat().st_size} bytes\nSHA256 {checksum}')
