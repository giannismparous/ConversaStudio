import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import {
  chunkText,
  estimateTokens,
  sha256,
  normalizeUrl,
  computeBuildFingerprint,
} from '@dialogos-forge/core';
import {
  pool,
  vectorStore,
  objectStore,
  urlFetcher,
  getEmbedder,
} from '../config.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const running = new Set();
/** Prevent concurrent builds for the same bot (in-process). */
const buildingBots = new Set();
const SITE_CRAWL_MAX = Number(process.env.SITE_CRAWL_MAX_PAGES || 40);

/** Ephemeral UI hints for the wizard (snippets for floaters). Cleared when the job ends. */
const jobHints = new Map();

export function getJobHint(jobId) {
  return jobHints.get(jobId) || null;
}

function setJobSnippet(jobId, text) {
  if (!jobId) return;
  const snippet = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  if (!snippet) return;
  const prev = jobHints.get(jobId) || {};
  jobHints.set(jobId, { ...prev, snippet });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hold skip messages long enough for the build UI / floaters to show them. */
async function publishSkip(jobId, message, fields = {}, { holdMs = 580 } = {}) {
  const label = String(message || '')
    .replace(/^Skipped[^:]*:\s*/i, '')
    .trim()
    .slice(0, 120);
  if (label) setJobSnippet(jobId, label);
  await updateJob(jobId, { message, ...fields });
  if (holdMs > 0) await sleep(holdMs);
}

function clearJobHint(jobId) {
  if (jobId) jobHints.delete(jobId);
}

function floaterSnippet(text) {
  const raw = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw.length < 18) return '';
  if (raw.length <= 110) return raw;
  const cut = raw.lastIndexOf(' ', 110);
  return `${raw.slice(0, cut > 40 ? cut : 110).trim()}…`;
}

/** One unit per source so the bar advances evenly; sites subdivide their slice while crawling/embedding. */
function sourceWorkUnits(_source) {
  return 1;
}

/** 0–1 progress inside the current source (crawl then embed). */
function withinSourceFraction(info) {
  if (!info || typeof info !== 'object') return 0;
  if (typeof info.fraction === 'number' && Number.isFinite(info.fraction)) {
    return Math.min(1, Math.max(0, info.fraction));
  }
  const total = Number(info.total) || 0;
  const current = Number(info.current ?? info.page) || 0;
  if (total <= 0) return 0;
  if (info.phase === 'crawl') {
    // Crawl uses the first third of this source’s slice.
    return (1 / 3) * Math.min(1, current / total);
  }
  if (info.phase === 'embed' || info.page != null) {
    // Embed fills the remaining two thirds page-by-page.
    return 1 / 3 + (2 / 3) * Math.min(1, current / total);
  }
  return 0;
}

function overallProgress(completedUnits, totalUnits, withinFraction, sourceUnits) {
  if (!totalUnits) return 1;
  const units = completedUnits + Math.min(1, Math.max(0, withinFraction)) * sourceUnits;
  return Math.max(1, Math.min(97, Math.round((units / totalUnits) * 97)));
}

async function updateJob(jobId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  await pool.query(
    `UPDATE build_jobs SET ${sets.join(', ')} WHERE id = $1`,
    [jobId, ...keys.map((k) => fields[k])]
  );
}

async function updateBot(botId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  sets.push('updated_at = NOW()');
  await pool.query(
    `UPDATE bots SET ${sets.join(', ')} WHERE id = $1`,
    [botId, ...keys.map((k) => fields[k])]
  );
}

/** Remove chunks and page claims left behind when sources are deleted. */
export async function purgeOrphanedIndex(botId) {
  const { rows } = await pool.query(
    `DELETE FROM chunks
     WHERE bot_id = $1
       AND source_id NOT IN (SELECT id FROM sources WHERE bot_id = $1)
     RETURNING id`,
    [botId]
  );
  await pool.query(
    `DELETE FROM bot_pages
     WHERE bot_id = $1
       AND source_id NOT IN (SELECT id FROM sources WHERE bot_id = $1)`,
    [botId]
  );
  return rows.length;
}

async function loadFileBytes(source) {
  const key = source.uri?.replace(/^\/files\//, '') || source.uri;
  return objectStore.get(key);
}

async function loadPdfText(source) {
  const buf = await loadFileBytes(source);
  const parsed = await pdfParse(buf);
  return String(parsed.text || '').trim();
}

async function loadPlainFileText(source) {
  const buf = await loadFileBytes(source);
  return buf.toString('utf8').trim();
}

/**
 * Claim a page URL for this source, or skip if another source already owns it.
 * Atomic via INSERT … ON CONFLICT. Returns 'claimed' | 'unchanged' | 'skipped'.
 */
async function claimPage(botId, sourceId, pageUrl, contentHash, title) {
  const { rows: existing } = await pool.query(
    'SELECT source_id, content_hash FROM bot_pages WHERE bot_id = $1 AND page_url = $2',
    [botId, pageUrl]
  );
  if (existing[0] && existing[0].source_id !== sourceId) {
    return 'skipped';
  }
  if (
    existing[0] &&
    existing[0].source_id === sourceId &&
    existing[0].content_hash === contentHash
  ) {
    if (title) {
      await pool.query(
        `UPDATE bot_pages SET title = COALESCE($3, title) WHERE bot_id = $1 AND page_url = $2`,
        [botId, pageUrl, title || null]
      );
    }
    return 'unchanged';
  }

  const { rows } = await pool.query(
    `INSERT INTO bot_pages (bot_id, page_url, source_id, content_hash, title)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bot_id, page_url) DO UPDATE
       SET content_hash = EXCLUDED.content_hash,
           title = COALESCE(EXCLUDED.title, bot_pages.title)
       WHERE bot_pages.source_id = EXCLUDED.source_id
     RETURNING source_id`,
    [botId, pageUrl, sourceId, contentHash, title || null]
  );
  if (!rows[0] || rows[0].source_id !== sourceId) {
    return 'skipped';
  }
  return 'claimed';
}

async function deleteSourcePageChunks(sourceId, pageUrl) {
  if (pageUrl) {
    await pool.query(
      'DELETE FROM chunks WHERE source_id = $1 AND page_url = $2',
      [sourceId, pageUrl]
    );
  } else {
    await pool.query(
      'DELETE FROM chunks WHERE source_id = $1 AND page_url IS NULL',
      [sourceId]
    );
  }
}

async function embedPages(source, pages, embedder, onProgress) {
  let totalChunks = 0;
  let embeddedPages = 0;
  let skippedPages = 0;
  let unchangedPages = 0;
  const keptUrls = new Set();
  const hasUrlPages = pages.some((p) => p.url);

  // File/paste sources have no page URLs — full replace is simplest and correct.
  if (!hasUrlPages) {
    await vectorStore.deleteBySource(source.id);
    await pool.query('DELETE FROM bot_pages WHERE source_id = $1', [source.id]);
  }

  for (let p = 0; p < pages.length; p += 1) {
    const page = pages[p];
    const text = String(page.text || '').trim();
    if (text.length < 20) continue;

    const pageUrl = page.url || null;
    const contentHash = sha256(text);

    if (pageUrl) {
      keptUrls.add(pageUrl);
      const claim = await claimPage(
        source.bot_id,
        source.id,
        pageUrl,
        contentHash,
        page.title
      );
      if (claim === 'skipped') {
        skippedPages += 1;
        if (onProgress) {
          onProgress({
            message: `Skipped duplicate page: ${pageUrl}`,
            phase: 'embed',
            current: p + 1,
            total: pages.length,
            page: p + 1,
            snippet: pageUrl,
            skipped: true,
          });
        }
        continue;
      }
      if (claim === 'unchanged') {
        const { rows: existing } = await pool.query(
          'SELECT COUNT(*)::int AS n FROM chunks WHERE source_id = $1 AND page_url = $2',
          [source.id, pageUrl]
        );
        const n = existing[0]?.n || 0;
        if (n > 0) {
          totalChunks += n;
          unchangedPages += 1;
          if (onProgress) {
            onProgress({
              message: `Unchanged: ${page.title || pageUrl}`,
              phase: 'embed',
              current: p + 1,
              total: pages.length,
              page: p + 1,
            });
          }
          continue;
        }
        // Hash matched but chunks missing — fall through and re-embed.
      } else {
        await deleteSourcePageChunks(source.id, pageUrl);
      }
    }

    const parts = chunkText(text);
    if (!parts.length) continue;

    const label = page.title || pageUrl || source.label || 'document';
    const embeddings = [];
    // Report chunk-level progress for PDFs/files (often 1 "page", many chunks).
    const reportChunks = parts.length > 1 || pages.length === 1;
    const chunkStep = Math.max(1, Math.floor(parts.length / 14));
    let lastReportAt = 0;
    for (let i = 0; i < parts.length; i += 1) {
      const [vec] = await embedder.embedDocuments([parts[i]]);
      embeddings.push(vec);
      if (!onProgress || !reportChunks) continue;
      const isEdge = i === 0 || i === parts.length - 1;
      const isStep = i % chunkStep === 0;
      const due = Date.now() - lastReportAt > 400;
      if (!isEdge && !isStep && !due) continue;
      lastReportAt = Date.now();
      const pageBase = pages.length > 1 ? p / pages.length : 0;
      const pageSpan = pages.length > 1 ? 1 / pages.length : 1;
      onProgress({
        message: `Embedding ${label} (${i + 1}/${parts.length})`,
        phase: 'embed',
        current: i + 1,
        total: parts.length,
        page: p + 1,
        fraction: pageBase + pageSpan * ((i + 1) / parts.length),
        snippet: floaterSnippet(parts[i]),
      });
    }

    const records = parts.map((content, ordinal) => ({
      id: uuidv4(),
      botId: source.bot_id,
      sourceId: source.id,
      ordinal: totalChunks + ordinal,
      content,
      tokenEstimate: estimateTokens(content),
      contentHash: sha256(content),
      embedding: embeddings[ordinal],
      pageUrl,
    }));

    await vectorStore.upsertChunks(records);
    totalChunks += records.length;
    embeddedPages += 1;

    if (onProgress) {
      onProgress({
        message: `Embedded ${label} (${embeddedPages}/${pages.length})`,
        phase: 'embed',
        current: p + 1,
        total: pages.length,
        page: p + 1,
        fraction: (p + 1) / pages.length,
        snippet: floaterSnippet(parts[0]),
      });
    }
  }

  // Drop pages/chunks from this source that were not in the latest crawl.
  if (hasUrlPages) {
    const urlList = [...keptUrls];
    if (urlList.length) {
      await pool.query(
        `DELETE FROM chunks
         WHERE source_id = $1
           AND (page_url IS NULL OR NOT (page_url = ANY($2::text[])))`,
        [source.id, urlList]
      );
      await pool.query(
        `DELETE FROM bot_pages
         WHERE source_id = $1
           AND NOT (page_url = ANY($2::text[]))`,
        [source.id, urlList]
      );
    } else {
      await vectorStore.deleteBySource(source.id);
      await pool.query('DELETE FROM bot_pages WHERE source_id = $1', [source.id]);
    }
    // Recount after pruning.
    const { rows: recount } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM chunks WHERE source_id = $1',
      [source.id]
    );
    totalChunks = recount[0]?.n || 0;
  }

  return { totalChunks, embeddedPages, skippedPages, unchangedPages };
}

async function loadSourcePages(source, onProgress) {
  if (source.type === 'pdf') {
    if (onProgress) {
      onProgress({
        message: `Reading PDF: ${source.label}`,
        phase: 'crawl',
        fraction: 0.04,
      });
    }
    const text = await loadPdfText(source);
    if (onProgress) {
      onProgress({
        message: `Parsing ${source.label}`,
        phase: 'crawl',
        fraction: 0.12,
        snippet: floaterSnippet(text),
      });
    }
    return [{ url: null, title: source.label, text }];
  }
  if (source.type === 'txt' || source.type === 'text') {
    if (onProgress) {
      onProgress({
        message: `Reading: ${source.label}`,
        phase: 'crawl',
        fraction: 0.06,
      });
    }
    let text;
    if (source.uri && String(source.uri).startsWith('/files/')) {
      text = await loadPlainFileText(source);
    } else {
      text = String(source.uri || '').trim();
    }
    if (onProgress) {
      onProgress({
        message: `Parsing ${source.label}`,
        phase: 'crawl',
        fraction: 0.12,
        snippet: floaterSnippet(text),
      });
    }
    return [{ url: null, title: source.label, text }];
  }
  if (source.type === 'url') {
    const mode = source.scrape_mode === 'site' ? 'site' : 'page';
    if (mode === 'site') {
      const pages = await urlFetcher.crawlSite(source.uri, {
        maxPages: SITE_CRAWL_MAX,
        onProgress: (n, max, url) => {
          if (onProgress) {
            onProgress({
              message: `Crawling (${n}/${max}): ${url}`,
              phase: 'crawl',
              current: n,
              total: max,
            });
          }
        },
      });
      return pages;
    }
    const fetched = await urlFetcher.fetchText(source.uri);
    if (onProgress) {
      onProgress({
        message: `Indexing: ${source.label}`,
        phase: 'crawl',
        fraction: 0.2,
        snippet: floaterSnippet(fetched.text),
      });
    }
    return [
      {
        url: normalizeUrl(fetched.finalUrl || source.uri),
        title: fetched.title || source.label,
        text: fetched.text,
      },
    ];
  }
  throw new Error(`Unsupported source type: ${source.type}`);
}

async function processSource(source, embedder, onProgress) {
  await pool.query(
    `UPDATE sources SET status = 'indexing', error_message = 'Starting…', chunk_count = 0, page_count = 0 WHERE id = $1`,
    [source.id]
  );

  const pages = await loadSourcePages(source, onProgress);
  if (!pages.length) throw new Error('Source produced no pages');

  const totalBytes = pages.reduce(
    (sum, p) => sum + Buffer.byteLength(String(p.text || ''), 'utf8'),
    0
  );

  const result = await embedPages(source, pages, embedder, onProgress);
  if (!result.totalChunks) {
    throw new Error(
      result.skippedPages
        ? 'All pages were duplicates of content already indexed by another source'
        : 'Source produced too little text'
    );
  }

  const note =
    result.skippedPages > 0
      ? `Indexed ${result.embeddedPages} page(s) (skipped ${result.skippedPages} duplicate${result.skippedPages === 1 ? '' : 's'}${result.unchangedPages ? `, ${result.unchangedPages} unchanged` : ''}) · ${result.totalChunks} chunks`
      : result.unchangedPages > 0 && result.embeddedPages === 0
        ? `Unchanged · ${result.totalChunks} chunks`
      : result.embeddedPages > 1
        ? `Indexed ${result.embeddedPages} pages · ${result.totalChunks} chunks`
        : `${result.totalChunks} chunks`;

  const pageCount = pages.length;
  await pool.query(
    `UPDATE sources
     SET status = 'ready',
         error_message = $2,
         chunk_count = $3,
         page_count = $5,
         byte_size = CASE WHEN $4 > byte_size THEN $4 ELSE byte_size END
     WHERE id = $1`,
    [source.id, note, result.totalChunks, totalBytes, pageCount]
  );
  return result.totalChunks;
}

export async function enqueueBuild(botId, mode = 'adaptive') {
  // Reclaim builds left "running" after a process crash / deploy.
  await pool.query(
    `UPDATE build_jobs
     SET status = 'error',
         message = 'Build interrupted — start again',
         finished_at = NOW()
     WHERE bot_id = $1
       AND status IN ('queued', 'running')
       AND COALESCE(started_at, created_at) < NOW() - INTERVAL '45 minutes'`,
    [botId]
  );

  const { rows: active } = await pool.query(
    `SELECT * FROM build_jobs
     WHERE bot_id = $1 AND status IN ('queued', 'running')
     ORDER BY created_at DESC
     LIMIT 1`,
    [botId]
  );
  if (active[0]) {
    // Adaptive can attach to an in-flight job. Full rebuilds must start clean —
    // otherwise the wizard can attach to a nearly-finished skip job and flash Ready.
    if (mode !== 'full' && active[0].mode !== 'full') {
      return active[0];
    }
    await pool.query(
      `UPDATE build_jobs
       SET status = 'error',
           message = 'Superseded by a new build',
           finished_at = NOW()
       WHERE bot_id = $1 AND status IN ('queued', 'running')`,
      [botId]
    );
    buildingBots.delete(botId);
  }

  const { rows } = await pool.query(
    `INSERT INTO build_jobs (bot_id, mode, status, progress, message, started_at)
     VALUES ($1, $2, 'queued', 0, 'Queued', NULL)
     RETURNING *`,
    [botId, mode]
  );
  const job = rows[0];
  setImmediate(() => runBuild(job.id).catch(console.error));
  return job;
}

export async function runBuild(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);

  const { rows: jobRows } = await pool.query(
    'SELECT * FROM build_jobs WHERE id = $1',
    [jobId]
  );
  const job = jobRows[0];
  if (!job) {
    running.delete(jobId);
    return;
  }

  const botId = job.bot_id;
  const mode = job.mode;

  if (buildingBots.has(botId)) {
    await updateJob(jobId, {
      status: 'error',
      message: 'Another build is already running for this bot',
      finished_at: new Date(),
    });
    running.delete(jobId);
    return;
  }
  buildingBots.add(botId);

  try {
    await updateJob(jobId, {
      status: 'running',
      progress: 1,
      message: 'Starting build…',
      started_at: new Date(),
    });
    await updateBot(botId, { status: 'building', build_error: null });

    if (mode === 'full') {
      await vectorStore.deleteByBot(botId);
      await pool.query('DELETE FROM bot_pages WHERE bot_id = $1', [botId]);
      await pool.query(
        `UPDATE sources
         SET status = 'pending', error_message = NULL
         WHERE bot_id = $1 AND status <> 'skipped'`,
        [botId]
      );
    } else {
      const removed = await purgeOrphanedIndex(botId);
      if (removed > 0) {
        await updateJob(jobId, {
          message: `Removed ${removed} chunk(s) from deleted sources`,
        });
      }
    }

    // Process files/pastes before URLs so a bad scrape can't block local docs
    const { rows: sources } = await pool.query(
      `SELECT * FROM sources WHERE bot_id = $1
       ORDER BY
         CASE
           WHEN type IN ('pdf', 'txt', 'text') THEN 0
           WHEN type = 'url' AND scrape_mode = 'site' THEN 2
           ELSE 1
         END,
         created_at ASC`,
      [botId]
    );

    if (!sources.length) {
      throw new Error('Add at least one PDF or URL before building');
    }

    const embedder = getEmbedder();
    let completedUnits = 0;
    let processedSources = 0;
    const totalUnits = sources.reduce((sum, src) => sum + sourceWorkUnits(src), 0);
    const failures = [];

    for (const source of sources) {
      const units = sourceWorkUnits(source);
      const { rows: existingChunks } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM chunks WHERE source_id = $1',
        [source.id]
      );
      const hasChunks = (existingChunks[0]?.n || 0) > 0;
      const skipLabel = source.label || source.uri || 'page';

      // Invalid / unreachable URLs stay attached but never fail the build.
      if (source.status === 'skipped') {
        completedUnits += units;
        processedSources += 1;
        await publishSkip(jobId, `Skipped page: ${skipLabel}`, {
          progress: overallProgress(completedUnits, totalUnits, 0, 0),
        });
        continue;
      }

      // Site scrapes always re-run on adaptive so new pages can appear;
      // page/file sources can skip when unchanged & ready.
      const isSite = source.type === 'url' && source.scrape_mode === 'site';
      if (
        mode === 'adaptive' &&
        !isSite &&
        source.status === 'ready' &&
        hasChunks
      ) {
        completedUnits += units;
        processedSources += 1;
        await publishSkip(jobId, `Skipped unchanged: ${source.label}`, {
          progress: overallProgress(completedUnits, totalUnits, 0, 0),
        });
        continue;
      }

      await updateJob(jobId, {
        message: `Indexing: ${source.label}`,
        progress: overallProgress(completedUnits, totalUnits, 0, units),
      });

      try {
        let sourceWithin = 0;
        await processSource(source, embedder, async (info) => {
          sourceWithin = Math.max(sourceWithin, withinSourceFraction(info));
          if (info?.snippet) setJobSnippet(jobId, info.snippet);
          else if (info?.skipped && info?.message) {
            const soft = String(info.message)
              .replace(/^Skipped[^:]*:\s*/i, '')
              .trim();
            if (soft) setJobSnippet(jobId, soft);
          }
          await updateJob(jobId, {
            message: info.message || `Embedding ${source.label}`,
            progress: overallProgress(completedUnits, totalUnits, sourceWithin, units),
          });
        });
      } catch (err) {
        if (source.type === 'url') {
          // Unreachable / empty / all-duplicate pages: keep source, skip — never a build error.
          const allDup = /duplicates of content already indexed/i.test(
            String(err.message || '')
          );
          await pool.query(
            `UPDATE sources SET status = 'skipped', error_message = $2, chunk_count = 0, page_count = 0 WHERE id = $1`,
            [
              source.id,
              String(
                err.message ||
                  (allDup ? 'Duplicate of already indexed content' : 'Unreachable page')
              ).slice(0, 500),
            ]
          );
          completedUnits += units;
          processedSources += 1;
          await publishSkip(
            jobId,
            allDup ? `Skipped duplicate: ${skipLabel}` : `Skipped page: ${skipLabel}`,
            {
              progress: overallProgress(completedUnits, totalUnits, 0, 0),
            }
          );
          continue;
        }
        failures.push({ label: source.label, message: err.message });
        await pool.query(
          `UPDATE sources SET status = 'error', error_message = $2 WHERE id = $1`,
          [source.id, err.message]
        );
        await updateJob(jobId, {
          message: `Failed: ${source.label} — continuing with other sources`,
          progress: overallProgress(completedUnits + units, totalUnits, 0, 0),
        });
      }

      completedUnits += units;
      processedSources += 1;
      await updateJob(jobId, {
        progress: overallProgress(completedUnits, totalUnits, 0, 0),
        message: failures.length
          ? `Indexed ${processedSources}/${sources.length} (${failures.length} failed)`
          : `Indexed: ${source.label}`,
      });
    }

    const chunkCount = await vectorStore.countByBot(botId);
    if (!chunkCount && failures.length) {
      throw new Error(
        `Build failed for all sources. First error: ${failures[0].label}: ${failures[0].message}`
      );
    }

    // Re-read sources so fingerprint includes any newly skipped URLs.
    const { rows: fingerprintSources } = await pool.query(
      'SELECT * FROM sources WHERE bot_id = $1 ORDER BY created_at ASC',
      [botId]
    );
    const buildFingerprint = computeBuildFingerprint({
      sources: fingerprintSources,
    });

    await updateBot(botId, {
      status: chunkCount > 0 || !failures.length ? 'ready' : 'error',
      chunk_count: chunkCount,
      last_built_at: new Date(),
      build_fingerprint: buildFingerprint,
      listed: true,
      build_error: failures.length
        ? `${failures.length} source(s) failed: ${failures
            .map((f) => `${f.label} (${f.message})`)
            .join('; ')}`
        : null,
    });
    await updateJob(jobId, {
      status: chunkCount > 0 || !failures.length ? 'done' : 'error',
      progress: 100,
      message: failures.length
        ? `Done with ${chunkCount} chunks · ${failures.length} source(s) failed`
        : `Ready — ${chunkCount} chunks`,
      finished_at: new Date(),
    });
  } catch (err) {
    await updateBot(botId, {
      status: 'error',
      build_error: err.message,
    });
    await updateJob(jobId, {
      status: 'error',
      message: err.message,
      finished_at: new Date(),
    });
  } finally {
    buildingBots.delete(botId);
    running.delete(jobId);
    // Keep last snippet briefly so the wizard can still float text while finishing.
    setTimeout(() => clearJobHint(jobId), 120000);
  }
}

export { sha256 };
