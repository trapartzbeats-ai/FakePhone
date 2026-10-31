# Turns the 1024 px icon render into build/icon.png (1024, the Mac icon) and build/icon.ico (16-256, Windows).
# python tools/make-icon.py exports/_dev/icon-1024.png
import sys
from pathlib import Path
from PIL import Image

src = Image.open(sys.argv[1]).convert('RGBA')
out = Path(__file__).resolve().parent.parent / 'build'
out.mkdir(exist_ok=True)
src.save(out / 'icon.png')
src.save(out / 'icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
# a strip of the small sizes, to check they still read
strip = Image.new('RGBA', (16 + 24 + 32 + 48 + 64 + 6 * 8, 64), (40, 40, 44, 255))
x = 8
for s in (16, 24, 32, 48, 64):
    strip.alpha_composite(src.resize((s, s), Image.LANCZOS), (x, 64 - s))
    x += s + 8
strip.resize((strip.width * 4, strip.height * 4), Image.NEAREST).save(out.parent / 'exports' / '_dev' / 'icon-sizes.png')
print('ok', out)
