// Optional: NODE_PATH=<temporary playwright install>/node_modules node tests/memory-editor-browser.cjs
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  http = require('node:http'),
  path = require('node:path');
(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '..', 'index.html')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const useWebkit = process.env.RVT_BROWSER === 'webkit';
  const browser = await (useWebkit ? webkit : chromium).launch({
    headless: true,
    executablePath: useWebkit
      ? undefined
      : process.env.RVT_CHROME_PATH ||
        (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  });
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  for (const viewport of [
    { width: 1200, height: 900 },
    { width: 380, height: 820 }
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 500,
      hasTouch: viewport.width < 500
    });
    await context.addInitScript(() =>
      localStorage.setItem(
        'rvt_v1',
        JSON.stringify({ settings: { sound: false, autoSync: false, syncUrl: 'https://sync.invalid' } })
      )
    );
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    await page.goto(origin);
    await page.locator('[data-scr="scr-memory"]').click();
    await page.waitForFunction(() => memoryState.ready);
    const editor = page.locator('#memEditor');
    const text = () => page.evaluate(() => memoryToNotation(memoryEditorHTML()));
    const load = async (value) => page.evaluate((value) => memorySetEditorHTML(memoryParseNotation(value)), value);
    const setCaret = async (line, offset) =>
      page.evaluate(
        ({ line, offset }) => {
          const editor = document.getElementById('memEditor'),
            block = editor.children[line],
            r = document.createRange();
          r.setStart(block.firstChild, offset);
          r.collapse(true);
          editor.focus();
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        },
        { line, offset }
      );
    // Native Enter, consecutive blank lines, backspace and Shift+Enter keep plain-text line semantics.
    await editor.fill('alpha');
    await page.keyboard.press('Enter');
    await page.keyboard.type('beta');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gamma');
    assert.equal(await text(), 'alpha\nbeta\n\ngamma');
    await page.evaluate(() => memorySave());
    assert.equal(await text(), 'alpha\nbeta\n\ngamma', 'saving must not accumulate placeholder BR lines');
    await load('alpha\nbeta\ngamma');
    await setCaret(2, 2);
    await page.keyboard.press('ArrowUp');
    assert.equal(
      await page.evaluate(() => getSelection().anchorNode.textContent),
      'beta',
      'arrow keys move between lines in one editing host'
    );
    await setCaret(1, 0);
    await page.keyboard.press('Backspace');
    assert.equal(await text(), 'alphabeta\ngamma');
    await load('alpha\nbeta');
    await setCaret(0, 2);
    await page.keyboard.press('Shift+Enter');
    assert.equal(await text(), 'al\npha\nbeta');
    // Cross-line selection can be replaced as ordinary text, without block restrictions.
    await load('alpha\nbeta\ngamma');
    await page.evaluate(() => {
      const e = document.getElementById('memEditor'),
        r = document.createRange();
      r.setStart(e.children[0].firstChild, 2);
      r.setEnd(e.children[1].firstChild, 2);
      e.focus();
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.keyboard.type('X');
    assert.equal(await text(), 'alXta\ngamma');
    // Select-all targets the editor, and native typing undo/redo works.
    await load('first\nsecond');
    await editor.focus();
    await page.keyboard.press(mod + '+A');
    await page.keyboard.type('replacement');
    assert.equal(await text(), 'replacement');
    await load('base');
    await setCaret(0, 4);
    await page.keyboard.insertText(' plus');
    assert.equal(await text(), 'base plus');
    await page.keyboard.press(mod + '+Z');
    assert.equal(await text(), 'base');
    await page.keyboard.press(mod + '+Shift+Z');
    assert.equal(await text(), 'base plus');
    // Plain paste preserves blank lines, uses the caret or cross-line range, and remains undoable.
    await load('before');
    await editor.focus();
    await page.keyboard.press(mod + '+A');
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', 'pasted one\n\npasted two');
      document
        .getElementById('memEditor')
        .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    assert.equal(await text(), 'pasted one\n\npasted two');
    await page.keyboard.press(mod + '+Z');
    assert.equal(await text(), 'before');
    // Marker selection works even after the browser creates plain root text without a paragraph wrapper.
    await editor.fill('plain text');
    await page.evaluate(() => {
      const e = document.getElementById('memEditor'),
        w = document.createTreeWalker(e, 4);
      w.nextNode();
      const r = document.createRange();
      r.setStart(w.currentNode, 0);
      r.setEnd(w.currentNode, 5);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      memoryCaptureSelection();
      getSelection().removeAllRanges();
    });
    await page.locator('.mem-red-btn').click();
    assert.equal(await text(), '《plain》 text');
    // Selecting across lines, recoloring part of a marked span and editing a checked word preserve structure.
    await load('first 《marked✓》 end\nsecond 【green】 end');
    await page.evaluate(() => {
      const e = document.getElementById('memEditor'),
        r = document.createRange();
      r.setStart(e.children[0].querySelector('.mem-mark').firstChild, 3);
      r.setEnd(e.children[1].firstChild, 3);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      memoryCaptureSelection();
      memoryMark('green');
    });
    assert.equal(await text(), 'first 《mar✓》【ked end】\n【sec】ond 【green】 end');
    assert.equal(await page.locator('#memEditor .mem-mark .mem-mark').count(), 0);
    await load('《東京✓》へ行く\n\n【繰り返す】');
    await page.locator('#memEditor .mem-mark').first().click();
    assert.equal(
      await page.locator('#memEditor [data-checked="true"]').count(),
      1,
      'editing a marked word does not toggle its check'
    );
    await page.evaluate(() => {
      const e = document.getElementById('memEditor'),
        word = e.querySelector('.mem-mark').firstChild,
        r = document.createRange();
      r.setStart(word, 1);
      r.collapse(true);
      e.focus();
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.keyboard.insertText('都');
    assert.equal(await text(), '《東都京✓》へ行く\n\n【繰り返す】');
    // Row controls are absent while typing and only appear in the explicit arrange view.
    await load('あああああ\nいいいい\nううう');
    assert(
      (await page.locator('#memEditor>div').nth(2).boundingBox()).y -
        (await page.locator('#memEditor>div').nth(0).boundingBox()).y <
        70
    );
    const longText = Array.from(
      { length: 60 },
      (_, i) => `${i + 1}行目：長い文章も普通の文書として読み進められます。`
    ).join('\n');
    await load(longText);
    assert.equal(await page.locator('#memEditor [contenteditable]').count(), 0);
    assert.equal(await page.locator('#memEditor button').count(), 0);
    assert.equal(await page.locator('.mem-row').count(), 0);
    const metrics = await page.evaluate(() => ({
      line: document.querySelector('#memEditor>div').getBoundingClientRect().height,
      editor: document.getElementById('memEditor').getBoundingClientRect().height,
      font: parseFloat(getComputedStyle(document.getElementById('memEditor')).fontSize),
      player: getComputedStyle(document.querySelector('.mem-player')).position,
      width: document.documentElement.scrollWidth,
      viewport: innerWidth
    }));
    assert(metrics.line < (viewport.width < 500 ? 72 : 36));
    assert(metrics.editor < 60 * metrics.font * 4);
    assert.equal(metrics.player, 'static');
    assert.equal(metrics.width, metrics.viewport);
    await page.locator('#memBlocksToggle').click();
    assert.equal(await editor.isVisible(), false);
    assert.equal(await page.locator('.mem-row').count(), 60);
    await page.locator('.mem-row').nth(1).getByRole('button', { name: '行を上へ' }).click();
    await page.locator('#memBlocksToggle').click();
    assert.equal(await editor.isVisible(), true);
    assert.equal((await text()).split('\n')[0], longText.split('\n')[1]);
    // Blank lines/checks survive rearrangement, saving, and loading the old HTML-shaped notes.
    await load('《one✓》\n\n【two】\n');
    await page.evaluate(() => {
      memoryToggleBlocks(true);
      memoryMoveBlock(2, -1);
      memoryToggleBlocks(false);
    });
    const saved = '《one✓》\n【two】\n\n';
    assert.equal(await text(), saved);
    await page.evaluate(() => memorySave());
    await page.reload();
    await page.locator('[data-scr="scr-memory"]').click();
    await page.waitForFunction(() => memoryState.ready);
    assert.equal(await text(), saved);
    await page.evaluate(() => memoryToggleMode());
    await page.locator('#memEditor [data-checked="true"]').click();
    assert.equal(await page.locator('#memEditor [data-checked="true"]').count(), 0);
    assert.equal(await page.locator('#memEditor').getAttribute('contenteditable'), 'false');
    // Export reads every line, including browser-generated BR paragraphs and final blank lines.
    assert.equal(
      await page.evaluate(() =>
        memoryToNotation(memorySanitize('<div>one</div><div><br></div><div>two<br><br></div>'))
      ),
      'one\n\ntwo\n'
    );
    assert.equal(
      await page.evaluate(() =>
        memoryToNotation(memorySanitize('first <span class="mem-mark" data-color="red">word</span><div>second</div>'))
      ),
      'first 《word》\nsecond'
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS: ${useWebkit ? 'WebKit' : 'Chrome'} ${viewport.width}px ordinary document editing, native line/caret/delete/select-all/undo/paste, spans, 60-line layout, arrange view and persistence`
    );
    await context.close();
  }
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
