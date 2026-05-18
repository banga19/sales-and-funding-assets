/**
 * SOK — shared design-token object.
 *
 * Extracted so every module below imports the exact same reference.
 */
export const SOK = {
  primary:       '#605BE5',
  primaryB:      '#6B6DFF',
  primaryDeep:   '#5456FF',
  neutral:       '#070707',
  surface:       '#FFFFFF',
  surfaceMuted:  '#FAFAFF',
  surfaceRaised: '#F5F5FF',
  border:        '#E5E5FF',
  borderSoft:    '#E8E8E8',
  textSec:       '#555566',
  textMuted:     '#888899',
  success:       '#10B981',
  error:         '#DC2626',
  warning:       '#F59E0B',
} as const;

// Made with Bob
