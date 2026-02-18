/**
 * Targeted inspection of the message area virtual list children.
 * Auto-runs after 15s wait, no Enter needed.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const USER_DATA_DIR = './playwright-profile';
const SLACK_URL = process.env.SLACK_URL;
const OUTPUT_FILE = './message-detail-results.txt';

if (!SLACK_URL) {
  console.error('SLACK_URL is required. Run with: node --env-file=.env <script>');
  process.exit(1);
}

function out(lines, text) {
  console.log(text);
  lines.push(text);
}

async function main() {
  const lines = [];

  console.log('Launching Chromium...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 }
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(SLACK_URL, { waitUntil: 'domcontentloaded' });

  console.log('Waiting 15s for Slack to render...');
  await new Promise(r => setTimeout(r, 15000));

  // ── 1. Dump ALL children of the message virtual list ───────
  out(lines, '\n========== MESSAGE VIRTUAL LIST CHILDREN ==========\n');

  const msgListChildren = await page.evaluate(() => {
    // Find the message area virtual list (second one, role="presentation")
    const vlists = document.querySelectorAll('.c-virtual_list__scroll_container');
    const msgList = Array.from(vlists).find(el =>
      el.getAttribute('role') === 'presentation' ||
      el.closest('[data-qa="message_pane"]') ||
      el.closest('.c-message_list')
    );

    if (!msgList) return { error: 'Could not find message virtual list' };

    const result = {
      listInfo: {
        role: msgList.getAttribute('role'),
        className: msgList.className,
        childCount: msgList.children.length,
        parentClass: msgList.parentElement?.className?.slice(0, 100) || ''
      },
      children: []
    };

    for (let i = 0; i < msgList.children.length; i++) {
      const child = msgList.children[i];
      result.children.push({
        index: i,
        tagName: child.tagName,
        className: child.className.slice(0, 200),
        id: child.id || '',
        allAttributes: Object.fromEntries(
          Array.from(child.attributes).map(a => [a.name, a.value.slice(0, 100)])
        ),
        innerText: child.innerText.trim().slice(0, 300),
        outerHTMLLength: child.outerHTML.length,
        childElementCount: child.children.length,
        // Check various potential selectors
        hasDataQaVirtualListItem: child.getAttribute('data-qa') === 'virtual-list-item',
        hasClassVirtualListItem: child.classList.contains('c-virtual_list__item'),
        hasMessageText: !!child.querySelector('[data-qa="message-text"]'),
        hasRichText: !!child.querySelector('.p-rich_text_section'),
        hasSenderName: !!child.querySelector('[data-qa="message_sender_name"]'),
        hasTimestamp: !!child.querySelector('.c-timestamp'),
        hasMessageContainer: !!child.querySelector('[data-qa="message_container"]'),
        hasMessageContent: !!child.querySelector('[data-qa="message_content"]'),
        hasMsgKitBg: !!child.querySelector('.c-message_kit__background'),
        hasDayDivider: !!child.querySelector('[data-qa="day-divider-label"]'),
      });
    }

    return result;
  });

  out(lines, JSON.stringify(msgListChildren, null, 2));

  // ── 2. Raw HTML of each message list child ─────────────────
  out(lines, '\n========== RAW HTML OF EACH MESSAGE LIST CHILD ==========\n');

  const msgChildrenHTML = await page.evaluate(() => {
    const vlists = document.querySelectorAll('.c-virtual_list__scroll_container');
    const msgList = Array.from(vlists).find(el =>
      el.getAttribute('role') === 'presentation' ||
      el.closest('[data-qa="message_pane"]') ||
      el.closest('.c-message_list')
    );
    if (!msgList) return [];

    const results = [];
    for (let i = 0; i < msgList.children.length; i++) {
      results.push(msgList.children[i].outerHTML.slice(0, 3000));
    }
    return results;
  });

  msgChildrenHTML.forEach((html, i) => {
    out(lines, `\n--- Child [${i}] ---`);
    out(lines, html);
  });

  // ── 3. Test scrolling: scroll up and see what changes ──────
  out(lines, '\n========== SCROLL TEST ==========\n');

  const scrollTest = await page.evaluate(async () => {
    const scrollbars = document.querySelectorAll('[data-qa="slack_kit_scrollbar"]');
    // Pick the messages scrollbar (index 1, the wider one)
    const msgScroller = scrollbars[1];
    if (!msgScroller) return { error: 'No message scrollbar found' };

    const vlists = document.querySelectorAll('.c-virtual_list__scroll_container');
    const msgList = Array.from(vlists).find(el =>
      el.getAttribute('role') === 'presentation' ||
      el.closest('.c-message_list')
    );

    const results = [];

    // Record initial state
    results.push({
      step: 'initial',
      scrollTop: msgScroller.scrollTop,
      scrollHeight: msgScroller.scrollHeight,
      childCount: msgList ? msgList.children.length : -1,
      messageTextCount: document.querySelectorAll('[data-qa="message-text"]').length
    });

    // Scroll up 3 times
    for (let i = 0; i < 3; i++) {
      msgScroller.scrollTop -= 500;
      await new Promise(r => setTimeout(r, 1500));

      results.push({
        step: `scroll_up_${i + 1}`,
        scrollTop: msgScroller.scrollTop,
        scrollHeight: msgScroller.scrollHeight,
        childCount: msgList ? msgList.children.length : -1,
        messageTextCount: document.querySelectorAll('[data-qa="message-text"]').length
      });
    }

    return results;
  });

  out(lines, JSON.stringify(scrollTest, null, 2));

  // ── 4. After scroll: dump updated children ─────────────────
  out(lines, '\n========== MESSAGE LIST CHILDREN AFTER SCROLL ==========\n');

  const afterScrollChildren = await page.evaluate(() => {
    const vlists = document.querySelectorAll('.c-virtual_list__scroll_container');
    const msgList = Array.from(vlists).find(el =>
      el.getAttribute('role') === 'presentation' ||
      el.closest('.c-message_list')
    );
    if (!msgList) return [];

    const results = [];
    for (let i = 0; i < msgList.children.length; i++) {
      const child = msgList.children[i];
      results.push({
        index: i,
        className: child.className.slice(0, 150),
        innerText: child.innerText.trim().slice(0, 200),
        hasMessageText: !!child.querySelector('[data-qa="message-text"]'),
        hasSenderName: !!child.querySelector('[data-qa="message_sender_name"]'),
        hasTimestamp: !!child.querySelector('.c-timestamp'),
      });
    }
    return results;
  });

  out(lines, JSON.stringify(afterScrollChildren, null, 2));

  // ── Save ───────────────────────────────────────────────────
  writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');
  console.log(`\nResults saved to ${OUTPUT_FILE}`);

  await context.close();
}

main().catch(console.error);
