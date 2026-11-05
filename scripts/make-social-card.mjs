import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(process.env.TEMPO_TEST_TOOLCHAIN
  ? resolve(process.env.TEMPO_TEST_TOOLCHAIN, 'package.json') : new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const font = await readFile('public/fonts/space-grotesk-latin-variable.woff2');
const source = await readFile('scripts/social-card.svg', 'utf8');
const svg = source.replace('<defs>', `<defs><style>@font-face { font-family: 'Space Grotesk'; src: url(data:font/woff2;base64,${font.toString('base64')}); font-weight: 300 700; }</style>`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'public/social-card.png' });
  console.log('Generated public/social-card.png (1200 × 630) from scripts/social-card.svg');
} finally { await browser.close(); }
