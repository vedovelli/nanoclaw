#!/usr/bin/env node
/**
 * crawlee-fetch — Fetches a URL using Crawlee + Playwright with stealth plugin.
 *
 * Usage:  node /app/crawlee-fetch.mjs <url> [--selector <css>] [--timeout <ms>]
 *
 * Outputs the extracted text content to stdout. If --selector is given, extracts
 * only the text inside matching elements; otherwise returns full page text.
 *
 * Exit codes:
 *   0 — success (content on stdout)
 *   1 — fetch failed or no content extracted
 */

import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--'));
if (!url) {
  console.error('Usage: crawlee-fetch <url> [--selector <css>] [--timeout <ms>]');
  process.exit(1);
}

const selectorIdx = args.indexOf('--selector');
const selector = selectorIdx !== -1 ? args[selectorIdx + 1] : null;

const timeoutIdx = args.indexOf('--timeout');
const timeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : 30000;

let result = '';

const crawler = new PlaywrightCrawler({
  launchContext: {
    launcher: chromium,
    launchOptions: {
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  maxRequestsPerCrawl: 1,
  navigationTimeoutSecs: Math.ceil(timeout / 1000),
  requestHandlerTimeoutSecs: Math.ceil(timeout / 1000) + 10,
  // Suppress Crawlee storage to /tmp to avoid polluting workspace
  storageDir: '/tmp/crawlee-storage',

  async requestHandler({ page, log }) {
    log.info(`Fetching ${url}`);
    await page.waitForLoadState('domcontentloaded');

    if (selector) {
      const elements = await page.$$(selector);
      const texts = [];
      for (const el of elements) {
        const text = await el.innerText();
        if (text.trim()) texts.push(text.trim());
      }
      result = texts.join('\n\n');
    } else {
      result = await page.evaluate(() => document.body.innerText);
    }
  },

  failedRequestHandler({ request, log }) {
    log.error(`Failed to fetch ${request.url}`);
  },
});

try {
  await crawler.run([url]);
  if (result.trim()) {
    console.log(result);
  } else {
    console.error('No content extracted');
    process.exit(1);
  }
} catch (err) {
  console.error(`Crawlee error: ${err.message}`);
  process.exit(1);
}
