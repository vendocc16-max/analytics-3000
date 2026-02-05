/**
 * Main Content Script
 * Orchestrates the funnel deviation pre-scan
 */

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
 * Performs the complete funnel deviation pre-scan
 */
async function performDeviationScan() {
  if (ExtensionState.isScanning) return;
  
  ExtensionState.isScanning = true;
  ExtensionState.deviationResults = [];
  ExtensionState.chartAnalysis.clear();

  try {
    // Find all charts on the page
    const charts = ChartInteraction.findAllCharts();
    
    if (charts.length === 0) {
      console.log('No charts found on this page');
      ExtensionState.isScanning = false;
      return;
    }

    console.log(`Found ${charts.length} charts. Starting analysis...`);

    // Analyze each chart
    for (const chart of charts) {
      await analyzeChart(chart);
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
      console.error('Error sending message to popup:', err);
    });

    console.log(`Scan complete. Found ${ExtensionState.deviationResults.length} deviations`);

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

// Auto-scan on page load (optional - comment out to disable)
// if (document.readyState === 'loading') {
//   document.addEventListener('DOMContentLoaded', performDeviationScan);
// } else {
//   performDeviationScan();
// }

console.log('Looker Studio Funnel Deviation Pre-Scan extension loaded');
