import { sha256 } from './text.js';

function normalizeSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .map((s) => {
      const type = String(s?.type || s?.Type || '').trim();
      const hash = String(s?.contentHash || s?.content_hash || '').trim();
      const uri = String(s?.uri || '').trim();
      const mode = String(s?.scrapeMode || s?.scrape_mode || 'page').trim() || 'page';
      return `${type}\t${hash}\t${mode}\t${uri}`;
    })
    .filter(Boolean)
    .sort();
}

/**
 * Stable fingerprint of index-relevant sources only.
 * Trusted answers are live at chat time and do not require rebuild.
 * v2 dropped keyFacts from the payload.
 */
export function computeBuildFingerprint({ sources = [] } = {}) {
  const payload = JSON.stringify({
    v: 2,
    s: normalizeSources(sources),
  });
  return sha256(payload);
}

export function botNeedsRebuild({
  lastBuiltAt,
  buildFingerprint,
  status,
  sources = [],
} = {}) {
  const hasSources = (Array.isArray(sources) ? sources : []).length > 0;
  if (!hasSources) return false;
  if (!lastBuiltAt) return true;
  if (!buildFingerprint) return status !== 'ready';
  return computeBuildFingerprint({ sources }) !== buildFingerprint;
}
