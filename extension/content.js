// Content script: DOM scraping engine for Slack message extraction
// Injected into app.slack.com pages

(() => {
  if (window.__slackPostsExtractorLoaded) return;
  window.__slackPostsExtractorLoaded = true;

  const LOG = '[SlackPostsExporter]';
  function log(...args) { console.log(LOG, ...args); }

  // ============================================================
  // SELECTORS — verified against live Slack DOM (Feb 2026)
  // ============================================================
  const SEL = {
    // Message text inside a list item
    messageText: '[data-qa="message-text"]',
    // Sender name button
    senderName: '[data-qa="message_sender_name"]',
    // Timestamp link with data-ts attribute (epoch.microseconds)
    timestamp: 'a.c-timestamp',
    // Message container with data-msg-ts
    messageContainer: '[data-qa="message_container"]',
  };

  // Scroll config — tuned for Slack's virtual list behavior
  const SCROLL_STEP_MIN = 400;
  const SCROLL_STEP_MAX = 700;
  const SCROLL_DELAY_MIN = 1000;
  const SCROLL_DELAY_MAX = 1800;
  // Slack renders ~3-4 messages at a time, so many scrolls yield 0 new messages
  const MAX_STALE_ITERATIONS = 30;

  // ============================================================
  // UTILITIES
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sendMessage(action, data) {
    chrome.runtime.sendMessage(Object.assign({ action }, data));
  }

  // ============================================================
  // FIND THE MESSAGE SCROLL CONTAINER
  // ============================================================

  function findMessageScroller() {
    // The message area scrollbar is inside c-message_list
    // It's the c-scrollbar__hider with the largest scrollHeight
    const scrollbars = document.querySelectorAll('[data-qa="slack_kit_scrollbar"]');
    let best = null;
    let bestScroll = 0;

    for (const el of scrollbars) {
      if (el.scrollHeight > el.clientHeight + 20 && el.scrollHeight > bestScroll) {
        // Prefer the one inside the message area (wider, on the right side)
        const rect = el.getBoundingClientRect();
        if (rect.width > 400) { // Message area is wide, sidebar is narrow
          bestScroll = el.scrollHeight;
          best = el;
        }
      }
    }

    // Fallback: just pick the tallest scrollable one
    if (!best) {
      for (const el of scrollbars) {
        if (el.scrollHeight > bestScroll) {
          bestScroll = el.scrollHeight;
          best = el;
        }
      }
    }

    return best;
  }

  // ============================================================
  // FIND THE MESSAGE VIRTUAL LIST
  // ============================================================

  function findMessageVirtualList() {
    // The message virtual list has role="presentation" (not "tree" like sidebar)
    const vlists = document.querySelectorAll('.c-virtual_list__scroll_container');
    for (const vl of vlists) {
      if (vl.getAttribute('role') === 'presentation') return vl;
      // Or check if it's inside the message pane
      if (vl.closest('[data-qa="message_pane"]') || vl.closest('.c-message_list')) return vl;
    }
    return null;
  }

  // ============================================================
  // EXTRACT MESSAGES FROM CURRENT DOM
  // ============================================================

  function collectMessages(vlist, messagesMap, lastAuthorRef) {
    const children = vlist.children;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];

      // Skip non-message items: date dividers, spacers, unread markers
      const itemKey = child.getAttribute('data-item-key') || '';
      if (!itemKey || itemKey === 'bottomSpacer' || itemKey === 'unreadDivider') continue;
      // Date divider keys look like "1771297200000.<channelId>"
      if (child.classList.contains('c-virtual_list__sticky_container')) continue;

      // Must have message text to be a real message
      const textEl = child.querySelector(SEL.messageText);
      if (!textEl) continue;

      // Already collected?
      if (messagesMap.has(itemKey)) continue;

      // Extract data
      const senderEl = child.querySelector(SEL.senderName);
      if (senderEl) {
        lastAuthorRef.value = senderEl.textContent.trim();
      }

      const timeEl = child.querySelector(SEL.timestamp);
      let timestamp = '';
      let timestampLabel = '';
      if (timeEl) {
        timestamp = timeEl.getAttribute('data-ts') || '';
        const ariaLabel = timeEl.getAttribute('aria-label') || '';
        timestampLabel = ariaLabel || timeEl.textContent.trim();
      }

      const text = textEl.innerText.trim();
      if (!text) continue;

      messagesMap.set(itemKey, {
        author: lastAuthorRef.value,
        timestamp: timestampLabel,
        timestampKey: timestamp,
        text: text
      });
    }
  }

  // ============================================================
  // SCROLL AND COLLECT
  // ============================================================

  async function scrollAndCollectMessages() {
    const scroller = findMessageScroller();
    if (!scroller) {
      throw new Error('Could not find message scroll area. Are you viewing a Slack channel?');
    }

    const vlist = findMessageVirtualList();
    if (!vlist) {
      throw new Error('Could not find message list. Are you viewing a Slack channel?');
    }

    log(`Scroller: scrollH=${scroller.scrollHeight} clientH=${scroller.clientHeight} scrollTop=${scroller.scrollTop}`);
    log(`Virtual list children: ${vlist.children.length}`);

    const messagesMap = new Map();
    const lastAuthorRef = { value: '' };
    let staleCount = 0;
    let previousSize = 0;
    let iteration = 0;

    // Initial collection
    collectMessages(vlist, messagesMap, lastAuthorRef);
    log(`Initial: ${messagesMap.size} messages`);
    sendMessage('PROGRESS_UPDATE', { count: messagesMap.size });

    // Scroll UP to load older messages
    while (staleCount < MAX_STALE_ITERATIONS) {
      iteration++;
      const prevScrollTop = scroller.scrollTop;

      // Use scrollBy for more natural behavior
      const step = randomBetween(SCROLL_STEP_MIN, SCROLL_STEP_MAX);
      scroller.scrollBy({ top: -step, behavior: 'instant' });

      // Wait for Slack to render new items
      const delay = randomBetween(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX);
      await sleep(delay);

      const currentScrollTop = scroller.scrollTop;

      // Detect bounce-back (Slack auto-scrolling to bottom)
      if (currentScrollTop >= prevScrollTop && iteration <= 3) {
        log(`Iter ${iteration}: bounce detected (${prevScrollTop} -> ${currentScrollTop}), retrying...`);
        // Force scroll again
        scroller.scrollTop = Math.max(0, prevScrollTop - step);
        await sleep(1000);
      }

      collectMessages(vlist, messagesMap, lastAuthorRef);
      sendMessage('PROGRESS_UPDATE', { count: messagesMap.size });

      log(`Iter ${iteration}: scrollTop ${prevScrollTop} -> ${scroller.scrollTop}, msgs=${messagesMap.size}, stale=${staleCount}`);

      // Check if we hit the top
      if (scroller.scrollTop <= 0) {
        log('Reached scrollTop=0, doing final collection...');
        await sleep(1500);
        collectMessages(vlist, messagesMap, lastAuthorRef);
        sendMessage('PROGRESS_UPDATE', { count: messagesMap.size });

        // Check if scrollHeight grew (Slack loaded more)
        await sleep(1000);
        if (scroller.scrollTop <= 0) {
          log('Confirmed at top, stopping.');
          break;
        }
      }

      // Stale detection
      if (messagesMap.size === previousSize) {
        staleCount++;
      } else {
        staleCount = 0;
      }
      previousSize = messagesMap.size;
    }

    log(`Done after ${iteration} iterations. Total: ${messagesMap.size} messages`);

    // Sort by timestamp key (epoch) — oldest first
    const messages = Array.from(messagesMap.values());
    messages.sort((a, b) => {
      const ta = parseFloat(a.timestampKey) || 0;
      const tb = parseFloat(b.timestampKey) || 0;
      return ta - tb;
    });

    return messages;
  }

  // ============================================================
  // CHANNEL NAME
  // ============================================================

  function getChannelName() {
    const el = document.querySelector('[data-qa="channel_name"]');
    return (el && el.textContent.trim()) || 'unknown-channel';
  }

  // ============================================================
  // EXPORT
  // ============================================================

  async function runExport() {
    try {
      sendMessage('STATUS_UPDATE', { status: 'Collecting messages...' });
      const messages = await scrollAndCollectMessages();
      const channelName = getChannelName();

      sendMessage('EXPORT_COMPLETE', { messages, channelName });
    } catch (err) {
      log('Error:', err);
      sendMessage('EXPORT_ERROR', { error: err.message });
    }
  }

  // ============================================================
  // LISTENER
  // ============================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PING') {
      sendResponse({ status: 'alive' });
      return true;
    }
    if (message.action === 'START_EXPORT') {
      sendResponse({ status: 'started' });
      runExport();
      return true;
    }
  });
})();
