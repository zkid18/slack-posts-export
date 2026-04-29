// Service worker: message relay + CSV download handler

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DOWNLOAD_CSV') {
    downloadCSV(message.csv, message.filename);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'INJECT_CONTENT_SCRIPT') {
    injectContentScript(message.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function downloadCSV(csvContent, filename) {
  const base64 = btoa(unescape(encodeURIComponent(csvContent)));
  const dataUri = 'data:text/csv;charset=utf-8;base64,' + base64;

  chrome.downloads.download({
    url: dataUri,
    filename: filename || 'slack_posts.csv',
    saveAs: true
  });
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js']
  });
}
