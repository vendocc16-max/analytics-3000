/**
 * Page Script Injector
 * This runs in the page context (not content script sandbox)
 * It's injected via a script tag at document_start
 */

(function() {
  console.log('🔧 Looker Extension Injector running...');
  
  // Wait for all scripts to load
  setTimeout(() => {
    console.log('📊 Injector: Checking for chart functions...');
    
    // Check if window has the extension globals
    if (window.__lookerExtensionInjectionAttempted) {
      console.log('✅ Extension scripts already injected');
      return;
    }
    
    // Listen for postMessage from content script
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      
      if (event.data.type && event.data.type === 'START_EXTENSION_SCAN') {
        console.log('📌 Received scan request from content script');
        
        // Execute the scan if functions are available
        if (window.performDeviationScan && typeof window.performDeviationScan === 'function') {
          console.log('🚀 Starting scan...');
          window.performDeviationScan();
        } else {
          console.log('⚠️ Scan function not available yet');
        }
      }
    }, false);
    
    console.log('✅ Injector ready. Listening for scan requests.');
  }, 500);
})();
