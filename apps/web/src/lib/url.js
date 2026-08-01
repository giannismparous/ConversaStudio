/** Prepend https:// when the user typed a bare domain/path (same rule as API normalizeUrl). */
export function ensureHttpsUrl(url) {
  let raw = String(url || '').trim();
  if (!raw) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    raw = `https://${raw}`;
  }
  return raw;
}
