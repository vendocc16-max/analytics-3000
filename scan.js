/**
 * Self-contained scan function.
 * This is injected directly into the page by the popup via chrome.scripting.executeScript.
 * It finds all SVG charts, runs IQR analysis, and returns results.
 * No content script, no message passing — everything runs in one shot.
 */
(function() {
  'use strict';

  console.log('%c🔍 Looker Extension: Scan starting...', 'background: blue; color: white; padding: 4px 8px;');

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
    if (value < q.lowerBound) {
      const severity = Math.min(Math.abs(value - q.q2) / (q.iqr / 2), 10);
      return { isOutlier: true, deviationType: 'negative', severity, value, bound: q.lowerBound };
    }
    if (value > q.upperBound) {
      const severity = Math.min(Math.abs(value - q.q2) / (q.iqr / 2), 10);
      return { isOutlier: true, deviationType: 'positive', severity, value, bound: q.upperBound };
    }
    return { isOutlier: false, severity: 0 };
  }

  // ── Chart Discovery ─────────────────────────────────────────────────────────

  function findCharts() {
    // Try multiple selectors for Looker Studio charts
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

    // Filter to elements with SVGs that have actual path data
    return Array.from(found).filter(el => {
      const svg = el.querySelector('svg');
      return svg && svg.querySelectorAll('path[d]').length > 0;
    });
  }

  function getChartTitle(container) {
    // Walk up the DOM tree to find a title near the chart
    let el = container;
    for (let i = 0; i < 5 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      // Look for title-like elements
      const titleEl = el.querySelector(
        '[data-ng-type="chart-title"], [role="heading"], .widget-title, .chart-title'
      );
      if (titleEl && titleEl.textContent.trim()) {
        return titleEl.textContent.trim();
      }
    }
    return 'Unnamed Chart';
  }

  // ── Main Scan ───────────────────────────────────────────────────────────────

  const charts = findCharts();
  console.log(`Found ${charts.length} charts with SVG data`);

  // Also log all SVGs on the page for debugging
  const allSvgs = document.querySelectorAll('svg');
  console.log(`Total SVGs on page: ${allSvgs.length}`);

  if (charts.length === 0) {
    // Fallback: try to find ANY SVG with path data
    console.log('No charts found via selectors. Trying raw SVG scan...');
    allSvgs.forEach((svg, i) => {
      const paths = svg.querySelectorAll('path[d]');
      if (paths.length > 0) {
        console.log(`  SVG #${i}: ${paths.length} paths, parent: <${svg.parentElement?.tagName}>, classes: ${svg.parentElement?.className}`);
      }
    });
  }

  const results = [];

  charts.forEach((chart, index) => {
    const svg = chart.querySelector('svg');
    if (!svg) return;

    const title = getChartTitle(chart);
    console.log(`Analyzing chart ${index + 1}: "${title}"`);

    // Get data from paths
    const paths = svg.querySelectorAll('path[d]');
    paths.forEach((path, pi) => {
      const coords = extractCoordsFromPath(path.getAttribute('d'));
      if (coords.length < 4) return;

      // Use y-values for IQR analysis
      const yValues = coords.map(c => c.y);
      const latestY = coords[coords.length - 1].y;
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

        // Highlight the chart with a red border
        chart.style.outline = '3px solid red';
        chart.style.outlineOffset = '2px';
      }
    });

    // Also check circles
    const circles = svg.querySelectorAll('circle');
    if (circles.length >= 4) {
      const coords = extractCoordsFromCircles(circles);
      if (coords.length >= 4) {
        const yValues = coords.map(c => c.y);
        const latestY = coords[coords.length - 1].y;
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
  });

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

  // Return results (available to executeScript caller)
  return { results, totalCharts: charts.length, totalSvgs: allSvgs.length };
})();
