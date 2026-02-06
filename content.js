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

// Auto-scan state
let autoScanAttempts = 0;
const MAX_AUTO_SCAN_ATTEMPTS = 15;
let autoScanTimerId = null;
let autoScanCompleted = false;
let mutationScanDebounce = null;

/**
 * Checks whether charts with rendered SVG paths exist on the page.
 * findAllCharts() only returns charts that contain an <svg>, but the SVG
 * may be empty (no <path> elements yet). This function goes one step
 * further and checks for actual rendered path data.
 */
function findChartsWithRenderedSVG() {
  const charts = ChartInteraction.findAllCharts();
  return charts.filter(chart => {
    const svg = chart.querySelector('svg');
    return svg && svg.querySelectorAll('path[d]').length > 0;
  });
}

/**
 * Polls for charts with exponential backoff until rendered SVGs are found.
 */
function autoScanWithRetry() {
  if (autoScanCompleted || ExtensionState.isScanning) return;

  autoScanAttempts++;
  console.log(`Auto-scan attempt ${autoScanAttempts}/${MAX_AUTO_SCAN_ATTEMPTS}...`);

  const readyCharts = findChartsWithRenderedSVG();
  console.log(`Chart detection: ${readyCharts.length} charts with rendered SVGs found`);

  if (readyCharts.length > 0) {
    autoScanCompleted = true;
    console.log(`Found ${readyCharts.length} rendered charts. Starting automatic scan...`);
    performDeviationScan();
    return;
  }

  if (autoScanAttempts >= MAX_AUTO_SCAN_ATTEMPTS) {
    console.log('Max auto-scan attempts reached. Charts may not be present on this page.');
    console.log('Use the popup "Start Scan" button to scan manually.');
    return;
  }

  // Exponential backoff: 1s, 1.5s, 2.25s, ... capped at 5s
  const delay = Math.min(1000 * Math.pow(1.5, autoScanAttempts - 1), 5000);
  console.log(`No rendered charts yet. Retrying in ${Math.round(delay)}ms...`);
  autoScanTimerId = setTimeout(autoScanWithRetry, delay);
}

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

// Store results in local storage whenever they update
function storeResultsInStorage() {
  chrome.storage.local.set({
    deviationResults: ExtensionState.deviationResults,
    lastScanTime: new Date().toISOString()
  });
}

/**
 * Listens for messages from popup and background script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Ping for diagnostics
  if (request.type === 'PING') {
    sendResponse({ status: 'pong', contentScriptActive: true });
    return true;
  }

  if (request.type === 'START_SCAN') {
    // Manual scan from popup - reset the auto-scan guard so it can run
    autoScanCompleted = false;
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

  if (request.type === 'SPA_NAVIGATION') {
    console.log('SPA navigation detected. Resetting and re-scanning...');
    autoScanCompleted = false;
    autoScanAttempts = 0;
    clearTimeout(autoScanTimerId);
    clearTimeout(mutationScanDebounce);
    ExtensionState.isScanning = false;
    ExtensionState.deviationResults = [];
    ExtensionState.chartAnalysis.clear();
    clearAllHighlights();
    autoScanWithRetry();
    sendResponse({ status: 'rescan_started' });
    return true;
  }
});

// --- Initialization ---

console.log('Looker Studio Funnel Deviation Pre-Scan extension loaded');

// Start the polling-based auto-scan
try {
  autoScanWithRetry();
} catch (e) {
  console.error('Auto-scan failed:', e);
}

// MutationObserver: watch for SVG paths being rendered inside chart containers.
// This catches both new chart containers being added AND existing containers
// getting their SVG content populated after async data loads.
const pageObserver = new MutationObserver((mutations) => {
  if (autoScanCompleted || ExtensionState.isScanning) return;

  try {
    const hasChartChanges = mutations.some(m => {
      if (m.type !== 'childList' || m.addedNodes.length === 0) return false;
      return Array.from(m.addedNodes).some(node => {
        if (node.nodeType !== 1) return false;
        // A new chart container was added
        if (node.querySelector?.('[data-ng-type="chart"]') ||
            (node.hasAttribute?.('data-ng-type') && node.getAttribute('data-ng-type') === 'chart')) {
          return true;
        }
        // An SVG or path was added inside an existing chart container
        if (node.tagName === 'svg' || node.tagName === 'path' ||
            node.querySelector?.('svg path[d]')) {
          const closestChart = node.closest?.('[data-ng-type="chart"]');
          return closestChart !== null;
        }
        return false;
      });
    });

    if (hasChartChanges) {
      // Debounce: charts render in bursts, wait for them to settle
      clearTimeout(mutationScanDebounce);
      mutationScanDebounce = setTimeout(() => {
        const readyCharts = findChartsWithRenderedSVG();
        if (readyCharts.length > 0 && !autoScanCompleted && !ExtensionState.isScanning) {
          console.log(`MutationObserver: ${readyCharts.length} charts now have rendered SVGs. Scanning...`);
          autoScanCompleted = true;
          clearTimeout(autoScanTimerId);
          performDeviationScan();
        }
      }, 500);
    }
  } catch (e) {
    console.error('Mutation observer error:', e);
  }
});

// Start monitoring for chart rendering.
// document.body may not exist yet if injected at document_start, so wait for it.
function startObserver() {
  const target = document.body || document.documentElement;
  if (target) {
    pageObserver.observe(target, {
      childList: true,
      subtree: true
    });
    console.log('Extension fully initialized with auto-scan enabled');
  } else {
    // Body not ready yet — wait and retry
    document.addEventListener('DOMContentLoaded', () => {
      pageObserver.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
      console.log('Extension fully initialized with auto-scan enabled (after DOMContentLoaded)');
    });
  }
}

try {
  startObserver();
} catch (e) {
  console.error('Failed to start observer:', e);
}
