/**
 * Popup Script
 * Manages the extension popup UI
 */

const UI = {
  scanBtn: document.getElementById('scan-btn'),
  clearBtn: document.getElementById('clear-btn'),
  resultsContainer: document.getElementById('results'),
  statusBadge: document.getElementById('status'),
  totalChartsDisplay: document.getElementById('total-charts'),
  deviationsCountDisplay: document.getElementById('deviations-count')
};

/**
 * Updates the UI with results
 */
function displayResults(results, totalCharts) {
  if (results.length === 0) {
    UI.resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <div>No deviations detected. All metrics are within normal range.</div>
      </div>
    `;
    UI.totalChartsDisplay.textContent = totalCharts || '-';
    UI.deviationsCountDisplay.textContent = '0';
    return;
  }

  // Sort by severity (highest first)
  const sorted = [...results].sort((a, b) => (b.severity || 0) - (a.severity || 0));

  const html = sorted.map((result, index) => {
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
 * Starts the deviation scan
 */
async function startScan() {
  UI.scanBtn.disabled = true;
  UI.statusBadge.textContent = 'Scanning...';
  UI.statusBadge.className = 'status-badge active';

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Send message to content script
    chrome.tabs.sendMessage(tab.id, { type: 'START_SCAN' }, (response) => {
      // Response handler for initial ack
    });

    // Wait for results
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_ANALYSIS' }, (response) => {
        if (response && response.results) {
          displayResults(response.results, response.results.length);
          UI.statusBadge.textContent = `Complete`;
          UI.statusBadge.className = 'status-badge';
        }
        UI.scanBtn.disabled = false;
      });
    }, 3000);

  } catch (error) {
    console.error('Error starting scan:', error);
    UI.statusBadge.textContent = 'Error';
    UI.statusBadge.className = 'status-badge error';
    UI.scanBtn.disabled = false;
  }
}

/**
 * Clears highlights and results
 */
async function clearResults() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHTS' }, (response) => {
      UI.resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div>Cleared. Click "Start Scan" to run again.</div>
        </div>
      `;
      UI.totalChartsDisplay.textContent = '-';
      UI.deviationsCountDisplay.textContent = '0';
      UI.statusBadge.textContent = 'Ready';
    });

  } catch (error) {
    console.error('Error clearing:', error);
  }
}

/**
 * Listen for messages from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'DEVIATION_SCAN_COMPLETE') {
    displayResults(request.results, request.totalCharts);
    UI.statusBadge.textContent = `${request.deviationsFound} found`;
    UI.statusBadge.className = request.deviationsFound > 0 ? 'status-badge error' : 'status-badge';
    UI.scanBtn.disabled = false;
  }
});

// Event listeners
UI.scanBtn.addEventListener('click', startScan);
UI.clearBtn.addEventListener('click', clearResults);

// Load last scan results on popup open
chrome.storage.local.get('lastScanResults', (data) => {
  if (data.lastScanResults && data.lastScanResults.results.length > 0) {
    displayResults(data.lastScanResults.results, data.lastScanResults.totalCharts);
  }
});
