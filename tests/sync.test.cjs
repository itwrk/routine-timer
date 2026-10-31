const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(
  html.indexOf('/* ============ ☁️ 端末間同期 (GAS) ============ */'),
  html.indexOf('/* ============ 📓 Notionタスク表示')
);
const twoTapSource = html.slice(html.indexOf('function resetTwoTap(btn)'), html.indexOf('/* 🔗共有ステップ'));
function button() {
  const attrs = new Map();
  return {
    dataset: {},
    style: {},
    innerHTML: '⬇️ 今すぐ取得',
    disabled: false,
    set textContent(v) {
      this.innerHTML = v;
    },
    get textContent() {
      return this.innerHTML;
    },
    hasAttribute(k) {
      return attrs.has(k);
    },
    getAttribute(k) {
      return attrs.get(k) ?? null;
    },
    setAttribute(k, v) {
      attrs.set(k, v);
    },
    removeAttribute(k) {
      attrs.delete(k);
    }
  };
}
function fixture() {
  let now = 1000,
    nextTimer = 1,
    requests = [],
    timers = new Map(),
    storage = new Map(),
    failStorage = false;
  const remote = {
    routines: Array.from({ length: 9 }, (_, i) => ({ id: 'synthetic-routine-' + i, steps: [] })),
    habits: Array.from({ length: 13 }, (_, i) => ({ id: 'synthetic-habit-' + i })),
    settings: { rate: 1 },
    updatedAt: 100
  };
  const local = {
    routines: [{ id: 'synthetic-seed', steps: [] }],
    habits: [],
    settings: {
      syncUrl: 'https://sync.invalid',
      syncKey: 'synthetic-key',
      autoSync: false,
      apiKey: 'synthetic-device-key'
    },
    activeStopwatch: { id: 'synthetic-local-stopwatch', startedAt: 1 },
    simpleNotes: [{ id: 'synthetic-note', body: 'local draft' }],
    updatedAt: 200
  };
  const status = { textContent: '', style: {} },
    toasts = [];
  const ctx = {
    D: local,
    KEY: 'test_sync',
    document: { getElementById: (id) => (id === 'syncStatus' ? status : null) },
    setTimeout(fn, ms) {
      const id = nextTimer++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(Number(id));
    },
    toast: (m) => toasts.push(m),
    mergeMealCollections(incoming, base) {
      base.simpleNotes = [...(base.simpleNotes || []), ...(incoming.simpleNotes || [])].filter(
        (n, i, a) => a.findIndex((v) => v.id === n.id) === i
      );
    },
    normalizeData: (d) => Object.assign({ habits: [] }, d),
    stopMealWaitTimer() {},
    restoreMealState() {},
    renderActiveDataScreen() {},
    buildChatGPTTimelineCsv: () => '',
    localStorage: {
      setItem(k, v) {
        if (failStorage) throw Error('storage unavailable');
        storage.set(k, v);
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { json: async () => ({ ok: true, data: structuredClone(remote) }) };
    }
  };
  vm.createContext(ctx);
  vm.runInContext(twoTapSource + '\n' + source, ctx);
  return {
    ctx,
    remote,
    local,
    status,
    requests,
    timers,
    storage,
    toasts,
    failStorage() {
      failStorage = true;
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers])
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
    }
  };
}
(async () => {
  // The second tap consumes the validated snapshot without a second slow network request.
  let f = fixture(),
    b = button();
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 1);
  assert.equal(b.dataset.armed, '1');
  assert(f.status.textContent.includes('9件'));
  assert(f.status.textContent.includes('30秒'));
  f.advance(5000);
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 1);
  assert.equal(f.ctx.D.routines.length, 9);
  assert.equal(f.ctx.D.habits.length, 13);
  assert.equal(f.ctx.D.settings.autoSync, false);
  assert.equal(f.ctx.D.settings.apiKey, 'synthetic-device-key');
  assert.equal(f.ctx.D.activeStopwatch.id, 'synthetic-local-stopwatch');
  assert.equal(f.ctx.D.simpleNotes[0].id, 'synthetic-note');
  assert(!b.dataset.armed);
  assert(f.status.textContent.includes('取得しました'));
  assert(f.status.textContent.includes('9件'));
  // Slow preflight and repeated taps cannot restart a request or expire the acceptance mid-flight.
  f = fixture();
  b = button();
  let resolveFetch;
  f.ctx.fetch = async () => {
    f.requests.push({});
    return new Promise((resolve) => (resolveFetch = resolve));
  };
  const first = f.ctx.syncPullSafe(b);
  assert.equal(b.disabled, true);
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 1);
  f.advance(12000);
  resolveFetch({ json: async () => ({ ok: true, data: structuredClone(f.remote) }) });
  await first;
  assert.equal(b.disabled, false);
  f.advance(15000);
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 1);
  assert.equal(f.ctx.D.routines.length, 9);
  // Expired confirmation and changes to local data or credentials require a fresh preview.
  f = fixture();
  b = button();
  await f.ctx.syncPullSafe(b);
  f.advance(31000);
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 2);
  assert.equal(f.ctx.D.routines.length, 1);
  assert.equal(b.dataset.armed, '1');
  f.ctx.D.updatedAt = 300;
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 3);
  assert.equal(f.ctx.D.routines.length, 1);
  f.ctx.D.settings.syncKey = 'synthetic-changed-key';
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 4);
  assert.equal(f.ctx.D.routines.length, 1);
  // Newer cloud data needs one request and no extra confirmation.
  f = fixture();
  b = button();
  f.remote.updatedAt = 400;
  await f.ctx.syncPullSafe(b);
  assert.equal(f.requests.length, 1);
  assert.equal(f.ctx.D.routines.length, 9);
  assert(!b.dataset.armed);
  // Network/auth failures and exhausted storage never replace the current data.
  f = fixture();
  b = button();
  f.ctx.fetch = async () => {
    throw Error('network failed');
  };
  await f.ctx.syncPullSafe(b);
  assert.equal(f.ctx.D, f.local);
  assert.equal(b.disabled, false);
  assert(f.status.textContent.includes('通信'));
  f = fixture();
  b = button();
  f.ctx.fetch = async () => ({ json: async () => ({ ok: false, error: '合言葉を確認' }) });
  await f.ctx.syncPullSafe(b);
  assert.equal(f.ctx.D, f.local);
  assert(f.status.textContent.includes('合言葉'));
  f = fixture();
  b = button();
  await f.ctx.syncPullSafe(b);
  f.failStorage();
  await f.ctx.syncPullSafe(b);
  assert.equal(f.ctx.D, f.local);
  assert.equal(f.ctx.D.routines.length, 1);
  assert(f.status.textContent.includes('保存容量'));
  f = fixture();
  assert.throws(() => f.ctx.applySyncPullData({ settings: {} }, false), /形式/);
  assert.equal(f.ctx.D, f.local);
  // Turning auto-sync off cancels pending uploads, including a job already doing preflight.
  f = fixture();
  f.ctx.D.settings.autoSync = true;
  f.ctx.scheduleAutoPush();
  assert.equal(f.timers.size, 1);
  f.ctx.D.settings.autoSync = false;
  f.ctx.scheduleAutoPush();
  assert.equal(f.timers.size, 0);
  await f.ctx.syncPush(true);
  assert.equal(f.requests.length, 0);
  f = fixture();
  f.ctx.D.settings.autoSync = true;
  let preflight;
  f.ctx.fetch = async (url, options) => {
    f.requests.push({ url, options });
    return new Promise((resolve) => (preflight = resolve));
  };
  const push = f.ctx.syncPush(true);
  f.ctx.D.settings.autoSync = false;
  preflight({ json: async () => ({ ok: true, data: structuredClone(f.remote) }) });
  await push;
  assert.equal(f.requests.length, 1);
  assert(!f.requests.some((r) => r.options?.method === 'POST'));
  // Disabled auto-sync also cancels an automatic download already waiting on the server.
  f = fixture();
  await f.ctx.syncPull(true);
  assert.equal(f.requests.length, 0);
  f.ctx.D.settings.autoSync = true;
  f.remote.updatedAt = 400;
  let download;
  f.ctx.fetch = async () => new Promise((resolve) => (download = resolve));
  const pull = f.ctx.syncPull(true);
  f.ctx.D.settings.autoSync = false;
  download({ json: async () => ({ ok: true, data: structuredClone(f.remote) }) });
  await pull;
  assert.equal(f.ctx.D, f.local);
  assert.equal(f.storage.size, 0);
  // Normal two-tap controls retain their original timeout.
  f = fixture();
  b = button();
  let accepted = 0;
  f.ctx.twoTap(b, '確認', () => accepted++);
  f.advance(2600);
  assert(!b.dataset.armed);
  assert.equal(accepted, 0);
  console.log(
    'PASS: slow sync confirmation, 30s snapshot reuse, duplicate taps, expiry/context changes, one-request restore, device settings/records, safe failures, auto-sync cancellation and unchanged default confirmations'
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
