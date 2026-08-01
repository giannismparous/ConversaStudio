export const DEFAULT_SOURCE_CITATIONS = {
  showSources: true,
  hideTypes: ['key_facts'],
};

export function normalizeSourceCitations(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SOURCE_CITATIONS };
  const hideTypes = Array.isArray(raw.hideTypes)
    ? raw.hideTypes.filter((t) => typeof t === 'string')
    : [];
  return {
    showSources: raw.showSources !== false,
    hideTypes,
  };
}

function isCitationTypeHidden(type, hideTypes) {
  const hide = new Set(hideTypes);
  const normalized = type === 'txt' ? 'txt' : type;
  if (hide.has(normalized)) return true;
  if ((normalized === 'pdf' || normalized === 'txt') && hide.has('file')) return true;
  return false;
}

const KNOWN_FILE_EXTS = new Set(['pdf', 'txt', 'text', 'md', 'markdown']);

export function citationFileExt(label, type) {
  const name = String(label || '').toLowerCase();
  const match = name.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  if (match) return match[1];
  if (type === 'pdf') return 'pdf';
  if (type === 'txt' || type === 'text') return 'txt';
  return '';
}

/** Match knowledge list: known types drop the extension; default files keep it. */
export function citationDisplayTitle(label, type) {
  const raw = String(label || '').trim() || 'Source';
  if (type === 'url' || type === 'key_facts') return raw;
  const ext = citationFileExt(raw, type);
  if (KNOWN_FILE_EXTS.has(ext)) {
    return raw.replace(/\.[a-z0-9]+$/i, '') || raw;
  }
  return raw;
}

export function resolveCitationUrl(uri, { publicApiUrl, objectStore } = {}) {
  const raw = String(uri || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/files/')) {
    const key = raw.slice('/files/'.length);
    if (objectStore?.publicUrl) return objectStore.publicUrl(key);
    const base = String(publicApiUrl || '').replace(/\/$/, '');
    return base ? `${base}${raw}` : raw;
  }
  return null;
}

/**
 * Build the sources list returned to the chat widget (citations UI only — RAG still uses all hits).
 */
export function buildChatSources({
  hits,
  hasKeyFacts,
  sourceCitations,
  publicApiUrl,
  objectStore,
}) {
  const settings = normalizeSourceCitations(sourceCitations);
  if (!settings.showSources) return [];

  const sources = [];
  const seen = new Set();

  if (hasKeyFacts && !isCitationTypeHidden('key_facts', settings.hideTypes)) {
    sources.push({
      title: 'Trusted answers',
      url: null,
      type: 'key_facts',
      kind: 'key_facts',
    });
  }

  for (const h of hits) {
    const type = h.sourceType || 'txt';
    if (isCitationTypeHidden(type, settings.hideTypes)) continue;
    if (h.showInCitations === false) continue;

    const key = h.uri || h.label || h.sourceId;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawLabel = h.label || 'Source';
    const normalizedType = type === 'text' ? 'txt' : type;
    const kind = normalizedType === 'url' ? 'url' : 'file';

    sources.push({
      title: citationDisplayTitle(rawLabel, normalizedType),
      url: resolveCitationUrl(h.uri, { publicApiUrl, objectStore }),
      type: normalizedType,
      kind,
      /** Original filename/label — useful when title has the extension stripped. */
      label: rawLabel,
    });
  }

  return sources;
}
