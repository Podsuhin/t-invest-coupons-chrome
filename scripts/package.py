"""Create a reproducible, source-only Chrome extension archive."""
from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
manifest = json.loads((source / 'manifest.json').read_text())
required = [manifest['action']['default_popup'], manifest['background']['service_worker']]
required += list(manifest['icons'].values())
for path in required:
    assert (source / path).is_file(), f'Missing: {path}'
out = root / 'artifacts'
out.mkdir(exist_ok=True)
archive = out / 't-invest-coupons-chrome.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as z:
    files = [(p, 'extension/' + p.relative_to(source).as_posix())
             for p in sorted(source.rglob('*')) if p.is_file() and not p.name.startswith('.')]
    files.append((root / 'README.md', 'README.md'))
    for path, name in files:
        item = ZipInfo(name, (2026, 9, 14, 0, 0, 0))
        item.compress_type = ZIP_DEFLATED
        item.external_attr = 0o644 << 16
        z.writestr(item, path.read_bytes())
with ZipFile(archive) as z:
    assert z.testzip() is None
    assert 'extension/manifest.json' in z.namelist()
    assert not any('node_modules' in name for name in z.namelist())
print(f'Created {archive.name}: {archive.stat().st_size:,} bytes, {len(files)} files')
