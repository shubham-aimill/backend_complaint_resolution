/**
 * Confidence score thresholds used across the application.
 * All displayed confidence values should be real-time (from extraction), not static.
 */

export const CONFIDENCE = {
  /** High: auto-approve / trusted */
  THRESHOLD_HIGH: 0.8,
  /** Medium: proceed with normal review */
  THRESHOLD_MEDIUM: 0.6,
  /** Low: requires manual review */
  THRESHOLD_LOW: 0,
} as const

export function isHighConfidence(c: number): boolean {
  return c >= CONFIDENCE.THRESHOLD_HIGH
}

export function isMediumConfidence(c: number): boolean {
  return c >= CONFIDENCE.THRESHOLD_MEDIUM && c < CONFIDENCE.THRESHOLD_HIGH
}

export function isLowConfidence(c: number): boolean {
  return c < CONFIDENCE.THRESHOLD_MEDIUM
}
