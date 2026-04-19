import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DEBUG_LOG_PATH = '/opt/cursor/logs/debug.log';
const baseUrl = process.env.TARGET_URL ?? 'http://127.0.0.1:4174/?agent_slow_hand_ms=180';
const durationMs = Number(process.env.REPRO_DURATION_MS ?? '4000');

function appendDebug(line) {
  fs.appendFileSync(DEBUG_LOG_PATH, `${JSON.stringify(line)}\n`);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.startsWith('AGENT_DEBUG ')) return;
    const payload = text.slice('AGENT_DEBUG '.length);
    try {
      appendDebug(JSON.parse(payload));
    } catch (error) {
      appendDebug({
        hypothesisId: 'H5',
        location: 'web/scripts/repro-frame-reentry.mjs:console-parse',
        message: 'Failed to parse AGENT_DEBUG payload',
        data: { payload, error: String(error) },
        timestamp: Date.now(),
      });
    }
  });

  await page.addInitScript(() => {
    window.__agentDebugLog = (entry) => {
      console.log(`AGENT_DEBUG ${JSON.stringify(entry)}`);
    };
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#c');
  await page.waitForTimeout(durationMs);

  await context.close();
  await browser.close();
}

main().catch((error) => {
  const cwd = process.cwd();
  const location = path.join(cwd, 'scripts/repro-frame-reentry.mjs');
  appendDebug({
    hypothesisId: 'H5',
    location,
    message: 'repro script crashed',
    data: { error: String(error) },
    timestamp: Date.now(),
  });
  process.exitCode = 1;
});
