/**
 * Background Service Worker (Manifest V3)
 * Handles extension lifecycle and persistent state
 */

/**
 * Injects content scripts into a Looker Studio tab programmatically.
 * This is needed when the extension is installed/updated while Looker Studio
 * tabs are already open — declarative content_scripts in manifest.json only
 * inject on NEW page loads, not into already-open tabs.
 */
async function injectContentScripts(tabId) {
  try {
    // Check if content script is already running
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null);
    if (response && response.status === 'pong') {
      console.log(`Content script already active in tab ${tabId}`);
      return;
    }
  } catch (e) {
    // Content script not running, proceed with injection
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['svgParser.js', 'iqrAnalysis.js', 'chartInteraction.js', 'content.js']
    });
    console.log(`Content scripts injected into tab ${tabId}`);
  } catch (error) {
    console.error(`Failed to inject into tab ${tabId}:`, error);
  }
}

function isLookerStudioUrl(url) {
  return url && (
    url.includes('lookerstudio.google.com') ||
    url.includes('looker.google.com') ||
    url.includes('datastudio.google.com')
  );
}

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`Extension ${details.reason}`);

  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'popup.html' });
  }

  // On install or update, inject into any already-open Looker Studio tabs
  if (details.reason === 'install' || details.reason === 'update') {
    try {
      const tabs = await chrome.tabs.query({ url: ['https://lookerstudio.google.com/*', 'https://datastudio.google.com/*'] });
      for (const tab of tabs) {
        injectContentScripts(tab.id);
      }
    } catch (error) {
      console.error('Error injecting into existing tabs:', error);
    }
  }
});

// Listen for tab updates - detect SPA navigations in Looker Studio
// Looker Studio uses client-side routing, so the content script only loads once.
// We detect URL changes and tell the content script to re-scan.
const tabUrls = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    if (!tab || !tab.url) return;

    const url = tab.url;
    const isLookerStudio = url.includes('lookerstudio.google.com') ||
                           url.includes('looker.google.com') ||
                           url.includes('datastudio.google.com');

    if (!isLookerStudio) return;

    // Detect SPA navigation: URL changed but it's not a full page load
    // (changeInfo.status === 'loading' without a full reload means SPA nav)
    const previousUrl = tabUrls.get(tabId);
    tabUrls.set(tabId, url);

    if (previousUrl && previousUrl !== url) {
      // URL changed within Looker Studio - this is an SPA navigation
      console.log(`SPA navigation detected: ${previousUrl} -> ${url}`);
      chrome.tabs.sendMessage(tabId, { type: 'SPA_NAVIGATION', url }).catch(() => {
        // Content script may not be ready yet, that's fine
      });
    } else if (changeInfo.status === 'complete' && !previousUrl) {
      // First load of a Looker Studio page - content script handles this via auto-scan
      console.log(`Looker Studio page loaded: ${url}`);
    }
  } catch (error) {
    // Silently catch any errors - some tabs don't have URL access
  }
});

// Clean up tracked URLs when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrls.delete(tabId);
});

// Respond to messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'DEVIATION_SCAN_COMPLETE') {
    // Store results for later retrieval
    chrome.storage.local.set({
      lastScanResults: request,
      lastScanTime: new Date().toISOString()
    });
  }
});
