// AIECOS v4.0.0 Popup Script

/**
 * Load and display stats from background service worker
 */
function loadStats() {
  chrome.runtime.sendMessage({ action: 'GET_STATS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[AIECOS] Stats error:', chrome.runtime.lastError);
      return;
    }

    const stats = response.stats || {};
    const today = new Date().toISOString().split('T')[0];

    // Render page stats
    const pageStatsContainer = document.getElementById('pageStats');
    pageStatsContainer.innerHTML = '';

    let totalMessages = 0;
    const pageList = [];

    for (const pageName in stats) {
      const pageData = stats[pageName];
      const count = pageData[today] || 0;
      totalMessages += count;

      pageList.push({ name: pageName, count: count });
    }

    // Sort by count descending
    pageList.sort((a, b) => b.count - a.count);

    if (pageList.length === 0) {
      pageStatsContainer.innerHTML = '<div style="color: #666; font-size: 12px; padding: 20px; text-align: center;">No messages synced today</div>';
    } else {
      pageList.forEach(page => {
        const item = document.createElement('div');
        item.className = 'page-stat-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'page-stat-name';
        nameSpan.textContent = page.name;
        const countSpan = document.createElement('span');
        countSpan.className = 'page-stat-count';
        countSpan.textContent = page.count;
        item.appendChild(nameSpan);
        item.appendChild(countSpan);
        pageStatsContainer.appendChild(item);
      });
    }

    // Update total
    document.getElementById('totalMessages').textContent = totalMessages;
  });
}

/**
 * Load saved configuration
 */
function loadConfig() {
  chrome.storage.local.get(['agentUrl', 'agentToken', 'isSyncing'], (result) => {
    const { agentUrl = 'https://your-sync-domain.com', agentToken = '', isSyncing = true } = result;

    document.getElementById('agentUrl').value = agentUrl;
    document.getElementById('agentToken').value = agentToken;

    // Update UI based on sync state
    updateSyncUI(isSyncing);

    // Fetch sync interval from server
    checkServerStatus(agentUrl, agentToken);
  });
}

/**
 * Check server status and get sync interval
 */
function checkServerStatus(agentUrl, agentToken) {
  if (!agentUrl || !agentToken) {
    document.getElementById('syncInterval').textContent = '— (configure first)';
    return;
  }

  fetch(`${agentUrl}/api/status`, {
    method: 'GET',
    headers: {
      'X-AIECOS-Token': agentToken,
      'Content-Type': 'application/json'
    }
  })
    .then(res => {
      if (!res.ok) throw new Error(`Status: ${res.status}`);
      return res.json();
    })
    .then(data => {
      const interval = data.sync_interval_minutes || 5;
      document.getElementById('syncInterval').textContent = `${interval} minutes`;
    })
    .catch(err => {
      console.error('[AIECOS] Server status error:', err);
      document.getElementById('syncInterval').textContent = '— (offline)';
    });
}

/**
 * Update sync UI based on state
 */
function updateSyncUI(isSyncing) {
  const indicator = document.getElementById('statusIndicator');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  if (isSyncing) {
    indicator.classList.add('active');
    startBtn.disabled = true;
    startBtn.style.opacity = '0.5';
    stopBtn.disabled = false;
    stopBtn.style.opacity = '1';
  } else {
    indicator.classList.remove('active');
    startBtn.disabled = false;
    startBtn.style.opacity = '1';
    stopBtn.disabled = true;
    stopBtn.style.opacity = '0.5';
  }
}

/**
 * Handle start sync
 */
function handleStartSync() {
  chrome.storage.local.set({ isSyncing: true }, () => {
    updateSyncUI(true);
    showMessage('Sync started', 'success');

    // Trigger immediate scan on active tabs
    chrome.tabs.query({ url: '*://*.pancake.vn/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_SCAN' }, () => {
          if (chrome.runtime.lastError) {
            console.log('[AIECOS] Tab message (expected for some tabs):', chrome.runtime.lastError);
          }
        });
      });
    });
  });
}

/**
 * Handle stop sync
 */
function handleStopSync() {
  chrome.storage.local.set({ isSyncing: false }, () => {
    updateSyncUI(false);
    showMessage('Sync stopped', 'success');
  });
}

/**
 * Handle walk conversations
 * Uses tabs.sendMessage so the TRIGGER_WALK action runs inside the content script's
 * own execution context (where autoWalkConversations is defined).
 */
function handleWalkConversations() {
  chrome.tabs.query({ url: '*://*.pancake.vn/*' }, (tabs) => {
    if (tabs.length === 0) {
      showMessage('Không tìm thấy tab Pancake. Mở Pancake trước.', 'error');
      return;
    }

    const activeTab = tabs[0];

    chrome.tabs.sendMessage(activeTab.id, { action: 'TRIGGER_WALK' }, (response) => {
      if (chrome.runtime.lastError) {
        showMessage('Lỗi: ' + chrome.runtime.lastError.message, 'error');
        console.error('[AIECOS] Walk message error:', chrome.runtime.lastError);
      } else {
        showMessage('Đang auto-walk tất cả hội thoại...', 'success');
      }
    });
  });
}

/**
 * Handle save URL
 */
function handleSaveUrl() {
  const url = document.getElementById('agentUrl').value.trim();

  if (!url) {
    showMessage('Please enter a URL', 'error');
    return;
  }

  chrome.runtime.sendMessage({ action: 'UPDATE_ENDPOINT', url: url }, (response) => {
    if (chrome.runtime.lastError) {
      showMessage('Error saving URL', 'error');
      return;
    }

    showMessage('Server URL saved', 'success');

    // Refresh sync interval
    const token = document.getElementById('agentToken').value;
    checkServerStatus(url, token);
  });
}

/**
 * Handle save token
 */
function handleSaveToken() {
  const token = document.getElementById('agentToken').value.trim();

  if (!token) {
    showMessage('Please enter a token', 'error');
    return;
  }

  chrome.runtime.sendMessage({ action: 'UPDATE_TOKEN', token: token }, (response) => {
    if (chrome.runtime.lastError) {
      showMessage('Error saving token', 'error');
      return;
    }

    showMessage('API token saved', 'success');

    // Refresh sync interval
    const url = document.getElementById('agentUrl').value;
    checkServerStatus(url, token);
  });
}

/**
 * Show message in popup
 */
function showMessage(text, type = 'info') {
  const container = document.getElementById('messageContainer');

  const msg = document.createElement('div');
  msg.className = type === 'success' ? 'success-message' : type === 'error' ? 'error-message' : 'info-message';
  msg.textContent = text;

  container.innerHTML = '';
  container.appendChild(msg);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    msg.remove();
  }, 4000);
}

/**
 * Initialize popup on load
 */
document.addEventListener('DOMContentLoaded', () => {
  // Wire up all buttons via addEventListener (required for MV3 CSP)
  document.getElementById('startBtn').addEventListener('click', handleStartSync);
  document.getElementById('stopBtn').addEventListener('click', handleStopSync);
  document.getElementById('walkBtn').addEventListener('click', handleWalkConversations);
  document.getElementById('saveUrlBtn').addEventListener('click', handleSaveUrl);
  document.getElementById('saveTokenBtn').addEventListener('click', handleSaveToken);

  // Also allow Enter key in inputs
  document.getElementById('agentUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSaveUrl(); });
  document.getElementById('agentToken').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSaveToken(); });

  loadConfig();
  loadStats();

  // Refresh stats every 3 seconds
  setInterval(loadStats, 3000);
});
