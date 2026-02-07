/**
 * Popup Script
 * Uses chrome.scripting.executeScript to inject scan directly into the active tab.
 * No content script message passing needed.
 */

const UI = {
  scanBtn: document.getElementById('scan-btn'),
  clearBtn: document.getElementById('clear-btn'),
  daysFilter: document.getElementById('days-filter'),
  autoDrillDown: document.getElementById('auto-drill'),
  metricSelect: document.getElementById('metric-select'),
  granularitySelect: document.getElementById('granularity-select'),
  drillOptions: document.getElementById('drill-options'),
  resultsContainer: document.getElementById('results'),
  statusBadge: document.getElementById('status'),
  totalChartsDisplay: document.getElementById('total-charts'),
  deviationsCountDisplay: document.getElementById('deviations-count')
};

// Toggle drill-down options visibility
if (UI.autoDrillDown) {
  UI.autoDrillDown.addEventListener('change', () => {
    UI.drillOptions.style.display = UI.autoDrillDown.checked ? 'flex' : 'none';
  });
}

/**
 * Updates the UI with results
 */
function displayResults(results, totalCharts) {
  if (!results || results.length === 0) {
    UI.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <div>No deviations detected in ${totalCharts || 0} chart(s). All metrics within normal range.</div>
      </div>
    `;
    UI.totalChartsDisplay.textContent = totalCharts || '-';
    UI.deviationsCountDisplay.textContent = '0';
    return;
  }

  const sorted = [...results].sort((a, b) => (b.severity || 0) - (a.severity || 0));

  const html = sorted.map((result) => {
    const severityPercent = Math.min((result.severity / 10) * 100, 100);
    const typeIcon = result.deviationType === 'positive' ? '📈' : '📉';

    return `
      <div class="result-item">
        <div class="result-title">
          ${typeIcon} ${result.chartTitle}
          <span class="deviant-badge">${result.deviationType.toUpperCase()}</span>
        </div>
        <div class="result-report">${result.report}</div>
        <div class="result-meta">
          <span>${result.timestamp}</span>
          <span>
            Severity: ${result.severity.toFixed(1)}/10
            <div class="severity-meter">
              <div class="severity-meter-fill" style="width: ${severityPercent}%"></div>
            </div>
          </span>
        </div>
      </div>
    `;
  }).join('');

  UI.resultsContainer.innerHTML = `<div class="scroll-spacer">${html}<div class="scroll-spacer"></div></div>`;
  UI.totalChartsDisplay.textContent = totalCharts || '-';
  UI.deviationsCountDisplay.textContent = results.length;
}

/**
 * Shows final results from storage
 */
function showResults(data) {
  const results = data.deviationResults || [];
  const info = data.scanInfo || {};

  if (info.totalCharts === 0 && info.totalSvgs === 0) {
    UI.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div>No SVG charts found on this page. Make sure charts are visible and loaded.</div>
      </div>
    `;
    UI.statusBadge.textContent = 'No charts found';
    UI.statusBadge.className = 'status-badge';
  } else if (results.length === 0) {
    displayResults([], info.totalCharts);
    UI.statusBadge.textContent = `${info.totalCharts} charts OK`;
    UI.statusBadge.className = 'status-badge';
  } else {
    displayResults(results, info.totalCharts);
    UI.statusBadge.textContent = `${results.length} deviations`;
    UI.statusBadge.className = 'status-badge error';
  }

  UI.scanBtn.disabled = false;
}

/**
 * Starts the deviation scan by injecting scan.js into the active tab
 */
async function startScan() {
  UI.scanBtn.disabled = true;
  UI.statusBadge.textContent = 'Scanning...';
  UI.statusBadge.className = 'status-badge active';
  UI.resultsContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⏳</div>
      <div>Scanning charts on this page...</div>
    </div>
  `;

  const scanStartTime = new Date();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    // Store all settings so scan.js can read them
    const maxDays = parseInt(UI.daysFilter.value) || 0;
    await chrome.storage.local.set({
      scanSettings: {
        maxDays,
        autoDrillDown: UI.autoDrillDown.checked,
        targetMetric: UI.metricSelect.value || '',
        targetGranularity: UI.granularitySelect.value || ''
      }
    });

    // Clear previous results and progress
    await chrome.storage.local.remove(['deviationResults', 'scanInfo', 'scanProgress']);

    // Inject and execute scan.js directly into the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scan.js']
    });

    // Poll for results (drill-down can take 30-60s for many charts)
    const progressInterval = setInterval(() => {
      chrome.storage.local.get('scanProgress', (data) => {
        if (data.scanProgress) {
          const p = data.scanProgress;
          UI.statusBadge.textContent = `Scanning ${p.current}/${p.total}...`;
        }
      });
    }, 1000);

    const pollInterval = setInterval(() => {
      chrome.storage.local.get(['deviationResults', 'scanInfo'], (data) => {
        if (data.scanInfo && data.scanInfo.timestamp) {
          const resultTime = new Date(data.scanInfo.timestamp);
          if (resultTime > scanStartTime) {
            clearInterval(pollInterval);
            clearInterval(progressInterval);
            showResults(data);
          }
        }
      });
    }, 1500);

    // Safety timeout: stop polling after 2 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      clearInterval(progressInterval);
      // Try to show whatever results exist
      chrome.storage.local.get(['deviationResults', 'scanInfo'], (data) => {
        if (data.scanInfo) {
          showResults(data);
        } else {
          UI.statusBadge.textContent = 'Timeout';
          UI.statusBadge.className = 'status-badge error';
          UI.scanBtn.disabled = false;
        }
      });
    }, 120000);

  } catch (error) {
    console.error('Scan error:', error);
    UI.statusBadge.textContent = 'Error';
    UI.statusBadge.className = 'status-badge error';
    UI.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">❌</div>
        <div>Error: ${error.message}</div>
      </div>
    `;
    UI.scanBtn.disabled = false;
  }
}

/**
 * Clears results
 */
function clearResults() {
  chrome.storage.local.remove(['deviationResults', 'scanInfo', 'scanProgress'], () => {
    UI.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div>Cleared. Click "Start Scan" to run again.</div>
      </div>
    `;
    UI.totalChartsDisplay.textContent = '-';
    UI.deviationsCountDisplay.textContent = '0';
    UI.statusBadge.textContent = 'Ready';
    UI.statusBadge.className = 'status-badge';
  });
}

// Event listeners
if (UI.scanBtn) UI.scanBtn.addEventListener('click', startScan);
if (UI.clearBtn) UI.clearBtn.addEventListener('click', clearResults);

// Load previous results on popup open
chrome.storage.local.get(['deviationResults', 'scanInfo'], (data) => {
  if (data.deviationResults && data.deviationResults.length > 0) {
    displayResults(data.deviationResults, data.scanInfo?.totalCharts);
    UI.statusBadge.textContent = `${data.deviationResults.length} deviations`;
    UI.statusBadge.className = 'status-badge error';
  }
});
