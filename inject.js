/**
 * Injector script - runs at document_start to ensure early injection
 */
(function() {
  console.log('🔧 Injector: Preparing to inject extension scripts...');
  
  // Set a flag that we attempted injection
  window.__lookerExtensionInjectionAttempted = true;
  
  // Try to load and execute the content scripts in order
  const scripts = [
    'svgParser.js',
    'iqrAnalysis.js',
    'chartInteraction.js',
    'content.js'
  ];
  
  let loadedCount = 0;
  
  scripts.forEach((scriptName) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(scriptName);
    script.onload = () => {
      loadedCount++;
      console.log(`✓ Loaded ${scriptName} (${loadedCount}/${scripts.length})`);
      if (loadedCount === scripts.length) {
        console.log('✅ All scripts injected successfully');
      }
    };
    script.onerror = () => {
      console.error(`✗ Failed to load ${scriptName}`);
    };
    document.documentElement.appendChild(script);
  });
})();
