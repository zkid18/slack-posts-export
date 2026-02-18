/**
 * Test the scroll-and-collect logic via Playwright.
 * Simulates what content.js does, but we can see the results directly.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const USER_DATA_DIR = './playwright-profile';
const SLACK_URL = process.env.SLACK_URL;

if (!SLACK_URL) {
  console.error('SLACK_URL is required. Run with: node --env-file=.env test-scroll.mjs');
  process.exit(1);
}

async function main() {
  console.log('Launching...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(SLACK_URL, { waitUntil: 'domcontentloaded' });
  console.log('Waiting 15s for render...');
  await new Promise(r => setTimeout(r, 15000));

  // Run the full scroll-and-collect inside the page
  const result = await page.evaluate(async () => {
    // Find scroller (widest slack_kit_scrollbar)
    const scrollbars = document.querySelectorAll('[data-qa="slack_kit_scrollbar"]');
    let scroller = null;
    let bestWidth = 0;
    for (const el of scrollbars) {
      const rect = el.getBoundingClientRect();
      if (rect.width > bestWidth && el.scrollHeight > el.clientHeight + 20) {
        bestWidth = rect.width;
        scroller = el;
      }
    }
    if (!scroller) return { error: 'No scroller found' };

    // Find virtual list (role=presentation)
    const vlists = document.querySelectorAll('.c-virtual_list__scroll_container');
    let vlist = null;
    for (const vl of vlists) {
      if (vl.getAttribute('role') === 'presentation' || vl.closest('.c-message_list')) {
        vlist = vl;
        break;
      }
    }
    if (!vlist) return { error: 'No virtual list found' };

    const messagesMap = new Map();
    let lastAuthor = '';
    const logs = [];

    function collect() {
      for (const child of vlist.children) {
        const key = child.getAttribute('data-item-key') || '';
        if (!key || key === 'bottomSpacer' || key === 'unreadDivider') continue;
        if (child.classList.contains('c-virtual_list__sticky_container')) continue;

        const textEl = child.querySelector('[data-qa="message-text"]');
        if (!textEl) continue;
        if (messagesMap.has(key)) continue;

        const senderEl = child.querySelector('[data-qa="message_sender_name"]');
        if (senderEl) lastAuthor = senderEl.textContent.trim();

        const timeEl = child.querySelector('a.c-timestamp');
        const ts = timeEl ? (timeEl.getAttribute('aria-label') || timeEl.textContent.trim()) : '';

        const text = textEl.innerText.trim();
        if (!text) continue;

        messagesMap.set(key, { author: lastAuthor, timestamp: ts, text: text.slice(0, 100) });
      }
    }

    collect();
    logs.push(`initial: ${messagesMap.size} msgs, scrollTop=${scroller.scrollTop}`);

    let stale = 0;
    let prevSize = messagesMap.size;

    for (let i = 0; i < 200 && stale < 30; i++) {
      const prevTop = scroller.scrollTop;
      const step = 400 + Math.floor(Math.random() * 300);
      scroller.scrollBy({ top: -step, behavior: 'instant' });
      await new Promise(r => setTimeout(r, 1200));

      // Handle bounce
      if (scroller.scrollTop >= prevTop && i < 3) {
        scroller.scrollTop = Math.max(0, prevTop - step);
        await new Promise(r => setTimeout(r, 1000));
      }

      collect();

      if (i % 10 === 0) {
        logs.push(`iter ${i}: ${messagesMap.size} msgs, scrollTop=${scroller.scrollTop}, stale=${stale}`);
      }

      if (scroller.scrollTop <= 0) {
        await new Promise(r => setTimeout(r, 1500));
        collect();
        if (scroller.scrollTop <= 0) {
          logs.push(`HIT TOP at iter ${i}: ${messagesMap.size} msgs`);
          break;
        }
      }

      if (messagesMap.size === prevSize) {
        stale++;
      } else {
        stale = 0;
      }
      prevSize = messagesMap.size;
    }

    const messages = Array.from(messagesMap.values());
    logs.push(`FINAL: ${messages.length} messages collected`);

    return { logs, messageCount: messages.length, messages };
  });

  console.log('\n=== RESULTS ===\n');
  if (result.logs) {
    result.logs.forEach(l => console.log(l));
  }
  console.log(`\nTotal messages: ${result.messageCount}`);

  if (result.messages && result.messages.length > 0) {
    console.log('\nFirst 5 messages:');
    result.messages.slice(0, 5).forEach((m, i) => {
      console.log(`  [${i}] ${m.author} | ${m.timestamp} | ${m.text}`);
    });
    console.log('\nLast 5 messages:');
    result.messages.slice(-5).forEach((m, i) => {
      console.log(`  [${result.messageCount - 5 + i}] ${m.author} | ${m.timestamp} | ${m.text}`);
    });
  }

  // Save full results
  writeFileSync('./scroll-test-results.json', JSON.stringify(result, null, 2));
  console.log('\nFull results saved to scroll-test-results.json');

  await context.close();
}

main().catch(console.error);
