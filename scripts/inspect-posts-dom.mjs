/**
 * Playwright DOM inspection for Slack message selectors.
 *
 * Usage:
 *   node inspect-posts-dom.mjs
 *
 * First run: log in to Slack in the browser that opens, navigate to a channel,
 * then press Enter. Profile is saved so subsequent runs skip login.
 */

import { chromium } from 'playwright';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';

const USER_DATA_DIR = './playwright-profile';
const SLACK_URL = process.env.SLACK_URL;
const OUTPUT_FILE = './dom-inspection-results.txt';

if (!SLACK_URL) {
  console.error('SLACK_URL is required. Run with: node --env-file=.env <script>');
  process.exit(1);
}

function waitForEnter(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

function out(lines, text) {
  console.log(text);
  lines.push(text);
}

async function main() {
  const lines = [];

  console.log('Launching Chromium with persistent profile...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(SLACK_URL, { waitUntil: 'domcontentloaded' });

  // Auto-wait: give Slack time to fully render (no manual Enter needed)
  console.log('Waiting 15s for Slack to fully render...');
  await new Promise(r => setTimeout(r, 15000));
  console.log('Starting inspection...');

  // ── 1. Broad selector scan ──────────────────────────────────
  out(lines, '\n========== SELECTOR SCAN ==========\n');

  const selectors = {
    '[data-qa="slack_kit_scrollbar"]': 'slack_kit_scrollbar',
    '.c-scrollbar__hider': 'c-scrollbar__hider',
    '.c-virtual_list__scroll_container': 'virtual_list__scroll_container',
    '[data-qa="virtual-list-item"]': 'virtual-list-item',
    '.c-virtual_list__item': 'c-virtual_list__item',
    '[data-qa="message-text"]': 'message-text',
    '.p-rich_text_section': 'p-rich_text_section',
    '.c-message_kit__text': 'c-message_kit__text',
    '[data-qa="message_sender_name"]': 'message_sender_name',
    '.c-message_kit__sender': 'c-message_kit__sender',
    '[data-qa="message_time"]': 'message_time',
    'a.c-timestamp': 'a.c-timestamp',
    '.c-timestamp': 'c-timestamp',
    '[data-qa="channel_beginning"]': 'channel_beginning',
    '[data-qa="channel_name"]': 'channel_name',
    '.p-workspace__primary_view_body': 'p-workspace__primary_view_body',
    '[data-qa="message_pane"]': 'message_pane',
    '[data-qa="message_container"]': 'message_container',
    '[data-qa="message_list"]': 'message_list',
    '.c-message_kit': 'c-message_kit',
    '.c-message_kit__background': 'c-message_kit__background',
    '.c-message_kit__message': 'c-message_kit__message',
  };

  for (const [sel, label] of Object.entries(selectors)) {
    const count = await page.locator(sel).count();
    out(lines, `${label}: ${count}`);
  }

  // ── 2. Scrollbar details ────────────────────────────────────
  out(lines, '\n========== SCROLLBAR DETAILS ==========\n');

  const scrollbarInfo = await page.evaluate(() => {
    const results = [];
    const els = document.querySelectorAll('[data-qa="slack_kit_scrollbar"], .c-scrollbar__hider');
    els.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      results.push({
        index: i,
        tag: el.tagName,
        className: el.className.slice(0, 120),
        dataQa: el.getAttribute('data-qa') || '',
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: el.scrollTop,
        rectTop: Math.round(rect.top),
        rectLeft: Math.round(rect.left),
        rectWidth: Math.round(rect.width),
        rectHeight: Math.round(rect.height),
        parentClass: el.parentElement ? el.parentElement.className.slice(0, 80) : '',
        childCount: el.children.length
      });
    });
    return results;
  });

  for (const s of scrollbarInfo) {
    out(lines, JSON.stringify(s, null, 2));
  }

  // ── 3. Virtual list details ─────────────────────────────────
  out(lines, '\n========== VIRTUAL LIST DETAILS ==========\n');

  const vlistInfo = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.c-virtual_list__scroll_container').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      results.push({
        index: i,
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label') || '',
        childCount: el.children.length,
        className: el.className.slice(0, 120),
        rectTop: Math.round(rect.top),
        rectLeft: Math.round(rect.left),
        rectWidth: Math.round(rect.width),
        rectHeight: Math.round(rect.height),
        parentClass: el.parentElement ? el.parentElement.className.slice(0, 80) : '',
        parentDataQa: el.parentElement ? (el.parentElement.getAttribute('data-qa') || '') : ''
      });
    });
    return results;
  });

  for (const v of vlistInfo) {
    out(lines, JSON.stringify(v, null, 2));
  }

  // ── 4. Sample message items (first 5) ──────────────────────
  out(lines, '\n========== SAMPLE MESSAGE ITEMS (first 5) ==========\n');

  const sampleItems = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-qa="virtual-list-item"], .c-virtual_list__item');
    const results = [];
    for (let i = 0; i < Math.min(5, items.length); i++) {
      const el = items[i];
      results.push({
        index: i,
        tagName: el.tagName,
        className: el.className.slice(0, 150),
        dataQa: el.getAttribute('data-qa') || '',
        id: el.id || '',
        allDataAttrs: Object.fromEntries(
          Array.from(el.attributes)
            .filter(a => a.name.startsWith('data-'))
            .map(a => [a.name, a.value.slice(0, 80)])
        ),
        hasMessageText: !!el.querySelector('[data-qa="message-text"]'),
        hasRichTextSection: !!el.querySelector('.p-rich_text_section'),
        hasMsgKitText: !!el.querySelector('.c-message_kit__text'),
        hasSenderName: !!el.querySelector('[data-qa="message_sender_name"]'),
        hasMsgKitSender: !!el.querySelector('.c-message_kit__sender'),
        hasTimestamp: !!el.querySelector('[data-qa="message_time"]'),
        hasCTimestamp: !!el.querySelector('.c-timestamp'),
        innerText: el.innerText.trim().slice(0, 200),
        outerHTMLLength: el.outerHTML.length
      });
    }
    return results;
  });

  for (const item of sampleItems) {
    out(lines, JSON.stringify(item, null, 2));
  }

  // ── 5. Raw HTML of first 3 message items ───────────────────
  out(lines, '\n========== RAW HTML (first 3 items, truncated to 2000 chars each) ==========\n');

  const rawItems = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-qa="virtual-list-item"], .c-virtual_list__item');
    const results = [];
    for (let i = 0; i < Math.min(3, items.length); i++) {
      results.push(items[i].outerHTML.slice(0, 2000));
    }
    return results;
  });

  rawItems.forEach((html, i) => {
    out(lines, `--- Item [${i}] ---`);
    out(lines, html);
    out(lines, '');
  });

  // ── 6. Full page data-qa inventory ─────────────────────────
  out(lines, '\n========== ALL UNIQUE data-qa VALUES ON PAGE ==========\n');

  const allDataQa = await page.evaluate(() => {
    const vals = new Set();
    document.querySelectorAll('[data-qa]').forEach(el => {
      vals.add(el.getAttribute('data-qa'));
    });
    return Array.from(vals).sort();
  });

  out(lines, allDataQa.join('\n'));

  // ── Save to file ───────────────────────────────────────────
  writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');
  out(lines, `\n\nResults saved to ${OUTPUT_FILE}`);

  await context.close();
}

main().catch(console.error);
