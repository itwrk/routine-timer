// NODE_PATH=<playwright install>/node_modules node tests/lifelog-browser.cjs
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
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      executablePath: process.env.RVT_CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
      headless: true
    });
    const context = await browser.newContext({ viewport: { width: 380, height: 820 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      if (!localStorage.getItem('rvt_v1')) localStorage.setItem('rvt_v1', JSON.stringify({
        schemaVersion: 17,
        routines: [
          { id: 'synthetic-routine', name: 'テスト用ルーチン', steps: [
            { id: 'synthetic-step', sharedId: 'synthetic-shared', name: '片づけ', emoji: '🧹', sec: 60, texts: [] },
            { id: 'synthetic-special', name: '<読書> & "休憩"', emoji: '📖', sec: 60, texts: [] }
          ] },
          { id: 'synthetic-other', name: '共有先', steps: [
            { id: 'synthetic-copy', sharedId: 'synthetic-shared', name: '片づけ', emoji: '🧹', sec: 60, texts: [] }
          ] }
        ],
        settings: { autoSync: false, syncUrl: 'https://sync.invalid', sound: false, moti: false }
      }));
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin);
    await page.locator('#homeLifeLogButton').click();
    assert.equal(await page.locator('#scr-lifelog').isVisible(), true);
    assert.equal(await page.locator('#quickTimerLabel').inputValue(), '');
    assert.equal(await page.locator('#lifeLogStep option[value="shared:synthetic-shared"]').count(), 1);
    assert(await page.locator('#lifeLogStep option[value^="preset:"]').count() > 0);

    // An unnamed timer survives reload and navigation; stopping is idempotent.
    await page.locator('#lifeLogStart').click();
    const activeId = await page.evaluate(() => {
      startLifeLog(); // Repeated start must leave the original timer intact.
      D.activeStopwatch.startedAt -= 65000;
      persistActiveStopwatch();
      localStorage.setItem(KEY, JSON.stringify(D));
      return D.activeStopwatch.id;
    });
    await page.reload();
    await page.locator('[data-scr="scr-lifelog"]').click();
    assert.equal(await page.locator('#quickTimerLabel').inputValue(), '');
    assert.match(await page.locator('#quickTimerClock').textContent(), /^01:/);
    assert.equal(await page.evaluate(() => D.activeStopwatch.id), activeId);
    await page.locator('[data-scr="scr-home"]').click();
    assert.match(await page.locator('#homeLifeLogButton').textContent(), /🔴/);
    await page.locator('#homeLifeLogButton').click();
    await page.locator('#lifeLogEnd').click();
    await page.evaluate(() => finishLifeLog());
    let logs = await page.evaluate(() => D.stopwatchLogs);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].label, '無題');
    assert.equal(logs[0].source, 'lifelog');
    assert(logs[0].durationSec >= 65);
    const originalTimes = [logs[0].startedAt, logs[0].endedAt, logs[0].durationSec];

    // Rename an unnamed log in place, persist it, and expose it in the timeline/CSV.
    await page.locator('.life-log-edit').first().click();
    await page.locator('.life-log-edit-label').fill('本を読んだ時間');
    await page.locator('.life-log-save').click();
    logs = await page.evaluate(() => D.stopwatchLogs);
    assert.equal(logs[0].label, '本を読んだ時間');
    assert.deepEqual([logs[0].startedAt, logs[0].endedAt, logs[0].durationSec], originalTimes);
    await page.reload();
    await page.locator('#activityTimeline [aria-label="本を読んだ時間のライフログを編集"]').click();
    assert.equal(await page.locator('.life-log-edit-label').inputValue(), '本を読んだ時間');
    await page.locator('.life-log-edit-step').selectOption('shared:synthetic-shared');
    await page.locator('.life-log-save').click();
    assert.equal(await page.evaluate(() => D.stopwatchLogs[0].label), '片づけ');
    assert.match(await page.evaluate(() => buildChatGPTTimelineCsv()), /ライフログ,片づけ/);

    // Select before starting or while running, without modifying library steps.
    await page.locator('#lifeLogStep').selectOption('shared:synthetic-shared');
    await page.locator('#lifeLogStart').click();
    await page.locator('#lifeLogStep').selectOption('step:synthetic-routine:synthetic-special');
    await page.reload();
    await page.locator('[data-scr="scr-lifelog"]').click();
    assert.equal(await page.locator('#quickTimerLabel').inputValue(), '<読書> & "休憩"');
    assert.equal(await page.locator('#lifeLogStep').inputValue(), 'step:synthetic-routine:synthetic-special');
    await page.locator('#lifeLogEnd').click();
    assert.equal(await page.evaluate(() => D.stopwatchLogs[0].label), '<読書> & "休憩"');
    assert.equal(await page.locator('.life-log-name').first().textContent(), '📖 <読書> & "休憩"');
    assert.equal(await page.evaluate(() => D.routines[0].steps[0].name), '片づけ');
    assert.equal(await page.locator('#quickTimerLabel').inputValue(), '', 'the next timer starts without a previous label');

    // Clearing a selection creates an untitled log; free text clears the step association.
    await page.locator('#lifeLogStep').selectOption('preset:0');
    await page.locator('#lifeLogStep').selectOption('');
    await page.locator('#lifeLogStart').click();
    await page.locator('#lifeLogEnd').click();
    assert.equal(await page.evaluate(() => D.stopwatchLogs[0].label), '無題');
    await page.locator('#lifeLogStart').click();
    await page.locator('#lifeLogStep').selectOption('preset:0');
    await page.locator('#quickTimerLabel').fill('自由な内容');
    assert.equal(await page.locator('#lifeLogStep').inputValue(), '');
    await page.locator('#lifeLogEnd').click();
    assert.equal(await page.evaluate(() => D.stopwatchLogs[0].stepId), '');

    // Local active timers stay on their device; completed edits merge by timestamp.
    assert.equal(await page.evaluate(() => {
      const id = D.stopwatchLogs[0].id, remote = JSON.parse(JSON.stringify(D));
      remote.stopwatchLogs[0].label = '別端末で編集';
      remote.stopwatchLogs[0].updatedAt += 10000;
      mergeMealCollections(D, remote);
      return remote.stopwatchLogs.find(log => log.id === id).label;
    }), '別端末で編集');
    await page.locator('#lifeLogStart').click();
    assert.equal(await page.evaluate(() => Object.hasOwn(syncDataForCloud(), 'activeStopwatch')), false);
    assert.equal(await page.evaluate(() => {
      const id = D.activeStopwatch.id, remote = JSON.parse(JSON.stringify(D));
      remote.updatedAt += 10000;
      applySyncPullData(remote, true);
      return D.activeStopwatch.id === id;
    }), true);
    await page.locator('#lifeLogEnd').click();

    // Editing drafts survive a background refresh and cancellation preserves saved data.
    await page.locator('.life-log-edit').first().click();
    await page.locator('.life-log-edit-label').fill('保存前の下書き');
    await page.locator('.life-log-edit-label').blur();
    await page.evaluate(() => renderActiveDataScreen());
    assert.equal(await page.locator('.life-log-edit-label').inputValue(), '保存前の下書き');
    await page.locator('.life-log-cancel').click();
    assert.equal(await page.evaluate(() => D.stopwatchLogs[0].label), '無題');
    assert.equal(await page.evaluate(() => D.xp), 0);
    assert.equal(await page.evaluate(() => D.logs.length), 0);

    for (const width of [320, 380, 1280]) {
      await page.setViewportSize({ width, height: 820 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}px`);
      const clipped = await page.locator('.tabbar button, #scr-lifelog button').evaluateAll(buttons => buttons.filter(button => {
        const style = getComputedStyle(button);
        return style.whiteSpace !== 'nowrap' || button.scrollWidth > button.clientWidth + 1;
      }).map(button => button.textContent.trim()));
      assert.deepEqual(clipped, [], `unwrapped and unclipped buttons at ${width}px`);
    }
    await page.setViewportSize({ width: 380, height: 820 });
    await page.locator('.toast, .tapfx').evaluateAll(items => items.forEach(item => item.remove()));
    await page.waitForTimeout(300); // Let viewport reflow and button animations finish before visual QA.
    await page.screenshot({ path: '/tmp/rvt-lifelog-mobile.png', animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('PASS: life log start/end, reload recovery, step selection, untitled records, later edits, sync, timeline/CSV and 320/380/1280px layout');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
