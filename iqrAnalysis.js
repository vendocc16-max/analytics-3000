/**
 * IQR (Interquartile Range) Analysis
 * Performs statistical deviation detection on chart data
 */

const IQRAnalysis = {
  /**
   * Calculates quartiles for a dataset
   * @param {Array<number>} data - Array of numerical values
   * @returns {Object} {q1, q2 (median), q3, min, max}
   */
  calculateQuartiles(data) {
    if (!data || data.length === 0) return null;

    const sorted = [...data].sort((a, b) => a - b);
    const length = sorted.length;

    const q1Index = Math.floor(length * 0.25);
    const q2Index = Math.floor(length * 0.5);
    const q3Index = Math.floor(length * 0.75);

    return {
      min: sorted[0],
      q1: sorted[q1Index],
      q2: sorted[q2Index], // Median
      q3: sorted[q3Index],
      max: sorted[length - 1],
      iqr: sorted[q3Index] - sorted[q1Index],
      lowerBound: sorted[q1Index] - 1.5 * (sorted[q3Index] - sorted[q1Index]),
      upperBound: sorted[q3Index] + 1.5 * (sorted[q3Index] - sorted[q1Index])
    };
  },

  /**
   * Detects if a value is an outlier using IQR method
   * @param {number} value - The value to test
   * @param {Object} quartiles - Quartile information from calculateQuartiles()
   * @returns {Object} {isOutlier: boolean, deviationType: string, severity: number}
   */
  detectOutlier(value, quartiles) {
    if (!quartiles) {
      return { isOutlier: false, deviationType: 'none', severity: 0 };
    }

    const { q1, q3, iqr, lowerBound, upperBound, q2 } = quartiles;

    if (value < lowerBound || value > upperBound) {
      // Calculate severity (z-score-like metric)
      const distanceFromMedian = Math.abs(value - q2);
      const severity = Math.min(distanceFromMedian / (iqr / 2), 10); // Cap at 10

      if (value > upperBound) {
        return {
          isOutlier: true,
          deviationType: 'positive',
          severity: severity,
          value: value,
          upperBound: upperBound,
          deviation: value - upperBound
        };
      } else {
        return {
          isOutlier: true,
          deviationType: 'negative',
          severity: severity,
          value: value,
          lowerBound: lowerBound,
          deviation: lowerBound - value
        };
      }
    }

    return {
      isOutlier: false,
      deviationType: 'none',
      severity: 0,
      value: value,
      q1: q1,
      q3: q3
    };
  },

  /**
   * Analyzes a complete dataset and returns deviation info
   * @param {Array<number>} dataPoints - All data points in the series
   * @param {number} latestValue - The most recent data point
   * @returns {Object} Complete analysis result
   */
  analyzeDeviation(dataPoints, latestValue) {
    const quartiles = this.calculateQuartiles(dataPoints);
    const outlierResult = this.detectOutlier(latestValue, quartiles);

    return {
      quartiles,
      outlierResult,
      timestamp: new Date().toISOString(),
      dataPointCount: dataPoints.length,
      statistics: {
        mean: this.calculateMean(dataPoints),
        stdDev: this.calculateStandardDeviation(dataPoints),
        median: quartiles.q2
      }
    };
  },

  /**
   * Calculates mean of a dataset
   * @param {Array<number>} data - Array of numbers
   * @returns {number} Mean value
   */
  calculateMean(data) {
    if (!data || data.length === 0) return 0;
    return data.reduce((a, b) => a + b, 0) / data.length;
  },

  /**
   * Calculates standard deviation
   * @param {Array<number>} data - Array of numbers
   * @returns {number} Standard deviation
   */
  calculateStandardDeviation(data) {
    if (!data || data.length < 2) return 0;
    
    const mean = this.calculateMean(data);
    const squaredDiffs = data.map(x => Math.pow(x - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / data.length;
    
    return Math.sqrt(variance);
  },

  /**
   * Formats analysis result for display
   * @param {Object} analysis - Analysis result from analyzeDeviation()
   * @returns {string} Formatted report
   */
  formatAnalysisReport(analysis) {
    const { quartiles, outlierResult, statistics } = analysis;

    if (!outlierResult.isOutlier) {
      return `✓ Within normal range (Q1: ${quartiles.q1.toFixed(2)}, Q3: ${quartiles.q3.toFixed(2)})`;
    }

    const type = outlierResult.deviationType === 'positive' ? '↑ SPIKE' : '↓ DIP';
    const bound = outlierResult.deviationType === 'positive'
      ? `Upper: ${outlierResult.upperBound.toFixed(2)}`
      : `Lower: ${outlierResult.lowerBound.toFixed(2)}`;
    
    return `${type} | Value: ${outlierResult.value.toFixed(2)} | ${bound} | Severity: ${outlierResult.severity.toFixed(1)}/10`;
  }
};
