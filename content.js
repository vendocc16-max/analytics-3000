/**
 * Main Content Script
 * Orchestrates the funnel deviation pre-scan
 */

// FIRST LOG - absolutely at the top
window.__ext_loaded = true;
console.log('%c✅ EXTENSION INJECTED', 'background: green; color: white; font-size: 14px; padding: 5px;');
console.log('Page URL:', window.location.href);
console.log('Looker Extension is ACTIVE and ready');

// Small delay to ensure logging
setTimeout(() => {
  console.log('Extension initialization complete');
}, 100);

// Global state
const ExtensionState = {
  deviationResults: [],
  isScanning: false,
  chartAnalysis: new Map()
};

/**
 * Analyzes a single chart for deviations
 */
async function analyzeChart(chartContainer) {
  try {
    const chartTitle = ChartInteraction.getChartTitle(chartContainer);
    
    // Wait for SVG to render
    const svg = await ChartInteraction.waitForSVGRender(chartContainer, 5000);
    
    // Extract data series from SVG
    const series = SVGParser.extractDataSeries(svg);
    
    if (series.length === 0) {
      console.warn(`No data series found in chart: ${chartTitle}`);
      return null;
    }

    const svgBounds = SVGParser.getSVGBounds(svg);
    
    // Analyze each series
    const analysisResults = [];
    
    for (const s of series) {
      if (s.coordinates.length < 4) continue; // Need sufficient data points

      // Extract y-values from coordinates
      const yValues = s.coordinates.map(coord => coord.y);
      
      // Get the latest data point
      const latestPoint = SVGParser.getLatestDataPoint(s.coordinates);
      
      if (!latestPoint) continue;

      // Perform IQR analysis
      const analysis = IQRAnalysis.analyzeDeviation(yValues, latestPoint.y);
      
      analysisResults.push({
        chartTitle,
        seriesType: s.type,
        analysis,
        latestValue: latestPoint.y,
        isDeviation: analysis.outlierResult.isOutlier
      });
    }

    // Check if any series has deviation
    const hasDeviation = analysisResults.some(r => r.isDeviation);
    
    if (hasDeviation) {
      // Highlight the chart
      ChartInteraction.highlightChart(chartContainer, '#FF0000', 3);
      
      analysisResults.forEach(result => {
        if (result.isDeviation) {
          ExtensionState.deviationResults.push({
            chartTitle,
            timestamp: new Date().toLocaleTimeString(),
            report: IQRAnalysis.formatAnalysisReport(result.analysis),
            severity: result.analysis.outlierResult.severity,
            value: result.analysis.outlierResult.value,
            deviationType: result.analysis.outlierResult.deviationType
          });
        }
      });
    }

    // Store analysis
    ExtensionState.chartAnalysis.set(chartTitle, analysisResults);
    
    return {
      chartTitle,
      hasDeviation,
      results: analysisResults
    };

  } catch (error) {
    console.error(`Error analyzing chart:`, error);
    return null;
  }
}

/**
 * Performs the complete funnel deviation pre-scan with automatic drill-down
 */
async function performDeviationScan() {
  if (ExtensionState.isScanning) return;
  
  ExtensionState.isScanning = true;
  ExtensionState.deviationResults = [];
  ExtensionState.chartAnalysis.clear();

  try {
    // Find all charts on the page
    const charts = ChartInteraction.findAllCharts();
    
    console.log(`🔍 Extension scan initiated. Searching for charts...`);
    
    if (charts.length === 0) {
      console.warn('⚠️ No charts found on this page');
      ExtensionState.isScanning = false;
      return;
    }

    console.log(`✓ Found ${charts.length} charts. Starting deviation analysis...`);

    // Analyze each chart
    for (const chart of charts) {
      const result = await analyzeChart(chart);
      
      // If deviation found, automatically drill down
      if (result && result.hasDeviation) {
        console.log(`📊 Deviation detected in: ${result.chartTitle}. Executing drill-down...`);
        try {
          // Click the chart to select it
          chart.click();
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Perform the drill-down automation
          await automateMetricAndDrillDown(chart, 'CVR', 'Week');
          console.log(`✓ Drill-down complete for: ${result.chartTitle}`);
        } catch (drillError) {
          console.log(`ℹ️ Drill-down not available for this chart (manual interaction may be needed)`);
        }
      }
      
      // Small delay between charts to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Send results to popup
    chrome.runtime.sendMessage({
      type: 'DEVIATION_SCAN_COMPLETE',
      results: ExtensionState.deviationResults,
      totalCharts: charts.length,
      deviationsFound: ExtensionState.deviationResults.length
    }).catch(err => {
      // Popup may not be open, this is normal
    });

    console.log(`✅ Scan complete. Found ${ExtensionState.deviationResults.length} deviations in ${charts.length} charts`);

    // Store results in local storage for popup to read
    storeResultsInStorage();

  } catch (error) {
    console.error('Error during deviation scan:', error);
  } finally {
    ExtensionState.isScanning = false;
  }
}

/**
 * Advanced: Automates metric selection and drill down
 * Note: Requires manual interaction/confirmation due to DOM complexity
 */
async function automateMetricAndDrillDown(chartContainer, metric = 'CVR', granularity = 'Week') {
  try {
    // Step 1: Select optional metric
    console.log(`Selecting metric: ${metric}`);
    const metricsClicked = await ChartInteraction.clickOptionalMetricsMenu(chartContainer);
    
    if (metricsClicked) {
      await ChartInteraction.selectMetric(metric);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for chart to update
    }

    // Step 2: Drill down to granularity
    console.log(`Setting granularity to: ${granularity}`);
    const drillClicked = await ChartInteraction.clickDrillDownButton(chartContainer);
    
    if (drillClicked) {
      await ChartInteraction.selectGranularity(granularity);
      await new Promise(resolve => setTimeout(resolve, 1500)); // Wait for chart to re-render
    }

    return true;

  } catch (error) {
    console.error('Error during automation:', error);
    return false;
  }
}

/**
 * Clears all highlights from charts
 */
function clearAllHighlights() {
  const highlightedCharts = document.querySelectorAll('[data-deviation-highlighted]');
  highlightedCharts.forEach(chart => {
    ChartInteraction.removeHighlight(chart);
  });
}

/**
 * Listens for messages from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ping for diagnostics
  if (request.type === 'PING') {
    sendResponse({ status: 'pong', contentScriptActive: true });
    return true;
  }

  if (request.type === 'START_SCAN') {
    performDeviationScan().then(() => {
      sendResponse({ status: 'scanning' });
    });
    return true; // Async response
  }

  if (request.type === 'CLEAR_HIGHLIGHTS') {
    clearAllHighlights();
    sendResponse({ status: 'cleared' });
  }

  if (request.type === 'GET_ANALYSIS') {
    sendResponse({
      results: ExtensionState.deviationResults,
      analysis: Array.from(ExtensionState.chartAnalysis.entries())
    });
  }
});

// Store results in local storage whenever they update
function storeResultsInStorage() {
  chrome.storage.local.set({
    deviationResults: ExtensionState.deviationResults,
    lastScanTime: new Date().toISOString()
  });
}

// Auto-scan on page load - automatically detect deviations
function autoScanIfChartsFound() {
  console.log('🚀 Auto-scan triggered. Checking for charts...');
  const charts = ChartInteraction.findAllCharts();
  console.log(`Chart detection result: ${charts.length} charts found`);
  if (charts.length > 0) {
    console.log(`✓ Found ${charts.length} charts. Starting automatic scan...`);
    performDeviationScan();
  } else {
    console.log('ℹ️ No charts found yet. Will monitor for new charts...');
  }
}

// Multiple triggers for auto-scan to catch all loading scenarios
console.log('📌 Looker Studio Funnel Deviation Pre-Scan extension loaded');

// Trigger 0: Immediate scan attempt (in case everything is ready)
try {
  console.log('Attempting immediate scan...');
  autoScanIfChartsFound();
} catch (e) {
  console.error('Immediate scan failed:', e);
}

// Trigger 1: Page load event
if (document.readyState === 'loading') {
  console.log('Page still loading, waiting for DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', () => {
    try {
      autoScanIfChartsFound();
    } catch (e) {
      console.error('DOMContentLoaded scan failed:', e);
    }
  });
} else {
  console.log('Page already loaded, triggering scan immediately...');
  try {
    autoScanIfChartsFound();
  } catch (e) {
    console.error('Page ready scan failed:', e);
  }
}

// Trigger 2: Delay for async rendering
setTimeout(() => {
  try {
    console.log('Triggering delayed scan (500ms) for async content...');
    autoScanIfChartsFound();
  } catch (e) {
    console.error('Delayed scan failed:', e);
  }
}, 500);

// Trigger 3: Another delay for heavily async pages
setTimeout(() => {
  try {
    console.log('Triggering second delayed scan (2000ms) for heavily async pages...');
    autoScanIfChartsFound();
  } catch (e) {
    console.error('Second delayed scan failed:', e);
  }
}, 2000);

// Also scan when new charts are added to the page (dynamic content)
const pageObserver = new MutationObserver((mutations) => {
  try {
    const hasNewCharts = mutations.some(m => {
      if (m.type === 'childList' && m.addedNodes.length > 0) {
        return Array.from(m.addedNodes).some(node => 
          node.nodeType === 1 && (
            node.querySelector?.('[data-ng-type="chart"]') ||
            node.hasAttribute?.('data-ng-type') && node.getAttribute?.('data-ng-type') === 'chart'
          )
        );
      }
      return false;
    });
    
    if (hasNewCharts && !ExtensionState.isScanning) {
      console.log('📊 New charts detected via mutation observer. Running scan...');
      setTimeout(autoScanIfChartsFound, 300); // Small delay for chart to render
    }
  } catch (e) {
    console.error('Mutation observer error:', e);
  }
});

// Start monitoring for new charts
try {
  pageObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  console.log('✅ Extension fully initialized with auto-scan enabled');
} catch (e) {
  console.error('Failed to start observer:', e);
}
