"""Compare synthetic demo pages on matching production previews.

Install Playwright and its browser as for theme_browser.py, then
`python -m pip install pixelmatch==0.4.0 Pillow`. Capture a baseline with
`python tests/visual_browser.py --output /tmp/main-images`. On the candidate
pass a separate --output and --baseline /tmp/main-images.
"""
import argparse
import json
import os
import re
from pathlib import Path

from PIL import Image
from pixelmatch.contrib.PIL import pixelmatch

from browser_support import assert_production_url, install_playwright_path, launch_browser, new_page

install_playwright_path()
from playwright.sync_api import expect, sync_playwright

PAGES = {
    'ringkasan': 'Ringkasan',
    'transaksi': 'Transaksi',
    'dompet': 'Dompet',
    'impor': 'Impor mutasi',
}


def capture(browser, args, width, height, theme):
    with browser.new_context(
        viewport={'width': width, 'height': height}, device_scale_factor=1,
        is_mobile=width == 390, has_touch=width == 390, color_scheme=theme,
        timezone_id='Europe/Istanbul', reduced_motion='reduce',
    ) as context:
        page = new_page(context)
        page.goto(args.url, wait_until='networkidle')
        expect(page.locator('html')).to_have_attribute('data-theme', theme)
        nav = page.locator('.mobile-nav' if width == 390 else '.sidebar nav')
        for slug, name in PAGES.items():
            tab = nav.get_by_role('button', name=re.compile('^' + re.escape(name) + r'(?:\s+\d+)?$'))
            tab.click()
            expect(tab).to_have_attribute('aria-current', 'page')
            page.mouse.move(0, 0)
            page.evaluate('window.scrollTo(0, 0)')
            page.evaluate('document.fonts.ready')
            # The code revision changes between builds. Keep its label and
            # layout comparable while recording the actual HTML hash below.
            page.get_by_test_id('build-version').evaluate("el => el.textContent = 'build 0000000'")
            file = args.output / f'{slug}-{width}-{theme}.png'
            previous = None
            for _ in range(6):
                frame = page.screenshot(animations='disabled', caret='hide')
                if frame == previous:
                    file.write_bytes(frame)
                    break
                previous = frame
            else:
                raise RuntimeError(f'{file.name}: screenshot did not stabilize')
            yield file


def compare(file, baseline):
    with Image.open(baseline / file.name) as before, Image.open(file) as after:
        width, height = min(before.width, after.width), min(before.height, after.height)
        common = (0, 0, width, height)
        diff = Image.new('RGBA', (max(before.width, after.width), max(before.height, after.height)))
        intersection = Image.new('RGBA', (width, height))
        count = pixelmatch(before.crop(common), after.crop(common), intersection,
                           threshold=0, includeAA=True, diff_mask=True)
        diff.paste(intersection, (0, 0))
        for image in (before, after):
            # Pixels present on only one side count even if those pixels are white.
            count += image.width * image.height - width * height
            if image.width > width:
                diff.paste('red', (width, 0, image.width, image.height))
            if image.height > height:
                diff.paste('red', (0, height, width, image.height))
        diff.save(file.with_suffix('.diff.png'))
        return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--max-diff', type=int, default=0, help='maximum changed pixels per image')
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    args = parser.parse_args()
    if args.baseline and args.baseline.resolve() == args.output.resolve():
        parser.error('baseline and output must be different directories')
    if args.max_diff < 0:
        parser.error('--max-diff must be nonnegative')
    dist_sha = assert_production_url(args.url)
    args.output.mkdir(parents=True, exist_ok=True)
    counts = {}
    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        try:
            for width, height in [(1440, 1000), (390, 844)]:
                for theme in ['light', 'dark']:
                    for file in capture(browser, args, width, height, theme):
                        counts[file.name] = compare(file, args.baseline) if args.baseline else None
        finally:
            browser.close()
    result = {'dist_sha256': dist_sha, 'max_diff': args.max_diff, 'changed_pixels': counts}
    print(json.dumps(result, indent=2))
    return int(any(count is not None and count > args.max_diff for count in counts.values()))


if __name__ == '__main__':
    raise SystemExit(main())
