// Popup logic: URL detection, export trigger, CSV download

let currentTabId = null;
let csvData = null;
let exportedMessages = [];

const elements = {
  slackUrl: document.getElementById('slack-url'),
  detectBtn: document.getElementById('detect-btn'),
  exportBtn: document.getElementById('export-btn'),
  downloadBtn: document.getElementById('download-btn'),
  progressSection: document.getElementById('progress-section'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  statusBar: document.getElementById('status-bar'),
  statusText: document.getElementById('status-text'),
  errorMsg: document.getElementById('error-msg')
};

// Auto-detect Slack URL on popup open
document.addEventListener('DOMContentLoaded', detectSlackTab);

elements.detectBtn.addEventListener('click', detectSlackTab);
elements.exportBtn.addEventListener('click', startExport);
elements.downloadBtn.addEventListener('click', downloadCSV);

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'PROGRESS_UPDATE') {
    updateProgress(message.count);
  } else if (message.action === 'EXPORT_COMPLETE') {
    onExportComplete(message.messages, message.channelName);
  } else if (message.action === 'EXPORT_ERROR') {
    showError(message.error);
    elements.exportBtn.disabled = false;
    elements.exportBtn.textContent = 'Export Posts';
  }
});

async function detectSlackTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.startsWith('https://app.slack.com/')) {
      currentTabId = tab.id;
      elements.slackUrl.value = tab.url;
      elements.exportBtn.disabled = false;
      showStatus('Slack workspace detected', 'info');

      pingContentScript(tab.id);
    } else {
      elements.slackUrl.value = '';
      elements.exportBtn.disabled = true;
      showStatus('Navigate to app.slack.com first', 'error');
    }
  } catch (err) {
    showError('Could not detect current tab: ' + err.message);
  }
}

async function pingContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'PING' });
  } catch {
    try {
      await chrome.runtime.sendMessage({
        action: 'INJECT_CONTENT_SCRIPT',
        tabId: tabId
      });
    } catch (err) {
      console.log('Could not inject content script:', err.message);
    }
  }
}

async function startExport() {
  if (!currentTabId) {
    showError('No Slack tab detected');
    return;
  }

  // Reset state
  csvData = null;
  exportedMessages = [];
  elements.downloadBtn.classList.add('hidden');
  elements.errorMsg.classList.add('hidden');
  elements.exportBtn.disabled = true;
  elements.exportBtn.textContent = 'Exporting...';
  elements.progressSection.classList.remove('hidden');
  updateProgress(0);
  showStatus('Starting export...', 'info');

  try {
    await chrome.tabs.sendMessage(currentTabId, { action: 'START_EXPORT' });
  } catch {
    try {
      await chrome.runtime.sendMessage({
        action: 'INJECT_CONTENT_SCRIPT',
        tabId: currentTabId
      });
      await new Promise((r) => setTimeout(r, 500));
      await chrome.tabs.sendMessage(currentTabId, { action: 'START_EXPORT' });
    } catch (err) {
      showError('Could not connect to Slack page. Try refreshing the page.');
      elements.exportBtn.disabled = false;
      elements.exportBtn.textContent = 'Export Posts';
    }
  }
}

function updateProgress(count) {
  elements.progressText.textContent = count + ' messages found';
  elements.progressBar.style.width = '100%';
  elements.progressBar.style.opacity = '0.6';
  elements.progressBar.style.animation = 'pulse 1.5s ease-in-out infinite';
}

function onExportComplete(messages, channelName) {
  exportedMessages = messages;
  elements.exportBtn.disabled = false;
  elements.exportBtn.textContent = 'Export Posts';

  if (messages.length === 0) {
    showError('No messages found. Make sure you are viewing a Slack channel with messages.');
    return;
  }

  csvData = convertToCSV(messages);
  elements.progressBar.style.animation = 'none';
  elements.progressBar.style.opacity = '1';
  elements.progressBar.style.width = '100%';
  elements.progressText.textContent = messages.length + ' messages exported';
  elements.downloadBtn.classList.remove('hidden');
  showStatus('Export complete! ' + messages.length + ' messages found.', 'success');

  // Store channel name for filename
  elements.downloadBtn.dataset.channelName = channelName || 'channel';
}

function convertToCSV(messages) {
  const BOM = '\uFEFF';
  const headers = ['Author', 'Date', 'Message'];
  const rows = messages.map((m) => {
    return [
      escapeCSV(m.author || ''),
      escapeCSV(m.timestampISO || m.timestamp || ''),
      escapeCSV(m.text || '')
    ].join(',');
  });

  return BOM + headers.join(',') + '\n' + rows.join('\n');
}

function escapeCSV(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function downloadCSV() {
  if (!csvData) return;

  const channelName = elements.downloadBtn.dataset.channelName || 'channel';
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = 'slack_posts_' + channelName + '_' + timestamp + '.csv';

  chrome.runtime.sendMessage({
    action: 'DOWNLOAD_CSV',
    csv: csvData,
    filename: filename
  });
}

function showStatus(text, type) {
  elements.statusBar.classList.remove('hidden', 'error', 'info');
  elements.statusBar.classList.add(type === 'error' ? 'error' : type === 'info' ? 'info' : '');
  elements.statusText.textContent = text;
}

function showError(text) {
  elements.errorMsg.textContent = text;
  elements.errorMsg.classList.remove('hidden');
  showStatus(text, 'error');
}
