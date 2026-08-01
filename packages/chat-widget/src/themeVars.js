function parseHex(hex, fallback = '#141413') {
  const raw = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return fallback;
  return `#${raw.toLowerCase()}`;
}

/** Relative luminance 0–1 (sRGB). */
function luminance(hex) {
  const h = parseHex(hex).slice(1);
  const toLin = (c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = toLin(h.slice(0, 2));
  const g = toLin(h.slice(2, 4));
  const b = toLin(h.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Light or dark ink for text sitting on `bg`. */
export function onColor(bg, light = '#faf9f5', dark = '#141413') {
  return luminance(bg) > 0.55 ? dark : light;
}

export function themeCssVars(theme = {}) {
  const accent = parseHex(theme.accent, '#d97757');
  const textColor = parseHex(theme.textColor, '#141413');
  return {
    '--df-panel-bg': parseHex(theme.panelBg, '#faf9f5'),
    '--df-accent': accent,
    '--df-launcher-bg': parseHex(theme.launcherBg, '#ffffff'),
    '--df-text': textColor,
    '--df-user-bubble': textColor,
    '--df-user-fg': onColor(textColor),
  };
}
