/**
 * CantosHub theme — dark "gamer" palette with a neon accent.
 */
export const colors = {
  bg: '#0B0E14',
  card: '#141A24',
  cardAlt: '#1B2330',
  border: '#232C3B',
  text: '#E6EDF3',
  textDim: '#8B97A7',
  accent: '#00E5A0', // neon green — "boost on"
  accent2: '#3B82F6',
  danger: '#FF4D67',
  warn: '#FFB020',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
};

/** Maps Android PowerManager thermal status ints to a label + color. */
export function thermalLabel(status: number): { label: string; color: string } {
  switch (status) {
    case 0:
      return { label: 'None', color: colors.accent };
    case 1:
      return { label: 'Light', color: colors.accent };
    case 2:
      return { label: 'Moderate', color: colors.warn };
    case 3:
      return { label: 'Severe', color: colors.warn };
    case 4:
      return { label: 'Critical', color: colors.danger };
    case 5:
      return { label: 'Emergency', color: colors.danger };
    case 6:
      return { label: 'Shutdown', color: colors.danger };
    default:
      return { label: 'Unknown', color: colors.textDim };
  }
}
