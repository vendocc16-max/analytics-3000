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

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Optionally auto-scan when a Looker Studio report loads
  if (changeInfo.status === 'complete' && 
      (tab.url.includes('looker.google.com') || tab.url.includes('datastudio.google.com'))) {
    // Could trigger auto-scan here if desired
  }
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
