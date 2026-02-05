# SVG Targeting & Looker Studio DOM Reference

This guide covers how to target and interact with hidden UI elements in Looker Studio, particularly the "Optional Metrics" menu that only appears on hover.

---

## Table of Contents
1. [Chart Container Selectors](#chart-container-selectors)
2. [Menu Discovery Strategy](#menu-discovery-strategy)
3. [Optional Metrics Menu Targeting](#optional-metrics-menu-targeting)
4. [Drill-Down Button Targeting](#drill-down-button-targeting)
5. [SVG Element Reference](#svg-element-reference)
6. [DOM Mutation Patterns](#dom-mutation-patterns)
7. [Real-World Examples](#real-world-examples)

---

## Chart Container Selectors

### Primary Selectors (Looker Studio/Data Studio)

```javascript
// Most reliable: data-ng-type attribute
document.querySelectorAll('[data-ng-type="chart"]')

// Filter for time-series (has SVG)
Array.from(document.querySelectorAll('[data-ng-type="chart"]'))
  .filter(el => el.querySelector('svg'))

// Alternative selectors (less reliable)
document.querySelectorAll('[role="presentation"] svg')  // May catch non-charts
document.querySelectorAll('div[class*="chart"]')        // Too broad
```

### Chart Hierarchy

```html
<!-- Typical Looker Studio chart structure -->
<div class="page-container">
  <div data-ng-type="chart" class="chart-widget" data-report-element-id="xyz">
    
    <!-- Chart Header (visible) -->
    <div data-ng-type="chart-header" class="chart-header-container">
      <span class="chart-title">Daily CVR Trend</span>
      <div class="header-buttons" style="display:none;">
        <!-- Buttons hidden until parent hovered -->
        <button aria-label="Optional Metrics">⋮</button>
        <button aria-label="Drill Down">↓</button>
      </div>
    </div>

    <!-- Chart Body (SVG Content) -->
    <div class="chart-body">
      <svg viewBox="0 0 800 400">
        <g class="chart-area">
          <path d="M 50,300 L 100,280 L 150,290..." stroke="rgb(66,133,244)"/>
          <circle cx="50" cy="300" r="3" fill="rgb(66,133,244)"/>
          <!-- More circles... -->
        </g>
      </svg>
    </div>
  </div>
</div>
```

---

## Menu Discovery Strategy

### Challenge: Hidden Menu Elements

**Problem:** Looker Studio hides the metrics/drill-down buttons until you hover over the chart header.

```javascript
// ❌ This won't find the menu button - it's hidden!
document.querySelector('[aria-label="Optional Metrics"]')  // null

// ✓ This works - trigger hover event first
chartContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
setTimeout(() => {
  // Now the button exists in the DOM
  document.querySelector('[aria-label="Optional Metrics"]')?.click();
}, 300);
```

### Why 300ms Delay?

1. **Event Propagation**: `mouseover` event travels up the DOM tree (~50ms)
2. **CSS Transition**: Hidden elements transition to visible (~200ms)
3. **JavaScript Handler**: Event listener processes and updates DOM (~50ms)
4. **Safety Buffer**: Extra 50ms to ensure CSS rendering complete

**Empirical testing shows 300ms is reliable without being excessive.**

---

## Optional Metrics Menu Targeting

### Step-by-Step Menu Navigation

```javascript
/**
 * Pattern for opening and selecting from hidden menu
 */
async function selectMetricFromMenu(chartContainer, metricName) {
  // Step 1: Reveal hidden controls
  console.log("Step 1: Hover to reveal controls...");
  const header = chartContainer.querySelector('[data-ng-type="chart-header"]') 
                || chartContainer.querySelector('[role="heading"]')?.parentElement;
  
  if (header) {
    header.dispatchEvent(new MouseEvent('mouseover', {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0
    }));
  }

  // Step 2: Wait for CSS/DOM update
  console.log("Step 2: Waiting for menu to appear...");
  await new Promise(resolve => setTimeout(resolve, 300));

  // Step 3: Find the metrics button - multiple selectors for robustness
  console.log("Step 3: Locating metrics button...");
  let metricsButton = null;

  const selectors = [
    '[aria-label*="Metrics"]',
    '[aria-label*="Optional"]',
    '[title*="Metrics"]',
    '[data-tooltip*="Metrics"]',
    'button[aria-haspopup="menu"]'
  ];

  for (const selector of selectors) {
    metricsButton = chartContainer.querySelector(selector);
    if (metricsButton) {
      console.log(`Found metrics button with selector: ${selector}`);
      break;
    }
  }

  if (!metricsButton) {
    console.error("Could not find metrics button");
    return false;
  }

  // Step 4: Click to open dropdown
  console.log("Step 4: Opening metrics menu...");
  metricsButton.click();

  // Step 5: Wait for menu to appear
  await new Promise(resolve => setTimeout(resolve, 300));

  // Step 6: Find and click metric option
  console.log("Step 6: Selecting metric:", metricName);
  const menuItems = document.querySelectorAll('[role="menuitem"], .goog-menuitem, [role="option"]');
  
  for (const item of menuItems) {
    if (item.textContent.includes(metricName)) {
      console.log("Metric found, clicking...");
      item.click();
      
      // Wait for chart to re-render
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log("Metric selection complete");
      return true;
    }
  }

  console.error(`Metric '${metricName}' not found in menu`);
  return false;
}
```

### Finding Metrics Button - Multiple Selector Fallback

```javascript
function findMetricsButton(chartContainer) {
  // Primary: Aria-label attribute (most reliable)
  let btn = chartContainer.querySelector('[aria-label*="Metrics"]');
  if (btn) return { btn, selector: 'aria-label' };

  // Secondary: Title attribute
  btn = chartContainer.querySelector('[title*="Metrics"]');
  if (btn) return { btn, selector: 'title' };

  // Tertiary: Data-tooltip
  btn = chartContainer.querySelector('[data-tooltip*="Metrics"]');
  if (btn) return { btn, selector: 'data-tooltip' };

  // Fallback: Has menu popup and visible
  const candidates = chartContainer.querySelectorAll('[role="button"]');
  for (const candidate of candidates) {
    if (candidate.getAttribute('aria-haspopup') === 'menu' && 
        candidate.offsetHeight > 0) {
      return { btn: candidate, selector: 'role=button (heuristic)' };
    }
  }

  return { btn: null, selector: 'none' };
}
```

### Expected Menu Structure

```html
<!-- After clicking metrics button -->
<div role="menu" class="goog-menu">
  <div role="menuitem" class="goog-menuitem">
    <span class="goog-menuitem-content">CVR</span>
  </div>
  <div role="menuitem" class="goog-menuitem">
    <span class="goog-menuitem-content">Conversion Rate</span>
  </div>
  <div role="menuitem" class="goog-menuitem">
    <span class="goog-menuitem-content">Click Through Rate</span>
  </div>
  <!-- More metrics... -->
</div>
```

---

## Drill-Down Button Targeting

### Pattern for Drill-Down Navigation

```javascript
/**
 * Navigate drill-down menu for granularity selection
 */
async function changeDateGranularity(chartContainer, newGranularity) {
  // Step 1: Hover to reveal drill button
  chartContainer.querySelector('[data-ng-type="chart-header"]')
    ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  await new Promise(resolve => setTimeout(resolve, 300));

  // Step 2: Find drill-down button
  let drillButton = chartContainer.querySelector('[aria-label*="Drill"]') ||
                    chartContainer.querySelector('[title*="Drill"]') ||
                    chartContainer.querySelector('[aria-label*="Breakdown"]');

  if (!drillButton) {
    // Heuristic: button with down/arrow icon
    const buttons = chartContainer.querySelectorAll('[role="button"]');
    for (const btn of buttons) {
      const icon = btn.querySelector('[class*="arrow-down"], [class*="chevron"]');
      if (icon) {
        drillButton = btn;
        break;
      }
    }
  }

  if (!drillButton) {
    console.error("Drill-down button not found");
    return false;
  }

  // Step 3: Click to open granularity menu
  drillButton.click();
  await new Promise(resolve => setTimeout(resolve, 300));

  // Step 4: Find and click granularity option
  const options = [
    'Day', 'Week', 'Month', 'Quarter', 'Year',
    'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'
  ];

  const menuItems = document.querySelectorAll('[role="menuitem"]');
  for (const item of menuItems) {
    if (options.some(opt => item.textContent.includes(opt)) &&
        item.textContent.includes(newGranularity)) {
      item.click();
      await new Promise(resolve => setTimeout(resolve, 1500)); // Longer wait for chart refresh
      return true;
    }
  }

  console.error(`Granularity '${newGranularity}' not found`);
  return false;
}
```

### Drill-Down Menu Options

```
Typically available granularities:
├── Day / Daily
├── Week / Weekly
├── Month / Monthly
├── Quarter / Quarterly
├── Year / Yearly
└── (Custom periods depending on data)
```

---

## SVG Element Reference

### Looker Studio SVG Structure

```html
<svg viewBox="0 0 800 400" width="800" height="400">
  <!-- Grid/Background -->
  <g class="chart-grid">
    <line x1="0" y1="100" x2="800" y2="100" stroke="#f0f0f0"/>
    <line x1="0" y1="200" x2="800" y2="200" stroke="#f0f0f0"/>
  </g>

  <!-- Axes -->
  <g class="chart-axes">
    <line x1="50" y1="350" x2="750" y2="350" stroke="#000"/>
    <line x1="50" y1="50" x2="50" y2="350" stroke="#000"/>
  </g>

  <!-- Data Series (Line) -->
  <g class="chart-series">
    <path class="chart-line" 
          d="M 50,300 L 100,280 L 150,290 L 200,270 L 250,260 C 300,255 350,245 400,250"
          stroke="rgb(66,133,244)"
          stroke-width="2"
          fill="none"
          data-series-index="0"/>
  </g>

  <!-- Data Series (Points/Circles) -->
  <g class="chart-points">
    <circle cx="50" cy="300" r="3" fill="rgb(66,133,244)" data-index="0"/>
    <circle cx="100" cy="280" r="3" fill="rgb(66,133,244)" data-index="1"/>
    <circle cx="150" cy="290" r="3" fill="rgb(66,133,244)" data-index="2"/>
    <!-- More circles... -->
  </g>

  <!-- Legend -->
  <g class="chart-legend">
    <text x="10" y="30" font-size="12">Conversion Rate</text>
  </g>
</svg>
```

### Extracting Data from SVG Attributes

```javascript
// Method 1: Parse path d attribute
const path = svg.querySelector('path');
const d = path.getAttribute('d');
// d = "M 50,300 L 100,280 L 150,290..."

// Method 2: Extract from circles
const circles = svg.querySelectorAll('circle');
circles.forEach(circle => {
  const cx = parseFloat(circle.getAttribute('cx'));
  const cy = parseFloat(circle.getAttribute('cy'));
  console.log(`Point at (${cx}, ${cy})`);
});

// Method 3: Get viewBox bounds
const viewBox = svg.getAttribute('viewBox');
// "0 0 800 400" → {minX: 0, minY: 0, maxX: 800, maxY: 400}
```

---

## DOM Mutation Patterns

### Listening for Chart Updates

```javascript
/**
 * Watch for chart re-renders after actions
 */
function watchChartForMutations(svgElement, callback) {
  const observer = new MutationObserver((mutations) => {
    const hadRelevantChange = mutations.some(m => {
      // Check if path data changed
      if (m.type === 'attributes' && m.attributeName === 'd') return true;
      // Check if new paths added
      if (m.type === 'childList' && m.addedNodes.length > 0) return true;
      // Check if circles updated
      if (m.target.tagName === 'circle') return true;
      return false;
    });

    if (hadRelevantChange) {
      console.log('Chart data updated, re-analyzing...');
      callback();
    }
  });

  observer.observe(svgElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['d', 'cx', 'cy', 'data-index']
  });

  return observer;
}

// Usage
const observer = watchChartForMutations(svg, () => {
  const newSeries = SVGParser.extractDataSeries(svg);
  console.log('Updated series:', newSeries);
});
```

### Detecting Menu Appearance

```javascript
function waitForMenuAppearance(timeout = 500) {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const menu = document.querySelector('[role="menu"]');
      if (menu && menu.offsetHeight > 0) {
        observer.disconnect();
        resolve(menu);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}
```

---

## Real-World Examples

### Example 1: Full Metric Selection Flow

```javascript
async function automateMetricSelection() {
  try {
    const chart = ChartInteraction.findAllCharts()[0];
    console.log("Chart found:", ChartInteraction.getChartTitle(chart));

    // Hover over header
    chart.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));

    // Click metrics button
    const metricsBtn = chart.querySelector('[aria-label*="Metrics"]');
    if (!metricsBtn) throw new Error("Metrics button not found");
    
    metricsBtn.click();
    await new Promise(r => setTimeout(r, 300));

    // Select CVR
    const items = document.querySelectorAll('[role="menuitem"]');
    const cvrItem = Array.from(items).find(i => i.textContent.includes('CVR'));
    
    if (!cvrItem) throw new Error("CVR option not found");
    cvrItem.click();

    // Wait for chart to update
    await new Promise(r => setTimeout(r, 1000));
    
    console.log("✓ Metric selection complete");
    return true;

  } catch (error) {
    console.error("✗ Automation failed:", error.message);
    return false;
  }
}
```

### Example 2: Detect Drill-Down Availability

```javascript
function checkDrillDownCapability(chart) {
  const header = chart.querySelector('[data-ng-type="chart-header"]');
  
  if (!header) return { available: false, reason: 'No header found' };

  // Trigger hover to reveal buttons
  header.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  const drillBtn = header.querySelector('[aria-label*="Drill"]') ||
                   header.querySelector('[title*="Drill"]');

  if (!drillBtn) {
    return { available: false, reason: 'No drill button found' };
  }

  if (drillBtn.disabled) {
    return { available: false, reason: 'Drill button is disabled' };
  }

  return { available: true, button: drillBtn };
}

// Usage
const capability = checkDrillDownCapability(chart);
if (capability.available) {
  console.log("Drill-down is available");
} else {
  console.log("Not available:", capability.reason);
}
```

### Example 3: Safe Menu Interaction with Retry

```javascript
async function safeMenuInteraction(chartContainer, metric, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries}: Selecting ${metric}`);

      // Reveal
      chartContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));

      // Find button with multiple fallbacks
      const btn = chartContainer.querySelector('[aria-label*="Metrics"]') ||
                  chartContainer.querySelector('[title*="Metrics"]') ||
                  chartContainer.querySelector('button[aria-haspopup="menu"]');

      if (!btn) throw new Error("Button not found");

      // Click
      btn.click();
      await new Promise(r => setTimeout(r, 500));

      // Select
      const items = document.querySelectorAll('[role="menuitem"]');
      const item = Array.from(items).find(i => 
        i.textContent.toLowerCase().includes(metric.toLowerCase())
      );

      if (!item) throw new Error(`Option '${metric}' not found`);

      item.click();
      await new Promise(r => setTimeout(r, 1500));

      console.log(`✓ Success on attempt ${attempt}`);
      return true;

    } catch (error) {
      console.log(`✗ Attempt ${attempt} failed:`, error.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000)); // Backoff
      }
    }
  }

  console.error("All retry attempts failed");
  return false;
}
```

---

## Debugging: Inspector Commands

```javascript
// In browser console on Looker Studio report page:

// 1. Find all charts
const charts = document.querySelectorAll('[data-ng-type="chart"]');
console.log(`Found ${charts.length} charts`);

// 2. Get first chart info
const chart = charts[0];
console.log("Chart:", chart);
console.log("Title:", chart.querySelector('[role="heading"]')?.textContent);
console.log("Has SVG:", chart.querySelector('svg') ? 'Yes' : 'No');

// 3. Check header buttons (before hover)
console.log("Header buttons (hidden):", 
  chart.querySelectorAll('.header-buttons [role="button"]'));

// 4. Simulate hover
chart.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
setTimeout(() => {
  console.log("Header buttons (after hover):", 
    chart.querySelectorAll('.header-buttons [role="button"]'));
}, 300);

// 5. List all menus on page
console.log("Visible menus:", document.querySelectorAll('[role="menu"]'));

// 6. Check SVG data
const svg = chart.querySelector('svg');
console.log("SVG paths:", svg.querySelectorAll('path').length);
console.log("SVG circles:", svg.querySelectorAll('circle').length);
```

---

## Browser DevTools Tips

### Monitor DOM Changes in Real-Time

```javascript
// Open DevTools > Console, then:

// Break on when specific element appears
document.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(mutations => {
    if (document.querySelector('[role="menu"]')) {
      console.log('Menu appeared!');
      debugger; // Pauses execution
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
```

### Find Element by Text

```javascript
// In DevTools Console:
Array.from(document.querySelectorAll('*'))
  .find(el => el.textContent.includes('CVR') && el.textContent.length < 50)
```

---

**Document Version:** 1.0  
**Last Updated:** February 5, 2026
