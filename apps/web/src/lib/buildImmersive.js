/** Shared build-progress message formatting (wizard + editor). */

import { greekBuildNameVars } from './testUiLocalize.js';

export function shortenBuildLabel(label) {
  const s = String(label || '').trim();
  if (!s) return '';
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const clipped = path.length > 28 ? `${path.slice(0, 28)}…` : path;
    return `${host}${clipped}`;
  } catch {
    return s.length > 42 ? `${s.slice(0, 40)}…` : s;
  }
}

export function formatBuildMessage(message, botName, t, personaGender = 'neutral') {
  const msg = String(message || '').trim();
  const nameVars = greekBuildNameVars(botName, personaGender);
  if (!msg || /^Starting/i.test(msg)) return t('wizard.buildLogStarting', nameVars);
  let m;
  if ((m = msg.match(/^Indexing:\s*(.+)$/i))) {
    return t('wizard.buildLogIndexing', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Reading PDF:\s*(.+)$/i))) {
    return t('wizard.buildLogReadingPdf', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Reading:\s*(.+)$/i))) {
    return t('wizard.buildLogReadingFile', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Parsing\s+(.+)$/i))) {
    return t('wizard.buildLogParsing', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Embedding\s+(.+?)\s*\((\d+)\/(\d+)\)/i))) {
    return t('wizard.buildLogEmbedding', {
      label: shortenBuildLabel(m[1]),
      current: m[2],
      total: m[3],
    });
  }
  if ((m = msg.match(/^Embedded\s+(.+?)\s*\((\d+)\/(\d+)\)/i))) {
    return t('wizard.buildLogEmbedded', {
      label: shortenBuildLabel(m[1]),
      current: m[2],
      total: m[3],
    });
  }
  if ((m = msg.match(/^Crawling\s*\((\d+)\/(\d+)\):\s*(.+)$/i))) {
    return t('wizard.buildLogCrawling', {
      current: m[1],
      total: m[2],
      label: shortenBuildLabel(m[3]),
    });
  }
  if ((m = msg.match(/^Skipped unchanged:\s*(.+)$/i))) {
    return t('wizard.buildLogSkipped', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Skipped duplicate:\s*(.+)$/i))) {
    return t('wizard.buildLogDuplicateSource', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Skipped page:\s*(.+)$/i))) {
    return t('wizard.buildLogSkippedPage', { label: shortenBuildLabel(m[1]) });
  }
  if ((m = msg.match(/^Skipped duplicate page:\s*(.+)$/i))) {
    return t('wizard.buildLogDuplicate', { label: shortenBuildLabel(m[1]) });
  }
  // Legacy (no colon) — keep matching older jobs mid-flight
  if ((m = msg.match(/^Skipped duplicate page\s+(.+)$/i))) {
    return t('wizard.buildLogDuplicate', { label: shortenBuildLabel(m[1]) });
  }
  if (/^Failed:/i.test(msg)) {
    return t('wizard.buildLogFailed', { detail: msg.replace(/^Failed:\s*/i, '') });
  }
  if (/Removed .+ chunk/i.test(msg)) return t('wizard.buildLogCleanup');
  if (/^Ready|^Done/i.test(msg)) return t('wizard.buildLogReady', nameVars);
  return msg;
}

const MAX_BUILD_LOG = 5;

export function pushBuildLogEntry(prev, entry) {
  const sealed = (prev || []).map((item) =>
    item.status === 'active' ? { ...item, status: 'done' } : item
  );
  return [...sealed, entry].slice(-MAX_BUILD_LOG);
}

export function splitIntoChunkLines(text, maxLen = 96) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];
  const parts = raw
    .split(/(?<=[.!?…;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  const out = [];
  for (const part of parts) {
    if (part.length <= maxLen) {
      out.push(part);
      continue;
    }
    let rest = part;
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(' ', maxLen);
      if (cut < 32) cut = maxLen;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest.length >= 12) out.push(rest);
  }
  return out.slice(0, 40);
}

export function setBuildImmersive(on, { editor = false } = {}) {
  const root = document.documentElement;
  if (on) {
    root.classList.add('wizard-build-immersive');
    root.classList.remove('wizard-build-immersive-exit');
    root.classList.toggle('editor-build-immersive', Boolean(editor));
    return;
  }
  root.classList.remove('wizard-build-immersive');
  root.classList.remove('wizard-build-immersive-exit');
  root.classList.remove('editor-build-immersive');
}

export function setBuildImmersiveExit(on) {
  document.documentElement.classList.toggle('wizard-build-immersive-exit', Boolean(on));
}

export const BUILD_IMMERSIVE_EXIT_MS = 2800;
export const BUILD_MIN_VISIBLE_FULL_MS = 4200;
export const BUILD_MIN_VISIBLE_ADAPTIVE_MS = 1800;
export const MAX_BUILD_FLOATERS = 8;
export const MAX_BUILD_FLOATERS_ADAPTIVE = 5;

/** Spread across the middle of the screen (not clustered on one edge). */
const CENTER_SCATTER_SLOTS = [
  { left: 18, top: 20 },
  { left: 48, top: 16 },
  { left: 72, top: 22 },
  { left: 14, top: 44 },
  { left: 78, top: 42 },
  { left: 22, top: 68 },
  { left: 50, top: 72 },
  { left: 74, top: 66 },
];

function clampPct(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** Next scatter slot with light jitter so repeats don’t stack exactly. */
export function scatterFloaterPosition(band, recent = []) {
  const slots = CENTER_SCATTER_SLOTS;
  const preferred = Math.abs(band) % slots.length;
  // Prefer an unused slot when several floaters are already up.
  const used = new Set(
    (Array.isArray(recent) ? recent : [])
      .map((p) => {
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < slots.length; i += 1) {
          const d =
            Math.abs(slots[i].left - Number(p.left || 0)) +
            Math.abs(slots[i].top - Number(p.top || 0));
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        return bestDist < 14 ? best : -1;
      })
      .filter((i) => i >= 0)
  );
  let slotIdx = preferred;
  for (let i = 0; i < slots.length; i += 1) {
    const idx = (preferred + i) % slots.length;
    if (!used.has(idx)) {
      slotIdx = idx;
      break;
    }
  }
  const base = slots[slotIdx];
  return {
    left: clampPct(base.left + (Math.random() - 0.5) * 8, 8, 82),
    top: clampPct(base.top + (Math.random() - 0.5) * 8, 10, 82),
  };
}

/** @deprecated use scatterFloaterPosition */
export function edgeFloaterPosition(band) {
  return scatterFloaterPosition(band);
}

/** Bias toward newest pool lines (latest source / snippet). */
export function pickLatestFloaterLine(pool, lastLine = '') {
  const list = (Array.isArray(pool) ? pool : [])
    .map((l) => String(l || '').replace(/\s+/g, ' ').trim().slice(0, 96))
    .filter((l) => l.length >= 8);
  if (!list.length) return '';
  const fresh = list.slice(0, Math.min(6, list.length));
  const pickFrom = Math.random() < 0.78 || fresh.length === list.length ? fresh : list;
  let line = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  if (line === lastLine && list.length > 1) {
    const alt = list.find((l) => l !== lastLine) || line;
    line = alt;
  }
  return line;
}

/** One-way outward drift + slow single-arc spin for build floaters. */
export function makeFloaterMotion(pos, { adaptive = false } = {}) {
  const roll = Math.random();
  let size;
  let life;
  let travel;
  // Wider random lifetimes so floaters fade on staggered clocks (old can finish while new appear).
  if (roll < 0.4) {
    size = 0.78 + Math.random() * 0.14;
    life = (adaptive ? 2800 : 3200) + Math.random() * 2800;
    travel = 88 + Math.random() * 100;
  } else if (roll < 0.75) {
    size = 0.9 + Math.random() * 0.14;
    life = (adaptive ? 3600 : 4200) + Math.random() * 3600;
    travel = 72 + Math.random() * 88;
  } else {
    size = 1.05 + Math.random() * 0.16;
    life = (adaptive ? 4800 : 5600) + Math.random() * 4200;
    travel = 58 + Math.random() * 72;
  }

  // Always drift outward from center — never reverse mid-flight.
  const vx = Number(pos?.left ?? 50) - 50;
  const vy = Number(pos?.top ?? 50) - 50;
  const len = Math.hypot(vx, vy) || 1;
  const dx = (vx / len) * travel;
  const dy = (vy / len) * travel * 0.85;

  const spinDir = Math.random() < 0.5 ? 1 : -1;
  const rot = -24 + Math.random() * 48;
  const spinEnd = rot + spinDir * (16 + Math.random() * 20);

  return {
    dx,
    dy,
    rot,
    spinEnd,
    dur: life / 1000,
    spin: life / 1000,
    size,
    life,
  };
}
