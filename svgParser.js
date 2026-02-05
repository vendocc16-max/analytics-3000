/**
 * SVG Parser Utility
 * Extracts numerical values from SVG elements within Looker Studio charts
 */

const SVGParser = {
  /**
   * Parses SVG path d attribute to extract y-coordinates
   * Handles both cubic bezier (C) and line (L) commands
   * @param {string} pathD - The SVG path d attribute
   * @returns {Array<number>} Array of y-coordinate values
   */
  extractCoordinatesFromPath(pathD) {
    const coordinates = [];
    
    // Match all coordinate pairs in the path
    // Supports M (move), L (line), C (cubic bezier)
    const regex = /([MLC])\s*([-\d.]+)\s*([-\d.]+)/g;
    let match;

    while ((match = regex.exec(pathD)) !== null) {
      const [, command, x, y] = match;
      // Extract all points, prioritizing the last point of each command
      coordinates.push({
        x: parseFloat(x),
        y: parseFloat(y),
        command: command
      });
    }

    return coordinates;
  },

  /**
   * Extracts data points from SVG circle elements (scatter/line chart markers)
   * @param {Array<Element>} circles - NodeList of circle elements
   * @returns {Array<Object>} Array of {x, y} coordinate objects
   */
  extractCoordinatesFromCircles(circles) {
    const coordinates = [];
    
    circles.forEach((circle) => {
      const cx = parseFloat(circle.getAttribute('cx'));
      const cy = parseFloat(circle.getAttribute('cy'));
      
      if (!isNaN(cx) && !isNaN(cy)) {
        coordinates.push({
          x: cx,
          y: cy,
          element: circle
        });
      }
    });

    return coordinates;
  },

  /**
   * Normalizes SVG coordinates to data space
   * SVG uses inverted y-axis; we need to convert to data values
   * @param {Array<Object>} svgCoords - Coordinates from SVG space
   * @param {Object} svgBounds - Bounding box {minX, maxX, minY, maxY} in SVG space
   * @param {Object} dataBounds - Actual data range {minValue, maxValue}
   * @returns {Array<number>} Normalized data values
   */
  normalizeCoordinates(svgCoords, svgBounds, dataBounds) {
    const { minX, maxX, minY, maxY } = svgBounds;
    const { minValue, maxValue } = dataBounds;

    return svgCoords.map((coord) => {
      // Normalize y from SVG space to 0-1
      const normalizedY = (maxY - coord.y) / (maxY - minY);
      
      // Scale to data range
      const dataValue = minValue + (normalizedY * (maxValue - minValue));
      
      return {
        x: coord.x,
        dataValue: dataValue,
        originalCoord: coord
      };
    });
  },

  /**
   * Finds the SVG element within a chart container
   * @param {Element} chartContainer - The chart widget container
   * @returns {Element|null} The SVG element or null
   */
  findSVGElement(chartContainer) {
    return chartContainer.querySelector('svg');
  },

  /**
   * Extracts all data series from a chart SVG
   * @param {Element} svg - The SVG element
   * @returns {Array<Object>} Array of series with their paths and circles
   */
  extractDataSeries(svg) {
    const series = [];
    
    // Find all path elements (line series)
    const paths = svg.querySelectorAll('path[d]');
    paths.forEach((path) => {
      const strokeColor = path.getAttribute('stroke');
      const coordinates = this.extractCoordinatesFromPath(path.getAttribute('d'));
      
      if (coordinates.length > 0) {
        series.push({
          type: 'path',
          element: path,
          stroke: strokeColor,
          coordinates: coordinates
        });
      }
    });

    // Find all circles (data point markers)
    const circles = svg.querySelectorAll('circle');
    if (circles.length > 0) {
      const coordinates = this.extractCoordinatesFromCircles(circles);
      series.push({
        type: 'circles',
        element: circles,
        coordinates: coordinates
      });
    }

    return series;
  },

  /**
   * Gets the viewBox and dimensions of an SVG
   * @param {Element} svg - The SVG element
   * @returns {Object} Bounds information
   */
  getSVGBounds(svg) {
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const [x, y, width, height] = viewBox.split(/\s+/).map(Number);
      return {
        minX: x,
        minY: y,
        maxX: x + width,
        maxY: y + height,
        width,
        height
      };
    }

    return {
      minX: 0,
      minY: 0,
      maxX: svg.clientWidth,
      maxY: svg.clientHeight,
      width: svg.clientWidth,
      height: svg.clientHeight
    };
  },

  /**
   * Extracts the latest data point from a series
   * @param {Array<Object>} coordinates - Coordinate array
   * @returns {Object|null} Latest coordinate or null
   */
  getLatestDataPoint(coordinates) {
    if (!coordinates || coordinates.length === 0) return null;
    
    // Find rightmost point (highest x value)
    return coordinates.reduce((latest, current) => {
      return (!latest || current.x > latest.x) ? current : latest;
    }, null);
  }
};
