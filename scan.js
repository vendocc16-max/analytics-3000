/**
 * Self-contained scan function.
 * This is injected directly into the page by the popup via chrome.scripting.executeScript.
 * It finds all SVG charts, runs IQR analysis, and returns results.
 * No content script, no message passing — everything runs in one shot.
 */
(async function() {
  'use strict';

  console.log('%c🔍 Looker Extension: Scan starting...', 'background: blue; color: white; padding: 4px 8px;');

  // Read scan settings (recency filter) from storage
  const settings = await new Promise(resolve => {
    chrome.storage.local.get('scanSettings', data => {
      resolve(data.scanSettings || { maxDays: 7 });
    });
  });
  const MAX_DAYS = settings.maxDays;
  console.log(`Recency filter: ${MAX_DAYS === 0 ? 'disabled' : MAX_DAYS + ' days'}`);

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
    // 1. Get the metric/series name from the legend inside the chart
    const svg = container.querySelector('svg');
    const legendEl = container.querySelector(
      '[data-ng-type="chart-title"], .legend-label, .legend-text'
    );
    const seriesName = legendEl ? legendEl.textContent.trim() : '';

    // 2. Get the funnel/section name by walking up further in the DOM
    //    to find the large heading above the chart (e.g. "SIM-Only")
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
        // Skip if it's the same as the series name (legend inside the chart)
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

  /**
   * Checks if the chart's latest data point is within the last 7 days.
   * Looks at x-axis text labels (e.g. "Feb 2026", "Jan 2025") in the SVG
   * and parses the rightmost one. Returns false if the latest label is
   * older than 7 days, meaning the chart should be skipped.
   */
  function isChartRecent(chartContainer) {
    // If filter is disabled (0), include all charts
    if (MAX_DAYS === 0) return true;

    const svg = chartContainer.querySelector('svg');
    if (!svg) return true; // If we can't determine, don't skip

    // Collect all <text> elements — x-axis labels are typically at the bottom
    const textEls = svg.querySelectorAll('text');
    if (textEls.length === 0) return true;

    // Try to find date-like labels and pick the rightmost one (highest x position)
    const datePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i;
    const weekPattern = /^W(\d{1,2})\s+(\d{4})$/i;
    const dayPattern = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i;

    let latestDate = null;
    let latestX = -Infinity;

    textEls.forEach(t => {
      const text = t.textContent.trim();
      const x = parseFloat(t.getAttribute('x') || t.getBBox?.()?.x || 0);

      let parsed = null;

      // Try "Mon YYYY" format (e.g. "Feb 2026")
      let m = text.match(datePattern);
      if (m) {
        const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const monthIdx = monthNames.indexOf(m[1].toLowerCase());
        if (monthIdx >= 0) {
          // Use end of month as the date for that label
          parsed = new Date(parseInt(m[2]), monthIdx + 1, 0);
        }
      }

      // Try "D Mon YYYY" format
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

      // Try "W## YYYY" format (week number)
      if (!parsed) {
        m = text.match(weekPattern);
        if (m) {
          // Approximate: week number × 7 days from start of year
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
      return true; // Can't determine, don't skip
    }

    const now = new Date();
    const diffDays = (now - latestDate) / (1000 * 60 * 60 * 24);
    console.log(`  Latest x-axis date: ${latestDate.toDateString()}, ${diffDays.toFixed(0)} days ago`);

    return diffDays <= MAX_DAYS;
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

    // Skip charts whose latest data point is older than 7 days
    if (!isChartRecent(chart)) {
      console.log(`  Skipping "${title}" — latest data is older than 7 days`);
      return;
    }

    // Get data from paths
    const paths = svg.querySelectorAll('path[d]');
    paths.forEach((path, pi) => {
      const coords = extractCoordsFromPath(path.getAttribute('d'));
      if (coords.length < 4) return;

      // SVG y-axis is inverted (0 = top), so negate y-values to get real-world direction.
      // This way higher data values become higher numbers for IQR analysis.
      const yValues = coords.map(c => -c.y);

      // Latest data point = rightmost (max x), not last in path order
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
