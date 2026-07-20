let browserInstance = null;
let playwrightModule = null;

async function loadPlaywright() {
  if (playwrightModule) return playwrightModule;
  try {
    playwrightModule = await import('playwright');
    return playwrightModule;
  } catch {
    throw new Error(
      'JavaScript page rendering requires Playwright. Run: npm install && npx playwright install chromium'
    );
  }
}

export async function getBrowser() {
  if (browserInstance) return browserInstance;
  const { chromium } = await loadPlaywright();
  browserInstance = await chromium.launch({ headless: true });
  return browserInstance;
}

export async function closeBrowser() {
  if (!browserInstance) return;
  await browserInstance.close().catch(() => {});
  browserInstance = null;
}

/**
 * Reuse one browser context per site crawl / batch.
 */
export class BrowserRenderSession {
  #context = null;

  async render(url) {
    if (!this.#context) {
      const browser = await getBrowser();
      this.#context = await browser.newContext({
        userAgent: 'ConversaStudioBot/0.1 (+local-dev)',
        locale: 'en-US',
      });
    }

    const page = await this.#context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page
        .waitForFunction(
          () => {
            const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
            if (text.length > 120) return true;
            return Boolean(
              document.querySelector(
                'main, [role="main"], article, #root > *:not(script):not(style), h1'
              )
            );
          },
          { timeout: 20000 }
        )
        .catch(() => {});
      return { html: await page.content(), finalUrl: page.url() };
    } finally {
      await page.close();
    }
  }

  async close() {
    if (!this.#context) return;
    await this.#context.close().catch(() => {});
    this.#context = null;
  }
}
