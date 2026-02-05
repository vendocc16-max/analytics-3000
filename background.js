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
  try {
    // Optionally auto-scan when a Looker Studio report loads
    if (!tab || !changeInfo || changeInfo.status !== 'complete') {
      return;
    }
    
    const url = tab.url || '';
    if (url.includes('looker.google.com') || url.includes('datastudio.google.com')) {
      // Could trigger auto-scan here if desired
    }
  } catch (error) {
    // Silently catch any errors - some tabs don't have URL access
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
