/**
 * Background Service Worker (Manifest V3)
 * Handles extension lifecycle and persistent state
 */

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Extension installed');
    // Could open onboarding page here
    chrome.tabs.create({ url: 'popup.html' });
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
