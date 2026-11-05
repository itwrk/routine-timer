// NODE_PATH=<playwright install>/node_modules node tests/lifelog-calendar-browser.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '..', 'index.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.RVT_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
      headless: true
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 380, height: 820 }, timezoneId: 'Asia/Tokyo' });
    const start = new Date('2026-11-04T23:30:00+09:00').getTime();
    const end = new Date('2026-11-05T07:30:00+09:00').getTime();
    await context.addInitScript(({ start }) => {
      const NativeDate = Date;
      window.testNow = Number(localStorage.getItem('synthetic-time')) || start;
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [window.testNow])); }
        static now() { return window.testNow; }
      };
      if (!localStorage.getItem('rvt_v1')) localStorage.setItem('rvt_v1', JSON.stringify({
        schemaVersion: 17,
        routines: [{ id: 'synthetic-routine', name: '朝の準備', emoji: '🌅', steps: [
          { id: 'synthetic-step', name: '水を飲む', emoji: '💧', sec: 60, texts: [] }
        ] }],
        settings: { autoSync: false, syncUrl: 'https://sync.invalid', syncKey: 'synthetic-key', calLog: 'off', sound: false, moti: false }
      }));
    }, { start });
    const writes = [], errors = [];
    let failCalendar = false, heldWrite = null, releaseWrite;
    await context.route('**/*', async route => {
      const req = route.request();
      if (req.url().startsWith(origin)) return route.continue();
      if (!req.url().startsWith('https://sync.invalid')) return route.abort();
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        if (body.action === 'addEvent') {
          writes.push(body);
          if (heldWrite) await heldWrite;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: !failCalendar }) });
        }
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, events: [], data: null }) });
    });
    const page = await context.newPage(), stale = await context.newPage();
    for (const tab of [page, stale]) tab.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await stale.goto(origin);
    assert.equal(await page.evaluate(() => D.settings.calLog), 'auto', 'enable automatic calendar logging once during upgrade');
    await page.locator('#homeLifeLogButton').click();
    await page.locator('#quickTimerLabel').fill('睡眠');
    await page.locator('#lifeLogStart').click();
    const activeId = await page.evaluate(() => D.activeStopwatch.id);
    await stale.waitForFunction(id => D.activeStopwatch?.id === id, activeId);

    // Reproduce a suspended, older tab saving its pre-start application snapshot.
    await stale.evaluate(() => { D.activeStopwatch = null; save(); });
    await page.reload();
    await page.locator('#homeLifeLogButton').click();
    assert.equal(await page.evaluate(() => D.activeStopwatch.id), activeId);
    assert.equal(await page.locator('#quickTimerLabel').inputValue(), '睡眠');
    assert.equal(await page.evaluate(() => D.activeStopwatch.startedAt), start);

    // Resume after an overnight suspension without waiting for the next interval tick.
    for (const event of ['pageshow', 'focus', 'visibilitychange']) {
      await page.evaluate(({ end, event }) => {
        window.testNow = end; localStorage.setItem('synthetic-time', String(end));
        stopQuickTimerTicker(); document.getElementById('quickTimerClock').textContent = '00:00';
        (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
      }, { end, event });
      assert.equal(await page.locator('#quickTimerClock').textContent(), '8:00:00', event);
    }
    await page.reload();
    await page.locator('#homeLifeLogButton').click();
    assert.equal(await page.locator('#quickTimerClock').textContent(), '8:00:00');
    assert.equal(await page.evaluate(() => {
      const original = D.activeStopwatch.id, remote = JSON.parse(JSON.stringify(D));
      remote.updatedAt += 10000; delete remote.activeStopwatch;
      applySyncPullData(remote, true);
      return D.activeStopwatch.id === original && !Object.hasOwn(syncDataForCloud(), 'activeStopwatch');
    }), true, 'cloud pulls preserve the local timer');

    // Exactly one cross-midnight event, including repeated stop/send while in flight.
    heldWrite = new Promise(resolve => { releaseWrite = resolve; });
    await page.locator('#lifeLogEnd').click();
    await page.waitForFunction(() => D.stopwatchLogs.length === 1);
    await page.evaluate(() => { finishLifeLog(); logRecordToCalendar(D.stopwatchLogs[0], 'lifelog'); });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(writes.length, 1);
    releaseWrite(); heldWrite = null;
    await page.waitForFunction(() => !!D.stopwatchLogs[0].calendarRecordedAt);
    let log = await page.evaluate(() => D.stopwatchLogs[0]);
    assert.equal(log.durationSec, 8 * 60 * 60);
    assert.equal(writes[0].title, '⏱️ 睡眠');
    assert.deepEqual([writes[0].start, writes[0].end], [start, end]);
    assert.equal(await page.evaluate(() => D.activeStopwatch), null);
    await stale.evaluate(() => finishLifeLog());
    await page.reload();
    await page.evaluate(() => logRecordToCalendar(D.stopwatchLogs[0], 'lifelog'));
    assert.equal(writes.length, 1, 'a recorded event is not sent again after reload');
    assert.equal(await page.evaluate(() => D.activeStopwatch), null, 'a stopped timer stays stopped');
    await page.evaluate(() => {
      const completed = D.stopwatchLogs[0];
      localStorage.setItem(ACTIVE_STOPWATCH_KEY, JSON.stringify({ id: completed.id, startedAt: completed.startedAt, label: completed.label }));
    });
    await page.reload();
    assert.equal(await page.evaluate(() => D.activeStopwatch), null, 'a crash between the two storage writes cannot resurrect a completed timer');
    assert.equal(await page.evaluate(() => D.stopwatchLogs.length), 1);

    // A completed routine and a saved partial routine each use their real time range.
    await page.evaluate(() => {
      startRun('synthetic-routine'); window.testNow += 61000; finishAll();
    });
    await page.waitForFunction(() => !!D.routineRunLogs[0].calendarRecordedAt);
    assert.equal(writes.length, 2);
    assert.match(writes[1].title, /朝の準備（1\/1）/);
    assert.equal(writes[1].end - writes[1].start, 61000);
    await page.evaluate(() => { closeResult(); startRun('synthetic-routine'); window.testNow += 15000; saveAndEndRun(); });
    await page.waitForFunction(() => !!D.routineRunLogs[0].calendarRecordedAt);
    assert.equal(writes.length, 3);
    assert.match(writes[2].title, /途中保存/);
    assert.equal(writes[2].end - writes[2].start, 15000);

    // Off/ask settings still work, including small-screen confirmation buttons.
    await page.evaluate(() => { D.settings.calLog = 'off'; save(); });
    await page.reload();
    assert.equal(await page.evaluate(() => D.settings.calLog), 'off', 'an explicit preference survives later normalization');
    await page.evaluate(() => { startLifeLog(); finishLifeLog(); });
    assert.equal(writes.length, 3);
    await page.evaluate(() => { D.settings.calLog = 'ask'; startLifeLog(); finishLifeLog(); });
    const ask = page.getByRole('button', { name: '記録する', exact: true });
    await ask.waitFor();
    assert.equal(writes.length, 3);
    for (const width of [320, 380]) {
      await page.setViewportSize({ width, height: 820 });
      assert.equal(await ask.evaluate(button => getComputedStyle(button).whiteSpace === 'nowrap' && button.scrollWidth <= button.clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await ask.click();
    await page.waitForFunction(() => !!D.stopwatchLogs[0].calendarRecordedAt);
    assert.equal(writes.length, 4);
    assert(writes[3].end > writes[3].start, 'zero-second records produce a valid nonempty event');

    // API failure and missing setup retain the saved log and report the problem.
    failCalendar = true;
    await page.evaluate(() => { D.settings.calLog = 'auto'; startLifeLog(); finishLifeLog(); });
    await page.waitForFunction(() => document.getElementById('calLogStatus').textContent.includes('反映に失敗'));
    assert.equal(writes.length, 5);
    assert.equal(await page.evaluate(() => !!D.stopwatchLogs[0].calendarRecordedAt), false);
    assert.equal(await page.evaluate(() => D.stopwatchLogs[0].source), 'lifelog');
    await page.evaluate(() => { D.settings.syncKey = ''; startLifeLog(); finishLifeLog(); });
    assert.equal(writes.length, 5);
    assert.match(await page.locator('#calLogStatus').textContent(), /同期URLと合言葉/);
    assert.equal(await page.evaluate(() => D.activeStopwatch), null);

    await stale.close();
    // Reset must clear both copies of the active timer, preventing resurrection.
    await page.evaluate(() => { startLifeLog(); resetAll(); });
    await page.reload();
    assert.equal(await page.evaluate(() => D.activeStopwatch), null);
    assert.deepEqual(errors, []);
    console.log('PASS: overnight 8h/reload/lifecycle recovery, stale-tab protection, local-only active timer, calendar completion/partial save, deduplication, off/ask/auto, failures, 320/380px and reset');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
