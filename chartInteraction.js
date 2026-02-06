/**
 * Chart Interaction Handler
 * Manages UI interactions within Looker Studio charts
 */

const ChartInteraction = {
  /**
   * Finds all chart containers in the report
   * @returns {Array<Element>} Array of chart widget elements
   */
  findAllCharts() {
    // Looker Studio's current DOM uses ng2-canvas-component as chart containers.
    // Line/time-series charts have the class "simple-linechart".
    // We also check the legacy selector for backwards compatibility.
    const modernCharts = document.querySelectorAll('ng2-canvas-component.simple-linechart');
    const legacyCharts = document.querySelectorAll('[data-ng-type="chart"]');

    const allCharts = new Set([...modernCharts, ...legacyCharts]);

    // Filter for charts that contain rendered SVGs
    return Array.from(allCharts).filter((chart) => {
      const svg = chart.querySelector('svg');
      return svg !== null;
    });
  },

  /**
   * Waits for SVG to render within a chart container
   * Uses MutationObserver for lazy-loaded content
   * @param {Element} chartContainer - The chart widget element
   * @param {number} timeout - Maximum wait time in ms (default 5000)
   * @returns {Promise<Element>} Promise resolving to SVG element
   */
  waitForSVGRender(chartContainer, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const svg = chartContainer.querySelector('svg');
      
      if (svg && svg.querySelectorAll('path').length > 0) {
        resolve(svg);
        return;
      }

      const observer = new MutationObserver((mutations) => {
        const svg = chartContainer.querySelector('svg');
        if (svg && svg.querySelectorAll('path').length > 0) {
          observer.disconnect();
          resolve(svg);
        }
      });

      observer.observe(chartContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['d', 'cy', 'cx']
      });

      // Timeout after specified duration
      setTimeout(() => {
        observer.disconnect();
        reject(new Error('SVG render timeout'));
      }, timeout);
    });
  },

  /**
   * Hovers over chart header to reveal optional controls
   * @param {Element} chartContainer - The chart widget element
   */
  revealChartControls(chartContainer) {
    // Try multiple selectors for the chart header area
    const header = chartContainer.querySelector('.component-body') ||
                   chartContainer.querySelector('.component') ||
                   chartContainer.querySelector('[role="heading"]')?.parentElement ||
                   chartContainer;

    const event = new MouseEvent('mouseover', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    header.dispatchEvent(event);
  },

  /**
   * Clicks the optional metrics menu button
   * This button appears in the chart header on hover
   * @param {Element} chartContainer - The chart widget element
   * @returns {Promise<boolean>} Success status
   */
  async clickOptionalMetricsMenu(chartContainer) {
    return new Promise((resolve) => {
      // First, reveal the controls by hovering
      this.revealChartControls(chartContainer);

      // Wait for menu to appear
      setTimeout(() => {
        // Look for optional metrics button (usually has aria-label or title)
        const metricsButton = chartContainer.querySelector(
          '[aria-label*="Metrics"], [title*="Metrics"], .optional-metrics, [data-tooltip*="Metrics"]'
        );

        if (metricsButton) {
          metricsButton.click();
          resolve(true);
        } else {
          // Fallback: look for any button in the header area
          const buttons = chartContainer.querySelectorAll('[role="button"]');
          for (const btn of buttons) {
            if (btn.textContent.includes('Metric') || btn.className.includes('metric')) {
              btn.click();
              resolve(true);
              return;
            }
          }
          resolve(false);
        }
      }, 300);
    });
  },

  /**
   * Selects a specific metric from the metrics menu
   * @param {string} metricName - Name of the metric (e.g., "CVR")
   * @returns {Promise<boolean>} Success status
   */
  async selectMetric(metricName) {
    return new Promise((resolve) => {
      // Wait for menu to appear
      setTimeout(() => {
        // Look for menu items
        const menuItems = document.querySelectorAll('[role="menuitem"], .goog-menuitem');
        
        for (const item of menuItems) {
          if (item.textContent.includes(metricName)) {
            item.click();
            setTimeout(() => resolve(true), 500);
            return;
          }
        }
        resolve(false);
      }, 300);
    });
  },

  /**
   * Finds and clicks the drill down button
   * @param {Element} chartContainer - The chart widget element
   * @returns {Promise<boolean>} Success status
   */
  async clickDrillDownButton(chartContainer) {
    return new Promise((resolve) => {
      // Reveal controls
      this.revealChartControls(chartContainer);

      setTimeout(() => {
        // Look for drill down arrow button
        const drillButton = chartContainer.querySelector(
          '[aria-label*="Drill"], [title*="Drill"], .drill-down, [data-tooltip*="Drill"]'
        );

        if (drillButton) {
          drillButton.click();
          resolve(true);
        } else {
          // Look for arrow/down icon button in header
          const arrowButtons = chartContainer.querySelectorAll('[role="button"]');
          for (const btn of arrowButtons) {
            const ariaLabel = btn.getAttribute('aria-label') || '';
            const title = btn.getAttribute('title') || '';
            if (ariaLabel.includes('Drill') || title.includes('Drill') || 
                btn.textContent.includes('↓') || btn.textContent.includes('▼')) {
              btn.click();
              resolve(true);
              return;
            }
          }
          resolve(false);
        }
      }, 300);
    });
  },

  /**
   * Selects a granularity level from drill down menu
   * @param {string} granularity - Granularity level (e.g., "Week", "Day", "Month")
   * @returns {Promise<boolean>} Success status
   */
  async selectGranularity(granularity) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const items = document.querySelectorAll('[role="menuitem"], .goog-menuitem');
        
        for (const item of items) {
          if (item.textContent.trim() === granularity) {
            item.click();
            // Wait for chart to re-render
            setTimeout(() => resolve(true), 1000);
            return;
          }
        }
        resolve(false);
      }, 300);
    });
  },

  /**
   * Highlights a chart container with a colored border
   * @param {Element} chartContainer - The chart widget element
   * @param {string} color - Border color (e.g., "red", "#FF0000")
   * @param {number} width - Border width in pixels (default 3)
   */
  highlightChart(chartContainer, color = 'red', width = 3) {
    chartContainer.style.border = `${width}px solid ${color}`;
    chartContainer.style.boxShadow = `0 0 10px ${color}`;
    chartContainer.dataset.deviationHighlighted = 'true';
  },

  /**
   * Removes highlight from a chart
   * @param {Element} chartContainer - The chart widget element
   */
  removeHighlight(chartContainer) {
    chartContainer.style.border = '';
    chartContainer.style.boxShadow = '';
    delete chartContainer.dataset.deviationHighlighted;
  },

  /**
   * Gets the chart title or name
   * @param {Element} chartContainer - The chart widget element
   * @returns {string} Chart title
   */
  getChartTitle(chartContainer) {
    // Try modern Looker Studio selectors first
    const titleElement = chartContainer.querySelector(
      '[role="heading"], .chart-title, .component-title'
    );
    if (titleElement?.textContent?.trim()) {
      return titleElement.textContent.trim();
    }

    // Try the lego-component class which contains a unique ID (e.g., "cd-n0q4vpx9pd")
    const legoComp = chartContainer.querySelector('.lego-component') || chartContainer;
    const classList = legoComp.className || '';
    const idMatch = classList.match(/cd-\w+/);
    if (idMatch) {
      return `Chart ${idMatch[0]}`;
    }

    // Fallback: look for nearby section titles by walking up the DOM
    let parent = chartContainer.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const prev = parent.previousElementSibling;
      if (prev && prev.textContent.trim().length < 60 && prev.textContent.trim().length > 0) {
        return prev.textContent.trim();
      }
      parent = parent.parentElement;
    }

    return 'Unknown Chart';
  }
};
