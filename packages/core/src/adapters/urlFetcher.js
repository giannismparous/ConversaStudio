import * as cheerio from 'cheerio';
import { normalizeUrl } from '../domain/text.js';
import { BrowserRenderSession } from './browserRender.js';

const DEFAULT_MAX_PAGES = 40;

function sameHost(a, b) {
  try {
    return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function absolutize(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isCrawlable(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (u.pathname.match(/\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|mp3|css|js|ico|woff2?)$/i)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isSpaShell($) {
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const appRoot = $('#root, #app, #__next').first();
  const emptyAppMount =
    appRoot.length > 0 &&
    appRoot.children().length === 0 &&
    bodyText.length < 200;
  const noscriptOnly =
    /enable javascript/i.test(bodyText) && bodyText.length < 160;
  return emptyAppMount || noscriptOnly;
}

function metaFallback($) {
  const title = ($('title').first().text() || $('h1').first().text() || '').trim();
  const desc =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  const parts = [title, String(desc).trim()].filter(Boolean);
  return parts.join('\n\n').trim();
}

function parseHtmlContent(body, finalUrl) {
  const $ = cheerio.load(body);
  const title = ($('title').first().text() || $('h1').first().text() || finalUrl).trim();
  const spaShell = isSpaShell($);
  const $clean = cheerio.load(body);
  $clean('script, style, noscript, iframe, svg').remove();
  $clean('nav, footer, header').remove();
  let text = $clean('body').text().replace(/\s+/g, ' ').trim();
  const metaText = metaFallback($);
  const usedMetaOnly = !text || text.length < 40;
  if (usedMetaOnly) text = metaText;
  const needsBrowser = spaShell || (usedMetaOnly && text.length < 80);
  return { title, text, spaShell, needsBrowser, metaText };
}

export class SimpleUrlFetcher {
  /**
   * Lightweight reachability check (no browser). Used when attaching URL sources.
   * Returns { ok: true } or { ok: false, reason }.
   */
  static async probeUrl(url, { timeoutMs = 12000 } = {}) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'DialogosAIBot/0.1 (+local-dev)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return { ok: false, reason: `Unreachable (${res.status})` };
      }
      // Consume body so the socket can close cleanly; content quality is checked at build.
      try {
        await res.arrayBuffer();
      } catch {
        /* ignore */
      }
      return { ok: true };
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/aborted|timeout/i.test(msg)) {
        return { ok: false, reason: 'Timed out' };
      }
      return { ok: false, reason: 'Unreachable page' };
    }
  }

  async fetchTextStatic(url) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'DialogosAIBot/0.1 (+local-dev)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch URL (${res.status})`);
    }
    const contentType = res.headers.get('content-type') || '';
    const finalUrl = res.url || url;
    const body = await res.text();

    if (contentType.includes('text/plain')) {
      return { title: finalUrl, text: body, finalUrl, html: null, needsBrowser: false };
    }

    const parsed = parseHtmlContent(body, finalUrl);
    // Keep meta/body text even when a browser pass is still warranted —
    // so a failed render can fall back to what we already extracted.
    if (!parsed.text || parsed.text.length < 40) {
      if (parsed.needsBrowser) {
        return {
          ...parsed,
          finalUrl,
          html: body,
          needsBrowser: true,
          text: parsed.metaText || parsed.text || '',
        };
      }
      throw new Error('Could not extract enough text from URL');
    }
    return { ...parsed, finalUrl, html: body, needsBrowser: parsed.needsBrowser };
  }

  async fetchTextWithSession(url, session) {
    const rendered = await session.render(url);
    const parsed = parseHtmlContent(rendered.html, rendered.finalUrl);
    if (!parsed.text || parsed.text.length < 40) {
      throw new Error('Could not extract enough text from URL after rendering');
    }
    return {
      ...parsed,
      finalUrl: rendered.finalUrl,
      html: rendered.html,
      needsBrowser: false,
      rendered: true,
    };
  }

  async fetchText(url) {
    const staticResult = await this.fetchTextStatic(url);
    // Only render when static extraction is still too thin.
    const thin =
      !staticResult.text || String(staticResult.text).trim().length < 80;
    if (!staticResult.needsBrowser || !thin) {
      return { ...staticResult, needsBrowser: false };
    }

    const session = new BrowserRenderSession();
    try {
      return await this.fetchTextWithSession(url, session);
    } catch (err) {
      // Prefer usable meta/static text over a hard failure on SPA shells.
      if (staticResult.text && String(staticResult.text).trim().length >= 40) {
        return { ...staticResult, needsBrowser: false, renderFallback: true };
      }
      throw err;
    } finally {
      await session.close();
    }
  }

  extractLinks(baseUrl, html) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const out = new Set();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = absolutize(baseUrl, href);
      if (!abs || !isCrawlable(abs) || !sameHost(baseUrl, abs)) return;
      try {
        out.add(normalizeUrl(abs));
      } catch {
        /* skip */
      }
    });
    return [...out];
  }

  async fetchSitemapUrls(seedUrl) {
    const urls = new Set();
    let origin;
    try {
      origin = new URL(seedUrl).origin;
    } catch {
      return [];
    }
    const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    for (const sm of candidates) {
      try {
        const res = await fetch(sm, {
          headers: { 'User-Agent': 'DialogosAIBot/0.1 (+local-dev)' },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes('<loc>')) continue;
        const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
        for (const loc of locs) {
          if (!isCrawlable(loc) || !sameHost(seedUrl, loc)) continue;
          if (loc.endsWith('.xml')) {
            try {
              const nested = await fetch(loc, {
                headers: { 'User-Agent': 'DialogosAIBot/0.1 (+local-dev)' },
                signal: AbortSignal.timeout(15000),
              });
              if (!nested.ok) continue;
              const nxml = await nested.text();
              for (const m of nxml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
                const u = m[1].trim();
                if (isCrawlable(u) && sameHost(seedUrl, u) && !u.endsWith('.xml')) {
                  try {
                    urls.add(normalizeUrl(u));
                  } catch {
                    /* skip */
                  }
                }
              }
            } catch {
              /* skip nested */
            }
            continue;
          }
          try {
            urls.add(normalizeUrl(loc));
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip sitemap */
      }
    }
    return [...urls];
  }

  /**
   * Discover same-host page URLs (sitemap + link BFS). Used for page-count on attach.
   * Does not require extractable body text — only HTML for link discovery.
   * Falls back to a short browser pass for SPAs that hide nav links until hydration.
   */
  async discoverSiteUrls(seedUrl, { maxPages = DEFAULT_MAX_PAGES } = {}) {
    const seed = normalizeUrl(seedUrl);
    const found = new Set([seed]);
    const queue = [seed];
    const fetched = new Set();

    const addUrl = (raw) => {
      if (found.size >= maxPages) return;
      try {
        if (!isCrawlable(raw) || !sameHost(seed, raw)) return;
        const u = normalizeUrl(raw);
        if (!found.has(u)) {
          found.add(u);
          queue.push(u);
        }
      } catch {
        /* skip */
      }
    };

    try {
      for (const u of await this.fetchSitemapUrls(seed)) addUrl(u);
    } catch {
      /* ignore sitemap errors */
    }

    let spaLikely = false;

    while (queue.length && found.size < maxPages && fetched.size < maxPages) {
      const next = queue.shift();
      if (!next || fetched.has(next)) continue;
      fetched.add(next);

      try {
        const res = await fetch(next, {
          headers: {
            'User-Agent': 'DialogosAIBot/0.1 (+local-dev)',
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') || '';
        if (contentType && !/html|xml|text\//i.test(contentType)) continue;
        const finalUrl = normalizeUrl(res.url || next);
        found.add(finalUrl);
        const html = await res.text();
        // SPA shells / fake sitemaps: skip non-XML "sitemaps" that are just HTML apps.
        if (/sitemap/i.test(next) && !html.includes('<loc>')) continue;
        const pageLinks = this.extractLinks(finalUrl, html);
        for (const link of pageLinks) addUrl(link);
        if (finalUrl === seed || next === seed) {
          const anchorCount = (html.match(/<a\s/gi) || []).length;
          spaLikely =
            /id=["'](root|app|__next)["']/i.test(html) &&
            pageLinks.length <= 1 &&
            anchorCount < 5;
        }
      } catch {
        /* skip unreachable */
      }
    }

    // SPA / JS nav: static HTML often has no page links — hydrate once and collect hrefs.
    if (found.size <= 1 && spaLikely) {
      const browserSession = new BrowserRenderSession();
      try {
        const rendered = await Promise.race([
          browserSession.collectHrefs(seed, { timeoutMs: 16000 }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('browser discover timeout')), 17000)
          ),
        ]);
        if (rendered?.finalUrl) addUrl(rendered.finalUrl);
        for (const href of rendered?.hrefs || []) addUrl(href);
        if (rendered?.html) {
          for (const link of this.extractLinks(rendered.finalUrl || seed, rendered.html)) {
            addUrl(link);
          }
        }
      } catch {
        /* keep static discovery result */
      } finally {
        await browserSession.close();
      }
    }

    return [...found].slice(0, maxPages);
  }

  /**
   * How many same-site pages would be found for a full-website source.
   * Uses link/sitemap discovery (not sitemap-only) so counts match a real crawl better.
   */
  async countSitePages(seedUrl, { maxPages = DEFAULT_MAX_PAGES } = {}) {
    try {
      const urls = await this.discoverSiteUrls(seedUrl, { maxPages });
      if (urls.length > 0) return urls.length;
    } catch {
      /* fall through */
    }
    try {
      const pages = await this.crawlSite(seedUrl, { maxPages });
      return pages.length;
    } catch {
      return 1;
    }
  }

  /**
   * Crawl same-host pages starting from seedUrl.
   * @returns {Promise<Array<{ url: string, title: string, text: string }>>}
   */
  async crawlSite(seedUrl, { maxPages = DEFAULT_MAX_PAGES, onProgress } = {}) {
    const seed = normalizeUrl(seedUrl);
    const queue = [seed];
    const seen = new Set();
    const pages = [];
    let useBrowser = false;
    let lastError = '';
    const browserSession = new BrowserRenderSession();

    try {
      const fromSitemap = await this.fetchSitemapUrls(seed);
      for (const u of fromSitemap) {
        if (!seen.has(u)) queue.push(u);
      }

      while (queue.length && pages.length < maxPages) {
        const next = queue.shift();
        if (!next || seen.has(next)) continue;
        seen.add(next);

        try {
          if (onProgress) onProgress(pages.length + 1, maxPages, next);

          let fetched;
          if (useBrowser) {
            fetched = await this.fetchTextWithSession(next, browserSession);
          } else {
            fetched = await this.fetchTextStatic(next);
            const thin =
              !fetched.text || String(fetched.text).trim().length < 80;
            if (fetched.needsBrowser && thin) {
              useBrowser = true;
              try {
                fetched = await this.fetchTextWithSession(next, browserSession);
              } catch (renderErr) {
                if (fetched.text && String(fetched.text).trim().length >= 40) {
                  fetched = { ...fetched, needsBrowser: false };
                } else {
                  throw renderErr;
                }
              }
            }
          }

          const pageUrl = normalizeUrl(fetched.finalUrl || next);
          if (pages.some((p) => p.url === pageUrl)) continue;
          pages.push({
            url: pageUrl,
            title: fetched.title,
            text: fetched.text,
          });

          for (const link of this.extractLinks(pageUrl, fetched.html)) {
            if (!seen.has(link) && !queue.includes(link)) queue.push(link);
          }
        } catch (err) {
          lastError = err?.message || String(err);
          // skip failed pages; continue crawl
        }
      }

      // SPA with no crawlable HTML: at least index meta description so the source isn't empty
      if (!pages.length) {
        try {
          const staticSeed = await this.fetchTextStatic(seed);
          const meta = staticSeed.metaText || staticSeed.text || '';
          if (meta && meta.length >= 40) {
            pages.push({
              url: seed,
              title: staticSeed.title || seed,
              text: meta,
            });
          }
        } catch (err) {
          lastError = lastError || err?.message || String(err);
        }
      }
    } finally {
      await browserSession.close();
    }

    if (!pages.length) {
      throw new Error(
        lastError
          ? `Site scrape found no usable pages (${lastError})`
          : 'Site scrape found no usable pages'
      );
    }
    return pages;
  }
}

export async function probeUrl(url, opts) {
  return SimpleUrlFetcher.probeUrl(url, opts);
}
