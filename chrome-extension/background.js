// AIECOS v4.1.0 Service Worker (Background Script)
// Multi-channel sync with batch support + auto-sync timer

const SYNC_BATCH_DELAY = 300;
let syncAlarmName = 'AIECOS_AUTO_SYNC';

// ── Initialize extension ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[AIECOS] Extension v4.1.0 installed');

  chrome.storage.local.get(['agentUrl', 'agentToken', 'syncStats', 'isSyncing'], (result) => {
    if (!result.agentUrl) chrome.storage.local.set({ agentUrl: 'https://your-sync-domain.com' });
    if (!result.agentToken) chrome.storage.local.set({ agentToken: '' });
    if (!result.syncStats) chrome.storage.local.set({ syncStats: {} });
    if (result.isSyncing === undefined) chrome.storage.local.set({ isSyncing: true });
  });

  await setupAutoSyncAlarm();
});

// ── Auto-sync alarm setup ───────────────────────────────────────────────
async function setupAutoSyncAlarm() {
  try {
    chrome.storage.local.get(['agentUrl', 'agentToken'], async (result) => {
      const { agentUrl, agentToken } = result;

      if (!agentUrl || !agentToken) {
        console.log('[AIECOS] No agent URL or token, using default 5min interval');
        chrome.alarms.create(syncAlarmName, { periodInMinutes: 5 });
        return;
      }

      try {
        const statusResponse = await fetch(`${agentUrl}/api/status`, {
          method: 'GET',
          headers: { 'X-AIECOS-Token': agentToken, 'Content-Type': 'application/json' },
        });

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          const syncInterval = statusData.sync_interval_minutes || 5;
          console.log(`[AIECOS] Auto-sync interval: ${syncInterval} minutes`);
          chrome.alarms.create(syncAlarmName, { periodInMinutes: syncInterval });
        } else {
          chrome.alarms.create(syncAlarmName, { periodInMinutes: 5 });
        }
      } catch (err) {
        console.error('[AIECOS] Error fetching sync interval:', err);
        chrome.alarms.create(syncAlarmName, { periodInMinutes: 5 });
      }
    });
  } catch (err) {
    console.error('[AIECOS] setupAutoSyncAlarm error:', err);
  }
}

// ── Alarm handler ───────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === syncAlarmName) {
    console.log('[AIECOS v4.4] ⏰ Auto-walk alarm — full sync started');
    triggerAutoWalkOnPancakeTabs();
  }
});

// [PATCH v4.4] Trigger walk khi tab Pancake activate / page load
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('pancake.vn')) {
    // Delay 15s để DOM stable
    setTimeout(() => {
      chrome.storage.local.get(['isSyncing'], (r) => {
        if (r.isSyncing !== false) {
          console.log('[AIECOS v4.4] 🚀 Page loaded, trigger auto-walk in 15s');
          chrome.tabs.sendMessage(tabId, { action: 'TRIGGER_WALK' }, () => {
            if (chrome.runtime.lastError) {/* expected */}
          });
        }
      });
    }, 15000);
  }
});

function triggerScanOnPancakeTabs() {
  chrome.tabs.query({ url: '*://*.pancake.vn/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_SCAN' }, () => {
        if (chrome.runtime.lastError) {/* expected */}
      });
    });
  });
}

// [PATCH v4.4] Auto-walk all conversations (full historical sync)
function triggerAutoWalkOnPancakeTabs() {
  chrome.tabs.query({ url: '*://*.pancake.vn/*' }, (tabs) => {
    if (tabs.length === 0) {
      console.log('[AIECOS v4.4] No Pancake tab open, skip auto-walk');
      return;
    }
    tabs.forEach(tab => {
      console.log('[AIECOS v4.4] Sending TRIGGER_WALK to tab', tab.id);
      chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_WALK' }, (resp) => {
        if (chrome.runtime.lastError) {/* expected */}
        else console.log('[AIECOS v4.4] Walk started on tab', tab.id, resp);
      });
    });
  });
}

// ── Message handler ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'AIECOS_SYNC') {
    handleSyncMessage(request.payload, sendResponse);
    return true;
  }

  if (request.action === 'GET_STATS') {
    chrome.storage.local.get(['syncStats'], (result) => {
      sendResponse({ stats: result.syncStats || {} });
    });
    return true;
  }

  if (request.action === 'UPDATE_ENDPOINT') {
    chrome.storage.local.set({ agentUrl: request.url }, () => {
      setupAutoSyncAlarm();
      sendResponse({ status: 'endpoint updated' });
    });
    return true;
  }

  if (request.action === 'UPDATE_TOKEN') {
    chrome.storage.local.set({ agentToken: request.token }, () => {
      setupAutoSyncAlarm();
      sendResponse({ status: 'token updated' });
    });
    return true;
  }
});

// ── Sync handler (batch support) ────────────────────────────────────────
async function handleSyncMessage(payload, sendResponse) {
  try {
    chrome.storage.local.get(['agentUrl', 'agentToken', 'isSyncing'], async (result) => {
      const { agentUrl, agentToken, isSyncing } = result;

      if (!agentUrl || !agentToken) {
        sendResponse({ status: 'error', message: 'Missing credentials' });
        return;
      }

      if (isSyncing === false) {
        sendResponse({ status: 'skipped', message: 'Sync disabled' });
        return;
      }

      try {
        const syncResponse = await fetch(`${agentUrl}/api/sync`, {
          method: 'POST',
          headers: { 'X-AIECOS-Token': agentToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!syncResponse.ok) {
          throw new Error(`Sync failed: ${syncResponse.status}`);
        }

        const syncData = await syncResponse.json();

        // Update stats
        const messageCount = payload.messages ? payload.messages.length : 1;
        updateSyncStats(payload.page_name, messageCount);

        console.log(`[AIECOS] Synced ${messageCount} messages:`, syncData);
        sendResponse({ status: 'success', data: syncData });
      } catch (err) {
        console.error('[AIECOS] Sync error:', err);
        sendResponse({ status: 'error', message: err.message });
      }
    });
  } catch (err) {
    console.error('[AIECOS] handleSyncMessage error:', err);
    sendResponse({ status: 'error', message: 'Internal error' });
  }
}

// ── Stats tracking ──────────────────────────────────────────────────────
function updateSyncStats(pageName, count = 1) {
  try {
    chrome.storage.local.get(['syncStats'], (result) => {
      const stats = result.syncStats || {};
      const today = new Date().toISOString().split('T')[0];

      if (!stats[pageName]) stats[pageName] = {};
      if (!stats[pageName][today]) stats[pageName][today] = 0;
      stats[pageName][today] += count;

      chrome.storage.local.set({ syncStats: stats });
    });
  } catch (err) {
    console.error('[AIECOS] updateSyncStats error:', err);
  }
}

console.log('[AIECOS] Background service worker v4.1.0 loaded');
