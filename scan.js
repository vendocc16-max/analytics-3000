/**
 * Self-contained scan function.
 * This is injected directly into the page by the popup via chrome.scripting.executeScript.
 * It finds all SVG charts, optionally drills down to a target metric/granularity,
 * runs IQR analysis, and returns results.
 * No content script, no message passing — everything runs in one shot.
 */
(async function() {
  'use strict';

  console.log('%c🔍 Looker Extension: Scan starting...', 'background: blue; color: white; padding: 4px 8px;');

  // Read scan settings from storage
  const settings = await new Promise(resolve => {
    chrome.storage.local.get('scanSettings', data => {
      resolve(data.scanSettings || { maxDays: 7 });
    });
  });
  const MAX_DAYS = settings.maxDays;
  const AUTO_DRILL = settings.autoDrillDown || false;
  const TARGET_METRIC = settings.targetMetric || '';
  const TARGET_GRANULARITY = settings.targetGranularity || '';

  console.log(`Recency filter: ${MAX_DAYS === 0 ? 'disabled' : MAX_DAYS + ' days'}`);
  console.log(`Auto drill-down: ${AUTO_DRILL ? `metric="${TARGET_METRIC}", granularity="${TARGET_GRANULARITY}"` : 'disabled'}`);

  // ── SVG Parser ──────────────────────────────────────────────────────────────

  function extractCoordsFromPath(pathD) {
    if (!pathD) return [];
    const coords = [];
    const regex = /([MLCSQTA])\s*([\d.\-e,\s]+)/gi;
    let match;
    while ((match = regex.exec(pathD)) !== null) {
      const nums = match[2].trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i < nums.length - 1; i += 2) {
        if (!isNaN(nums[i]) && !isNaN(nums[i + 1])) {
          coords.push({ x: nums[i], y: nums[i + 1] });
        }
      }
    }
    return coords;
  }

  function extractCoordsFromCircles(circles) {
    return Array.from(circles).map(c => ({
      x: parseFloat(c.getAttribute('cx')),
      y: parseFloat(c.getAttribute('cy'))
    })).filter(c => !isNaN(c.x) && !isNaN(c.y));
  }

  // ── IQR Analysis ────────────────────────────────────────────────────────────

  function calculateQuartiles(data) {
    if (!data || data.length < 4) return null;
    const sorted = [...data].sort((a, b) => a - b);
    const n = sorted.length;
    const q1 = sorted[Math.floor(n * 0.25)];
    const q2 = sorted[Math.floor(n * 0.5)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    return {
      q1, q2, q3, iqr,
      lowerBound: q1 - 1.5 * iqr,
      upperBound: q3 + 1.5 * iqr,
      min: sorted[0],
      max: sorted[n - 1]
    };
  }

  function detectOutlier(value, q) {
    if (!q || q.iqr === 0) return { isOutlier: false };
    // Flag if the value is outside the Q1–Q3 band (the blue shaded area),
    // not the wider 1.5×IQR whisker range.
    if (value < q.q1) {
      const severity = Math.min(Math.abs(value - q.q2) / (q.iqr / 2), 10);
      return { isOutlier: true, deviationType: 'negative', severity, value, bound: q.q1 };
    }
    if (value > q.q3) {
      const severity = Math.min(Math.abs(value - q.q2) / (q.iqr / 2), 10);
      return { isOutlier: true, deviationType: 'positive', severity, value, bound: q.q3 };
    }
    return { isOutlier: false, severity: 0 };
  }

  // ── Chart Discovery ─────────────────────────────────────────────────────────

  function findCharts() {
    const selectors = [
      'ng2-canvas-component.simple-linechart',
      '[data-ng-type="chart"]',
      '.chartSvgContainer',
      'lego-report-widget'
    ];

    const found = new Set();
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => found.add(el));
    }

    return Array.from(found).filter(el => {
      const svg = el.querySelector('svg');
      return svg && svg.querySelectorAll('path[d]').length > 0;
    });
  }

  function getChartTitle(container) {
    const legendEl = container.querySelector(
      '[data-ng-type="chart-title"], .legend-label, .legend-text'
    );
    const seriesName = legendEl ? legendEl.textContent.trim() : '';

    let funnelName = '';
    let el = container;
    for (let i = 0; i < 15 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const heading = el.querySelector(
        '[role="heading"], h1, h2, h3, .widget-title, .chart-title'
      );
      if (heading && heading.textContent.trim()) {
        const text = heading.textContent.trim();
        if (text !== seriesName) {
          funnelName = text;
          break;
        }
      }
    }

    if (funnelName && seriesName) {
      return `${funnelName} — ${seriesName}`;
    }
    return funnelName || seriesName || 'Unnamed Chart';
  }

  // ── Recency Check ──────────────────────────────────────────────────────────

  function isChartRecent(chartContainer) {
    if (MAX_DAYS === 0) return true;

    const svg = chartContainer.querySelector('svg');
    if (!svg) return true;

    const textEls = svg.querySelectorAll('text');
    if (textEls.length === 0) return true;

    const datePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i;
    const weekPattern = /^W(\d{1,2})\s+(\d{4})$/i;
    const dayPattern = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i;

    let latestDate = null;
    let latestX = -Infinity;

    textEls.forEach(t => {
      const text = t.textContent.trim();
      const x = parseFloat(t.getAttribute('x') || t.getBBox?.()?.x || 0);
      let parsed = null;

      let m = text.match(datePattern);
      if (m) {
        const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const monthIdx = monthNames.indexOf(m[1].toLowerCase());
        if (monthIdx >= 0) {
          parsed = new Date(parseInt(m[2]), monthIdx + 1, 0);
        }
      }

      if (!parsed) {
        m = text.match(dayPattern);
        if (m) {
          const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
          const monthIdx = monthNames.indexOf(m[2].toLowerCase());
          if (monthIdx >= 0) {
            parsed = new Date(parseInt(m[3]), monthIdx, parseInt(m[1]));
          }
        }
      }

      if (!parsed) {
        m = text.match(weekPattern);
        if (m) {
          const year = parseInt(m[2]);
          const week = parseInt(m[1]);
          parsed = new Date(year, 0, 1 + (week - 1) * 7);
        }
      }

      if (parsed && x > latestX) {
        latestX = x;
        latestDate = parsed;
      }
    });

    if (!latestDate) {
      console.log('  Could not parse any date labels, including chart');
      return true;
    }

    const now = new Date();
    const diffDays = (now - latestDate) / (1000 * 60 * 60 * 24);
    console.log(`  Latest x-axis date: ${latestDate.toDateString()}, ${diffDays.toFixed(0)} days ago`);

    return diffDays <= MAX_DAYS;
  }

  // ── Drill-Down Automation ─────────────────────────────────────────────────

  /** Dispatch hover events to reveal hidden chart controls */
  function dispatchHover(element) {
    for (const type of ['pointerenter', 'mouseover', 'mouseenter']) {
      element.dispatchEvent(new MouseEvent(type, {
        view: window, bubbles: true, cancelable: true
      }));
    }
  }

  /** Fingerprint the current SVG state for change detection */
  function snapshotSVG(chartContainer) {
    const svg = chartContainer.querySelector('svg');
    if (!svg) return null;
    const paths = svg.querySelectorAll('path[d]');
    const dValues = Array.from(paths).map(p => p.getAttribute('d')).join('|');
    return { pathCount: paths.length, hash: dValues.length + ':' + dValues.substring(0, 200) };
  }

  /** Wait for an element matching a selector or test function (MutationObserver-based) */
  function waitForElement(selectorOrTest, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const testFn = typeof selectorOrTest === 'function'
        ? selectorOrTest
        : () => document.querySelector(selectorOrTest);

      const existing = testFn();
      if (existing) { resolve(existing); return; }

      const observer = new MutationObserver(() => {
        const el = testFn();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`waitForElement timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /** Wait for the SVG inside a chart to change (re-render after drill/metric change) */
  function waitForSVGChange(chartContainer, previousSnapshot, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const svg = chartContainer.querySelector('svg');
      if (!svg) { resolve(); return; }

      const check = () => {
        const current = snapshotSVG(chartContainer);
        if (!current) return false;
        return current.pathCount !== previousSnapshot.pathCount ||
               current.hash !== previousSnapshot.hash;
      };

      if (check()) { resolve(); return; }

      const observer = new MutationObserver(() => {
        if (check()) {
          observer.disconnect();
          clearTimeout(timer);
          // Small settling delay — paths may update in batches
          setTimeout(resolve, 300);
        }
      });

      observer.observe(svg, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['d', 'cx', 'cy', 'transform']
      });

      // Timeout resolves (not rejects) — chart may already be in target state
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeoutMs);
    });
  }

  /** Find drill-down and metric buttons by walking up the DOM */
  function findChartControls(chartContainer) {
    const searchRoots = [chartContainer];
    let parent = chartContainer.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      searchRoots.push(parent);
      parent = parent.parentElement;
    }

    const drillSelectors = [
      '[aria-label*="Drill"]', '[title*="Drill"]', '[data-tooltip*="Drill"]',
      '[aria-label*="drill"]', '[title*="drill"]'
    ];

    const metricSelectors = [
      '[aria-label*="Optional metric"]', '[aria-label*="optional metric"]',
      '[aria-label*="Metric"]', '[title*="Metric"]', '[data-tooltip*="Metric"]',
      '[aria-label*="metric"]'
    ];

    let drillButton = null;
    let metricButton = null;

    for (const root of searchRoots) {
      if (!drillButton) {
        for (const sel of drillSelectors) {
          drillButton = root.querySelector(sel);
          if (drillButton) break;
        }
      }
      if (!metricButton) {
        for (const sel of metricSelectors) {
          metricButton = root.querySelector(sel);
          if (metricButton) break;
        }
      }
      if (drillButton && metricButton) break;
    }

    return { drillButton, metricButton };
  }

  /** Find and click a menu item by text */
  async function clickMenuItem(text, timeoutMs = 4000) {
    // After clicking a button, Looker Studio may render menus using various DOM patterns.
    // Log what appears so we can diagnose which selectors work.
    const dumpNewElements = () => {
      // Look for any popup/overlay/menu that appeared
      const popups = document.querySelectorAll(
        '[role="menu"], [role="listbox"], [role="dialog"], .cdk-overlay-container, ' +
        '.goog-menu, .goog-popup, .dropdown-menu, [class*="menu"], [class*="popup"], ' +
        '[class*="overlay"], [class*="dropdown"], [class*="drill"]'
      );
      if (popups.length > 0) {
        console.log(`  [drill-down] Found ${popups.length} popup/menu elements after click:`);
        popups.forEach((p, i) => {
          const children = p.querySelectorAll('*');
          const textContent = p.textContent?.trim()?.substring(0, 200) || '';
          console.log(`    popup[${i}]: <${p.tagName}> role="${p.getAttribute('role') || ''}" class="${p.className?.toString()?.substring(0, 100) || ''}" children=${children.length} text="${textContent}"`);
        });
      }
    };

    // Try to find the menu item with broad selectors
    const menuItem = await waitForElement(() => {
      // Broad search: any clickable-looking element containing the target text
      const selectors = [
        '[role="menuitem"]', '[role="option"]', '[role="listitem"]',
        '.goog-menuitem', '.goog-menuitem-content',
        '.cdk-overlay-container *',
        '[class*="menu-item"]', '[class*="menuitem"]',
        '[class*="dropdown"] li', '[class*="dropdown"] div',
        '[class*="option"]',
        'mat-option', 'li', '[role="menu"] *'
      ];

      for (const sel of selectors) {
        try {
          const candidates = document.querySelectorAll(sel);
          for (const item of candidates) {
            const itemText = item.textContent.trim();
            if (itemText === text || itemText.includes(text)) {
              return item;
            }
          }
        } catch (e) { /* skip invalid selectors */ }
      }
      return null;
    }, timeoutMs).catch(err => {
      // On timeout, dump what's in the DOM so we can diagnose
      console.log(`  [drill-down] Menu item "${text}" not found. Dumping visible popups...`);
      dumpNewElements();
      throw err;
    });

    menuItem.click();
    return true;
  }

  /** Dismiss any open menus/popups (safe — no Escape key dispatch) */
  function dismissOpenMenus() {
    try {
      // Click on an empty area to close menus, avoiding Escape which crashes Looker Studio
      const overlay = document.querySelector('.cdk-overlay-backdrop, .goog-modalpopup-bg');
      if (overlay) overlay.click();
      // Fallback: click the report body area
      const reportBody = document.querySelector('.reportArea, .canvasArea, [data-ng-type="report"]');
      if (reportBody) reportBody.click();
    } catch (e) {
      // Silently ignore
    }
  }

  /**
   * Prepare a chart for analysis: hover → select metric → drill down → wait for re-render.
   * Returns { metricChanged, granularityChanged, error }
   */
  async function prepareChart(chartContainer, targetMetric, targetGranularity) {
    const log = (msg) => console.log(`  [drill-down] ${msg}`);
    const result = { metricChanged: false, granularityChanged: false, error: null };

    try {
      // Step 1: Hover to reveal controls
      const hoverTarget = chartContainer.querySelector('.component-body') ||
                          chartContainer.querySelector('.component') ||
                          chartContainer;
      dispatchHover(hoverTarget);
      await new Promise(r => setTimeout(r, 500));

      // Step 2: Find controls
      const controls = findChartControls(chartContainer);

      // Step 3: Select metric (if button found and metric specified)
      if (targetMetric && controls.metricButton) {
        log(`Found metric button, selecting "${targetMetric}"...`);
        const preSnapshot = snapshotSVG(chartContainer);

        controls.metricButton.click();

        try {
          await clickMenuItem(targetMetric, 3000);
          log(`Clicked "${targetMetric}" menu item`);
          result.metricChanged = true;

          if (preSnapshot) {
            await waitForSVGChange(chartContainer, preSnapshot, 8000);
            log('SVG re-rendered after metric change');
          }
        } catch (e) {
          log(`Could not select metric "${targetMetric}": ${e.message}`);
          dismissOpenMenus();
        }
      } else if (targetMetric) {
        log('No metric button found, proceeding with current metric');
      }

      // Step 4: Drill down (if button found and granularity specified)
      if (targetGranularity && controls.drillButton) {
        log(`Found drill button, drilling to "${targetGranularity}"...`);
        const preSnapshot = snapshotSVG(chartContainer);

        controls.drillButton.click();

        try {
          await clickMenuItem(targetGranularity, 3000);
          log(`Clicked "${targetGranularity}" menu item`);
          result.granularityChanged = true;

          if (preSnapshot) {
            await waitForSVGChange(chartContainer, preSnapshot, 8000);
            log('SVG re-rendered after granularity change');
          }
        } catch (e) {
          log(`Could not select granularity "${targetGranularity}": ${e.message}`);
          dismissOpenMenus();
        }
      } else if (targetGranularity) {
        log('No drill button found, analyzing chart as-is');
      }

      // Step 5: Clean up
      dismissOpenMenus();
      await new Promise(r => setTimeout(r, 200));

    } catch (e) {
      result.error = e.message;
      log(`Preparation failed: ${e.message}`);
      dismissOpenMenus();
    }

    return result;
  }

  // ── Main Scan ───────────────────────────────────────────────────────────────

  const charts = findCharts();
  console.log(`Found ${charts.length} charts with SVG data`);

  const allSvgs = document.querySelectorAll('svg');
  console.log(`Total SVGs on page: ${allSvgs.length}`);

  if (charts.length === 0) {
    console.log('No charts found via selectors. Trying raw SVG scan...');
    allSvgs.forEach((svg, i) => {
      const paths = svg.querySelectorAll('path[d]');
      if (paths.length > 0) {
        console.log(`  SVG #${i}: ${paths.length} paths, parent: <${svg.parentElement?.tagName}>, classes: ${svg.parentElement?.className}`);
      }
    });
  }

  const results = [];

  for (let index = 0; index < charts.length; index++) {
    const chart = charts[index];
    const svg = chart.querySelector('svg');
    if (!svg) continue;

    const title = getChartTitle(chart);
    console.log(`Analyzing chart ${index + 1}/${charts.length}: "${title}"`);

    // Skip charts whose latest data point is older than MAX_DAYS
    if (!isChartRecent(chart)) {
      console.log(`  Skipping "${title}" — latest data is older than ${MAX_DAYS} days`);
      continue;
    }

    // Drill-down automation (if enabled)
    if (AUTO_DRILL) {
      console.log(`  [drill-down] AUTO_DRILL is ON, preparing chart...`);

      // Debug: dump DOM around chart to find control buttons
      const searchRoots = [chart];
      let _p = chart.parentElement;
      for (let _i = 0; _i < 5 && _p; _i++) { searchRoots.push(_p); _p = _p.parentElement; }
      for (const root of searchRoots) {
        const allButtons = root.querySelectorAll('[role="button"], button, [aria-label]');
        if (allButtons.length > 0) {
          console.log(`  [drill-down] Buttons in <${root.tagName}.${root.className?.split?.(' ')?.[0] || ''}>:`);
          allButtons.forEach(b => {
            console.log(`    tag=${b.tagName}, aria="${b.getAttribute('aria-label') || ''}", title="${b.getAttribute('title') || ''}", text="${b.textContent?.trim()?.substring(0, 50) || ''}"`)
          });
        }
      }

      const prepResult = await prepareChart(
        chart,
        TARGET_METRIC || null,
        TARGET_GRANULARITY || null
      );
      console.log(`  Prep: metric=${prepResult.metricChanged}, drill=${prepResult.granularityChanged}${prepResult.error ? ', error=' + prepResult.error : ''}`);
    } else {
      console.log(`  [drill-down] AUTO_DRILL is OFF, skipping`);
    }

    // Report progress
    chrome.storage.local.set({
      scanProgress: { current: index + 1, total: charts.length, currentChart: title }
    });

    // ── IQR Analysis on paths ──
    const paths = svg.querySelectorAll('path[d]');
    paths.forEach((path, pi) => {
      const coords = extractCoordsFromPath(path.getAttribute('d'));
      if (coords.length < 4) return;

      const yValues = coords.map(c => -c.y);
      const latest = coords.reduce((best, c) => c.x > best.x ? c : best, coords[0]);
      const latestY = -latest.y;

      const quartiles = calculateQuartiles(yValues);
      if (!quartiles) return;

      const outlier = detectOutlier(latestY, quartiles);

      console.log(`  Path ${pi}: ${coords.length} points, latest Y=${latestY.toFixed(1)}, Q1=${quartiles.q1.toFixed(1)}, Q3=${quartiles.q3.toFixed(1)}, outlier=${outlier.isOutlier}`);

      if (outlier.isOutlier) {
        const type = outlier.deviationType === 'positive' ? '↑ SPIKE' : '↓ DIP';
        results.push({
          chartTitle: title,
          timestamp: new Date().toLocaleTimeString(),
          report: `${type} | Value: ${outlier.value.toFixed(1)} | Bound: ${outlier.bound.toFixed(1)} | Severity: ${outlier.severity.toFixed(1)}/10`,
          severity: outlier.severity,
          value: outlier.value,
          deviationType: outlier.deviationType
        });

        chart.style.outline = '3px solid red';
        chart.style.outlineOffset = '2px';
      }
    });

    // ── IQR Analysis on circles ──
    const circles = svg.querySelectorAll('circle');
    if (circles.length >= 4) {
      const coords = extractCoordsFromCircles(circles);
      if (coords.length >= 4) {
        const yValues = coords.map(c => -c.y);
        const latest = coords.reduce((best, c) => c.x > best.x ? c : best, coords[0]);
        const latestY = -latest.y;
        const quartiles = calculateQuartiles(yValues);
        if (quartiles) {
          const outlier = detectOutlier(latestY, quartiles);
          console.log(`  Circles: ${coords.length} points, latest Y=${latestY.toFixed(1)}, outlier=${outlier.isOutlier}`);
          if (outlier.isOutlier) {
            const type = outlier.deviationType === 'positive' ? '↑ SPIKE' : '↓ DIP';
            results.push({
              chartTitle: title + ' (markers)',
              timestamp: new Date().toLocaleTimeString(),
              report: `${type} | Value: ${outlier.value.toFixed(1)} | Bound: ${outlier.bound.toFixed(1)} | Severity: ${outlier.severity.toFixed(1)}/10`,
              severity: outlier.severity,
              value: outlier.value,
              deviationType: outlier.deviationType
            });
          }
        }
      }
    }
  }

  console.log(`%c✅ Scan complete: ${results.length} deviations in ${charts.length} charts`, 'background: green; color: white; padding: 4px 8px;');

  // Store results in extension storage
  chrome.storage.local.set({
    deviationResults: results,
    scanInfo: {
      totalCharts: charts.length,
      totalSvgs: allSvgs.length,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }
  });

  // Clear progress
  chrome.storage.local.remove('scanProgress');

  return { results, totalCharts: charts.length, totalSvgs: allSvgs.length };
})();
