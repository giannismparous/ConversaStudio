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

function launchOptions() {
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.CHROMIUM_PATH ||
    '';
  const opts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ],
  };
  if (executablePath) opts.executablePath = executablePath;
  return opts;
}

export async function getBrowser() {
  if (browserInstance) return browserInstance;
  const { chromium } = await loadPlaywright();
  try {
    browserInstance = await chromium.launch(launchOptions());
  } catch (err) {
    const hint = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? ''
      : ' If deploying on Render/Docker, set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium.';
    throw new Error(`Could not start Chromium for site scraping: ${err.message}.${hint}`);
  }
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
        userAgent: 'ConversaStudioBot/0.1 (+https://conversastudio.netlify.app)',
        locale: 'el-GR',
      });
    }

    const page = await this.#context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      });
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
          { timeout: 25000 }
        )
        .catch(() => {});
      // Give client routers a moment to hydrate text
      await new Promise((r) => setTimeout(r, 800));
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
