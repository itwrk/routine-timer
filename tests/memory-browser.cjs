// Optional browser regression suite: NODE_PATH=<temporary playwright install>/node_modules node tests/memory-browser.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const nodePath = require('node:path');
(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(nodePath.join(__dirname, '..', 'index.html')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const chrome =
    process.env.RVT_CHROME_PATH ||
    (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({
    viewport: { width: 380, height: 820 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('rvt_v1'))
      localStorage.setItem(
        'rvt_v1',
        JSON.stringify({ settings: { autoSync: false, syncUrl: 'https://sync.invalid', sound: false } })
      );
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  await page.goto(origin);
  await page.locator('[data-scr="scr-memory"]').click();
  await page.waitForFunction(() => memoryState.ready && !document.getElementById('memShell').inert);
  // The official catalogs drive options, compatibility, persistence and native device voices.
  await page.locator('#memSettings').evaluate((el) => (el.open = true));
  assert.equal(await page.locator('#memModel option').count(), 9);
  assert.equal(await page.locator('#memVoice option').count(), 10);
  const initialTone = '明るく親しみやすく、重要な単語は少し強調する。';
  assert.equal(await page.locator('#memTone').isVisible(), true);
  await page.locator('#memTone').fill(initialTone);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(MEMORY_PREF_KEY)).tone), initialTone);
  assert((await page.locator('#memModel option').allTextContents()).every((label) => label.includes('｜')));
  assert((await page.locator('#memVoice option').allTextContents()).every((label) => label.includes('｜')));
  await page.locator('#memModel').selectOption('gpt-4o-mini-tts');
  assert.equal(await page.locator('#memVoice option').count(), 13);
  await page.locator('#memVoice').selectOption('nova');
  assert((await page.locator('#memVoice option:checked').innerText()).includes('明るく快活'));
  assert((await page.locator('#memVoiceInfo').innerText()).includes('目安'));
  assert.equal(await page.locator('#memTone').isVisible(), true);
  await page.locator('#memModel').selectOption('gpt-realtime-2.1');
  assert.equal(await page.locator('#memVoice option').count(), 10);
  assert.equal(await page.locator('#memVoice').inputValue(), 'marin');
  assert((await page.locator('#memModelInfo').innerText()).includes('変更しました'));
  await page.locator('#memModel').selectOption('tts-1-hd');
  assert.equal(await page.locator('#memTone').isVisible(), false);
  assert.equal(await page.locator('#memTone').isDisabled(), true);
  assert.equal(await page.locator('#memTone').inputValue(), initialTone);
  assert.equal(await page.locator('#memVoice option').count(), 9);
  assert.equal(await page.locator('#memVoice').inputValue(), 'alloy');
  assert.equal(await page.locator('#memVoice option[value="marin"]').count(), 0);
  await page.locator('#memVoice').selectOption('onyx');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(MEMORY_PREF_KEY)).voice), 'onyx');
  await page.locator('#memModel').selectOption('gpt-realtime-2.1-mini');
  assert.equal(await page.locator('#memTone').isVisible(), true);
  assert.equal(await page.locator('#memTone').isDisabled(), false);
  assert.equal(await page.locator('#memTone').inputValue(), initialTone);
  await page.evaluate(() => {
    window.qaDeviceVoices = [
      { voiceURI: 'synthetic-en-voice', name: 'English Test', lang: 'en-US' },
      { voiceURI: 'synthetic-ja-voice', name: 'Japanese Test', lang: 'ja-JP' }
    ];
    Object.defineProperty(speechSynthesis, 'getVoices', { configurable: true, value: () => qaDeviceVoices });
    speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  assert.equal(await page.locator('#memTtsVoice option').count(), 3);
  assert.equal(await page.locator('#memTtsVoice option').nth(1).getAttribute('value'), 'synthetic-ja-voice');
  await page.locator('#memTtsVoice').selectOption('synthetic-en-voice');
  await page.evaluate(() => {
    qaDeviceVoices = [];
    speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  assert.equal(await page.locator('#memTtsVoice').inputValue(), 'synthetic-en-voice');
  assert((await page.locator('#memTtsVoice option:checked').innerText()).includes('利用できません'));
  await page.evaluate(() => {
    qaDeviceVoices = [{ voiceURI: 'synthetic-en-voice', name: 'English Test', lang: 'en-US' }];
    speechSynthesis.dispatchEvent(new Event('voiceschanged'));
  });
  assert.equal(await page.locator('#memTtsVoice option').count(), 2);
  assert.equal(await page.locator('#memTtsVoice').inputValue(), 'synthetic-en-voice');
  await page.locator('#memSettings').evaluate((el) => (el.open = false));
  await page.locator('#memTitle').fill('日本史の暗記');
  await page.locator('#memNotationPanel').evaluate((el) => (el.open = true));
  await page
    .locator('#memNotation')
    .fill('日本の首都は《東京》。\n【繰り返す】と《定着✓》する。\n歩きながら暗記する。');
  await page.evaluate(() => memoryApplyNotation());
  await page.evaluate(() => memorySave());
  assert.equal(await page.locator('#memTitle').inputValue(), '日本史の暗記');
  // Escape notation, multi-line runs, checked green and whitespace round-trip.
  const roundtrip = await page.evaluate(() => {
    const text = '《赤✓》【緑✓】\\《文字\\》\\【角\\】\\✓\\\\\n\n改行';
    return [text, memoryToNotation(memoryParseNotation(text))];
  });
  assert.equal(roundtrip[0], roundtrip[1]);
  // Remember a selection after Safari-like focus loss/collapse, recolor without nesting, preserve edits.
  await page.evaluate(() => {
    const b = document.querySelector('.mem-block'),
      r = document.createRange();
    r.setStart(b.firstChild, 0);
    r.setEnd(b.firstChild, 2);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    memoryCaptureSelection();
    s.removeAllRanges();
  });
  await page.locator('.mem-green-btn').click();
  assert.equal(
    await page.locator('.mem-block').first().locator('.mem-mark[data-color="green"]').first().innerText(),
    '日本'
  );
  await page.evaluate(() => {
    const mark = document.querySelector('.mem-mark[data-color="green"]');
    mark.firstChild.insertData(1, '語');
    memoryChanged();
  });
  assert.equal(
    await page.locator('.mem-block').first().locator('.mem-mark[data-color="green"]').first().innerText(),
    '日語本'
  );
  assert.equal(await page.locator('.mem-mark .mem-mark').count(), 0);
  // Mark from inside red to outside, preserving the unselected portion's mark.
  await page.evaluate(() => {
    const b = document.querySelectorAll('.mem-block')[1],
      mark = b.querySelector('[data-color="red"]'),
      r = document.createRange();
    r.setStart(mark.firstChild, 1);
    r.setEnd(b.lastChild, 1);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    memoryCaptureSelection();
    memoryMark('green');
  });
  assert.equal(await page.locator('.mem-mark .mem-mark').count(), 0);
  const recolored = await page.evaluate(() => memoryToNotation(memoryEditorHTML()));
  assert(recolored.includes('《定✓》【着す】'), recolored);
  // Plain text paste cannot run HTML; Enter splits the block and keeps a checked span on the tail.
  await page.evaluate(() => {
    memoryState.selection = null;
    const b = document.querySelectorAll('.mem-block')[1],
      r = document.createRange();
    r.setStart(b, 0);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.getElementById('memEditor').focus();
  });
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.mem-block').count(), 4);
  assert.equal(await page.locator('.mem-mark[data-checked="true"]').count(), 1);
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('.mem-block').count(), 3);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.mem-block').count(), 4);
  // Reorder keeps the actual span and check state.
  await page.evaluate(() => {
    memoryToggleBlocks(true);
    memoryMoveBlock(document.querySelectorAll('.mem-row')[2], -1);
    memoryToggleBlocks(false);
  });
  assert((await page.locator('.mem-block').nth(1).innerText()).includes('定着'));
  await page.evaluate(() => memoryToggleMode());
  await page.locator('.mem-mark[data-checked="true"]').click();
  assert.equal(await page.locator('.mem-mark[data-checked="true"]').count(), 0);
  await page.locator('.mem-mark[data-color="red"]').last().click();
  assert.equal(await page.locator('.mem-mark[data-checked="true"]').count(), 1);
  // Red sheet drag and keyboard, check remains stacked above it.
  await page.evaluate(() => memoryToggleSheet());
  const y0 = await page.locator('#memSheet').evaluate((el) => el.offsetTop);
  await page.locator('.mem-sheet-grip').focus();
  await page.keyboard.press('ArrowDown');
  assert((await page.locator('#memSheet').evaluate((el) => el.offsetTop)) >= y0);
  assert.equal(await page.locator('#memSheet').isVisible(), true);
  // Image insert and safe notation round-trip.
  const imageData = await page.evaluate(() => {
    memoryState.selection = null;
    getSelection().removeAllRanges();
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    c.getContext('2d').fillRect(0, 0, 4, 4);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page
    .locator('#memImage')
    .setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
  await page.waitForFunction(() => document.querySelectorAll('#memEditor img').length === 1);
  assert.equal(await page.locator('#memEditor img').count(), 1);
  const imageRound = await page.evaluate(() => {
    const s = memoryToNotation(memoryEditorHTML());
    return memoryToNotation(memoryParseNotation(s)) === s;
  });
  assert(imageRound);
  assert.equal(
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.innerHTML = memorySanitize(
        '<script>bad()</script><div onclick="bad()"><span data-color="red" onmouseover="bad()">safe</span><img src="https://evil.invalid/x"><img src="data:image/svg+xml;base64,PHN2Zy8+"></div>'
      );
      return div.querySelectorAll('script,[onclick],[onmouseover],img').length;
    }),
    0
  );
  await page.evaluate(() => memorySave());
  await page.reload();
  await page.locator('[data-scr="scr-memory"]').click();
  await page.locator('#memTitle').waitFor({ state: 'visible' });
  await page.waitForFunction(() => memoryState.ready);
  assert.equal(await page.locator('#memTitle').inputValue(), '日本史の暗記');
  assert.equal(await page.locator('#memEditor img').count(), 1);
  assert.equal(await page.locator('.mem-mark[data-checked="true"]').count(), 1);
  // Library creates separate independent notes, round-trip .txt imports every note.
  await page.evaluate(() => memoryNew());
  await page.locator('#memTitle').fill('二冊目');
  await page.locator('#memNotationPanel').evaluate((e) => (e.open = true));
  await page.locator('#memNotation').fill('【two】\n《three✓》');
  await page.evaluate(() => {
    memoryApplyNotation();
    return memorySave();
  });
  assert.equal(await page.locator('#memLibrary option').count(), 2);
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => memoryExport(true));
  const dl = await downloadPromise;
  const path = await dl.path();
  const exported = fs.readFileSync(path, 'utf8');
  assert(!exported.includes('apiKey'));
  await page
    .locator('#memImport')
    .setInputFiles({ name: '暗記ノート全件.txt', mimeType: 'text/plain', buffer: Buffer.from(exported) });
  await page.waitForFunction(() => memoryState.notes.length === 4);
  assert.equal(await page.locator('#memLibrary option').count(), 4);
  // Legacy JSON, including HTML, is accepted and sanitized; raw text stays plain.
  assert.equal(
    await page.evaluate(
      () =>
        memoryParseImport(
          JSON.stringify({ notes: [{ name: 'legacy', content: '<p><span class="red checked">語</span></p>' }] }),
          'legacy.json'
        ).notes[0].html
    ),
    '<div><span class="mem-mark" data-color="red" data-checked="true">語</span></div>'
  );
  assert.equal(
    await page.evaluate(() =>
      memoryToNotation(
        memoryLegacyNote({ text: 'abc\ndef', marks: [{ start: 1, end: 5, color: 'red', checked: true }] }).html
      )
    ),
    'a《bc✓》\n《d✓》ef'
  );
  assert.equal(
    await page.evaluate(() => {
      const text = '長い文章。'.repeat(500);
      const plan = memoryAudioPlan(memoryParseNotation(text));
      return (
        plan.segments.every((s) => Array.from(s.text).length <= 400) &&
        plan.segments.map((s) => s.text).join('') === text
      );
    }),
    true
  );
  // Generate with deterministic local PCM, verify cache reuse and exact real-time pauses and repetition.
  await page.evaluate(async () => {
    document.getElementById('memNotation').value = '一行目\n二行目';
    memoryApplyNotation();
    memoryPrefs.model = 'gpt-4o-mini-tts';
    memoryPrefs.gap = 1;
    memoryPrefs.fixed = true;
    memoryPrefs.fixedRate = 0.5;
    memoryPrefs.loop = '30';
    localStorage.setItem(MEMORY_API_KEY, 'synthetic-memory-test-key');
    window.qaGenerationCalls = 0;
    memoryGenerateClip = async () => {
      qaGenerationCalls++;
      return new Blob([new Uint8Array(4800)]);
    };
    await memoryGenerate();
  });
  assert.equal(await page.evaluate(() => qaGenerationCalls), 2);
  const wave = await page.evaluate(async () => {
    const b = await memoryState.prepared.blob.arrayBuffer(),
      v = new DataView(b);
    return {
      bytes: b.byteLength,
      data: v.getUint32(40, true),
      rate: document.getElementById('memAudio').playbackRate,
      loop: document.getElementById('memAudio').loop
    };
  });
  assert.equal(wave.bytes, 44 + (4800 * 2 + 24000 * 2) * 30);
  assert.equal(wave.data, wave.bytes - 44);
  assert.equal(wave.rate, 0.5);
  assert.equal(wave.loop, false);
  await page.evaluate(() => memoryGenerate());
  assert.equal(await page.evaluate(() => qaGenerationCalls), 2);
  // A new tone needs its own audio; restoring a saved tone reuses the old clips.
  await page.locator('#memSettings').evaluate((el) => (el.open = true));
  await page.locator('#memTone').fill('低めの声で、落ち着いて穏やかに。');
  assert.equal(await page.evaluate(() => memoryPrepareAudio()), false);
  await page.evaluate(() => memoryGenerate());
  assert.equal(await page.evaluate(() => qaGenerationCalls), 4);
  await page.locator('#memTone').fill(initialTone);
  assert.equal(await page.evaluate(() => memoryPrepareAudio()), true);
  await page.evaluate(() => memoryGenerate());
  assert.equal(await page.evaluate(() => qaGenerationCalls), 4);
  await page.locator('#memSettings').evaluate((el) => (el.open = false));
  // Changing gap/speed/check doesn't spend tokens, no timer drives saved playback.
  await page.evaluate(async () => {
    memoryPrefs.gap = 0;
    memoryPrefs.fixedRate = 1.2;
    memoryPrefs.loop = 'infinite';
    memoryInvalidateAudio();
    await memoryPrepareAudio();
  });
  assert.equal(await page.evaluate(() => qaGenerationCalls), 4);
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.loop), true);
  assert.equal(await page.evaluate(() => memoryState.prepared.blob.size), 44 + 9600);
  await page.evaluate(() => memoryPlay());
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.paused), false);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.paused), false);
  const beforeEnter = await page.evaluate(() => document.getElementById('memAudio').getAttribute('src'));
  await page.evaluate(() => memoryEnter());
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.getAttribute('src')), beforeEnter);
  await page.evaluate(() => showScreen('scr-home'));
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.paused), false);
  await page.evaluate(() => showScreen('scr-memory'));
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.getAttribute('src')), beforeEnter);
  await page.evaluate(() => memoryStop());
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.paused), true);
  assert.equal(await page.locator('#memAudio').evaluate((a) => a.currentTime), 0);
  // A duplicate generation call does not make a second request and cancellation keeps prior clips.
  await page.evaluate(async () => {
    document.getElementById('memNotation').value = '未生成';
    memoryApplyNotation();
    window.qaPending = 0;
    memoryGenerateClip = async (text, prefs, key, signal) => {
      qaPending++;
      return new Promise((res, rej) =>
        signal.addEventListener('abort', () => rej(new DOMException('中止', 'AbortError')), { once: true })
      );
    };
    window.qaJob = memoryGenerate();
  });
  await page.waitForFunction(() => qaPending === 1);
  await page.evaluate(() => memoryGenerate());
  assert.equal(await page.evaluate(() => qaPending), 1);
  await page.evaluate(() => {
    memoryCancelGeneration();
    return qaJob;
  });
  assert.equal(await page.locator('#memGenerate').isDisabled(), false);
  // TTS fallback and stop cancels scheduled line/loop work.
  await page.evaluate(() => {
    window.qaSpoken = [];
    window.qaCancelled = 0;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        constructor(text) {
          this.text = text;
        }
      }
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {
          qaCancelled++;
        },
        getVoices() {
          return [
            { voiceURI: 'synthetic-ja-voice', name: 'Japanese Test', lang: 'ja-JP' },
            { voiceURI: 'synthetic-en-voice', name: 'English Test', lang: 'en-US' }
          ];
        },
        speak(u) {
          qaSpoken.push(u.text);
          window.qaUtterance = u;
        }
      }
    });
    memoryPrefs.loop = '30';
    memoryPrefs.gap = 0;
    memoryPlayTTS();
  });
  assert.deepEqual(await page.evaluate(() => qaSpoken), ['未生成']);
  assert.equal(await page.evaluate(() => qaUtterance.voice.voiceURI), 'synthetic-en-voice');
  assert.equal(await page.evaluate(() => qaUtterance.lang), 'en-US');
  await page.evaluate(() => {
    memoryStop();
    qaUtterance.onend();
  });
  await page.waitForTimeout(20);
  assert.equal(await page.evaluate(() => qaSpoken.length), 1);
  // Native export preserves no credentials; settings persist on reload.
  await page.evaluate(() => {
    memoryPrefs.fixedRate = 2.3;
    memorySavePrefs();
  });
  await page.reload();
  await page.locator('[data-scr="scr-memory"]').click();
  await page.waitForFunction(() => memoryState.ready);
  assert.equal(await page.locator('#memFixedRate').inputValue(), '2.3');
  assert.equal(await page.locator('#memTone').inputValue(), initialTone);
  assert.equal(await page.locator('#memTtsVoice').inputValue(), 'synthetic-en-voice');
  assert.equal(await page.locator('#memApiKey').inputValue(), 'synthetic-memory-test-key');
  assert((await page.evaluate(() => memoryStore('clips', 'getAll'))).length >= 2);
  await page.locator('#memNotationPanel').evaluate((e) => (e.open = false));
  await page.screenshot({ path: '/tmp/rvt-memory-work/memory-mobile-qa.png', fullPage: true });
  const overflow = await page.evaluate(() => ({
    body: document.documentElement.scrollWidth,
    screen: innerWidth,
    buttons: [...document.querySelectorAll('#scr-memory button')]
      .filter((e) => e.offsetWidth && getComputedStyle(e).whiteSpace !== 'nowrap')
      .map((e) => e.textContent)
  }));
  assert.equal(overflow.body, overflow.screen);
  assert.deepEqual(overflow.buttons, []);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: mobile selection retention, span edits/checks, Enter/reordering, sheet, images, sanitization, persistence, library/text/legacy import, audio PCM cache/gaps/30/infinite, playback/stop, cancellation, TTS, settings and 380px layout'
  );
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
