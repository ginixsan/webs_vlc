import { setTimeout as delay } from 'node:timers/promises';

const LOAD_WAIT_MS = 10000;
const SETTLE_ATTEMPTS = 3;
const RELOAD_WAIT_MS = 15000;
const RELOAD_SETTLE_MS = 3000;
const RELOAD_ERRORS = /Execution context was destroyed|navigation|Cannot find context|Frame was detached/i;

function ignoreTimeout(error) {
  if (error.name !== 'TimeoutError') throw error;
}

/** Opens a homepage and waits for it to render. Throws on HTTP errors; returns the response. */
export async function loadHomepage(page, url, { timeout, waitMs }) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  if (response && response.status() >= 400) {
    throw new Error(`HTTP ${response.status()} at ${page.url()}`);
  }
  // Some municipal sites never finish all background requests. Give load
  // a bounded opportunity, then allow a small rendering delay.
  await page.waitForLoadState('load', { timeout: Math.min(timeout, LOAD_WAIT_MS) }).catch(ignoreTimeout);
  await delay(waitMs);
  return response;
}

/**
 * page.evaluate that survives pages reloading themselves. Anti-bot pages show a challenge and then
 * reload: wait for the real page and retry. Throws if isBlocked(snapshot) stays true.
 */
export async function evaluateSettled(page, fn, arg, { isBlocked, settleMs = RELOAD_SETTLE_MS }) {
  const settle = async () => {
    await delay(settleMs);
    await page.waitForLoadState('load', { timeout: RELOAD_WAIT_MS }).catch(ignoreTimeout);
  };
  for (let attempt = 1; ; attempt += 1) {
    let snapshot;
    try {
      snapshot = await page.evaluate(fn, arg);
    } catch (error) {
      if (!RELOAD_ERRORS.test(error.message) || attempt >= SETTLE_ATTEMPTS) throw error;
      await settle();
      continue;
    }
    if (!isBlocked(snapshot)) return snapshot;
    if (attempt >= SETTLE_ATTEMPTS) throw new Error(`Anti-bot page still shown: "${snapshot.title}"`);
    await settle();
  }
}
