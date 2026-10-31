const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const html = fs.readFileSync('index.html', 'utf8');
const source = html
  .slice(
    html.indexOf('/* ============ MEMORY START ============ */'),
    html.indexOf('/* ============ MEMORY END ============ */')
  )
  .replace(/\bmemoryInitEvents\(\);\s*$/, '');
const prefs = {
  speed: 1,
  fixed: false,
  fixedRate: 1,
  gap: 1,
  loop: 'off',
  voice: 'marin',
  model: 'gpt-realtime-2.1-mini'
};
const storage = new Map();
const ctx = {
  Blob,
  TextEncoder,
  DataView,
  Uint8Array,
  ArrayBuffer,
  AbortController,
  DOMException,
  crypto: webcrypto,
  atob,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  },
  navigator: {},
  window: {}
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(source, ctx);

(async () => {
  const normalized = ctx.memoryPrefsNormalize({
    speed: 8,
    fixedRate: 0.1,
    gap: -1,
    loop: 'bad',
    voice: 'bad',
    model: 'bad'
  });
  assert.equal(normalized.speed, 1.2);
  assert.equal(normalized.fixedRate, 0.3);
  assert.equal(normalized.gap, 0);
  assert.equal(normalized.loop, 'off');
  assert.equal(normalized.voice, 'marin');
  assert.equal(normalized.model, 'gpt-realtime-2.1-mini');
  const realtimeModels = [
    'gpt-realtime-2.1-mini',
    'gpt-realtime-2.1',
    'gpt-realtime-2',
    'gpt-realtime-1.5',
    'gpt-realtime',
    'gpt-realtime-mini'
  ];
  const speechModels = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];
  for (const model of [...realtimeModels, ...speechModels]) {
    const voices = ctx.memoryVoicesForModel(model);
    assert.equal(voices.length, model === 'gpt-4o-mini-tts' ? 13 : realtimeModels.includes(model) ? 10 : 9);
    for (const voice of voices) {
      const selected = ctx.memoryPrefsNormalize({ model, voice, ttsVoiceURI: 'synthetic-installed-voice' });
      assert.equal(selected.model, model);
      assert.equal(selected.voice, voice);
      assert.equal(selected.ttsVoiceURI, 'synthetic-installed-voice');
    }
  }
  assert.equal(ctx.memoryPrefsNormalize({ model: 'gpt-realtime-2.1', voice: 'nova' }).voice, 'marin');
  assert.equal(ctx.memoryPrefsNormalize({ model: 'tts-1', voice: 'cedar' }).voice, 'alloy');
  assert.equal(ctx.memoryPrefsNormalize({ model: 'gpt-4o-mini-tts', voice: 'nova' }).voice, 'nova');
  assert.equal(ctx.memoryPrefsNormalize({ model: 'gpt-4o-mini-tts', voice: 'cedar' }).voice, 'cedar');
  assert.equal(ctx.memoryPrefsNormalize({ model: 'gpt-realtime-2.1-mini', voice: 'coral' }).voice, 'coral');
  // Cache identity excludes speed, gap, title, check state and loop mode.
  const segment = { text: 'テスト' };
  const id = await ctx.memoryClipId(segment, prefs);
  assert.equal(id, await ctx.memoryClipId(segment, { ...prefs, speed: 0.5, gap: 9, loop: '30' }));
  assert.notEqual(id, await ctx.memoryClipId({ text: '変更' }, prefs));
  assert.notEqual(id, await ctx.memoryClipId(segment, { ...prefs, voice: 'cedar' }));
  assert.notEqual(id, await ctx.memoryClipId(segment, { ...prefs, model: 'gpt-4o-mini-tts' }));
  // A .5x player needs .5 seconds of encoded silence for one second of wall-clock gap.
  const clips = [{ pcm: new Blob([new Uint8Array([1, 2, 3, 4])]) }, { pcm: new Blob([new Uint8Array([5, 6])]) }];
  const plan = { prefs: { ...prefs, fixed: true, fixedRate: 0.5, loop: '30' }, segments: [{ line: 0 }, { line: 2 }] };
  const wave = ctx.memoryBuildWave(plan, clips);
  const bytes = await wave.arrayBuffer(),
    view = new DataView(bytes),
    array = new Uint8Array(bytes);
  assert.equal(Buffer.from(array.slice(0, 4)).toString(), 'RIFF');
  assert.equal(Buffer.from(array.slice(8, 12)).toString(), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(34, true), 16);
  const onePassBytes = 6 + 48000 + 24000; // two blank-line intervals plus a loop boundary
  assert.equal(bytes.byteLength, 44 + onePassBytes * 30);
  assert.equal(view.getUint32(40, true), onePassBytes * 30);
  assert.deepEqual([...array.slice(44, 48)], [1, 2, 3, 4]);
  assert.equal(array[48], 0);
  assert.deepEqual([...array.slice(48 + 48000, 48 + 48000 + 2)], [5, 6]);
  assert.deepEqual([...array.slice(44 + onePassBytes, 48 + onePassBytes)], [1, 2, 3, 4]);
  assert.throws(() => ctx.memoryWave([{ size: 0xffffffff }], 30), /長すぎ/);
  const noGap = ctx.memoryBuildWave({ ...plan, prefs: { ...prefs, gap: 0, loop: 'infinite' } }, clips);
  assert.equal(noGap.size, 50, 'infinite uses native audio.loop on a single pass');
  // PCM REST requests use only the intended destination and a user-supplied key.
  let requests = [];
  ctx.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, blob: async () => new Blob([new Uint8Array([1, 2])]) };
  };
  const signal = new AbortController().signal;
  const pcm = await ctx.memoryGenerateClip('本文', { ...prefs, model: 'gpt-4o-mini-tts' }, 'synthetic-key', signal);
  assert.equal(pcm.size, 2);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-key');
  assert.equal(JSON.parse(requests[0].options.body).response_format, 'pcm');
  assert.equal(JSON.parse(requests[0].options.body).input, '本文');
  assert(!JSON.parse(requests[0].options.body).speed, 'speed is applied locally without another generation');
  for (const model of speechModels) {
    for (const voice of ctx.memoryVoicesForModel(model)) {
      const generated = await ctx.memoryGenerateClip('本文', { ...prefs, model, voice }, 'synthetic-key', signal);
      assert.equal(generated.size, 2);
      const request = requests.at(-1),
        body = JSON.parse(request.options.body);
      assert.equal(request.url, 'https://api.openai.com/v1/audio/speech');
      assert.equal(body.model, model);
      assert.equal(body.voice, voice);
      assert.equal(
        'instructions' in body,
        model === 'gpt-4o-mini-tts',
        'classic TTS must not receive unsupported instructions'
      );
    }
  }
  const validRequestCount = requests.length;
  await assert.rejects(
    ctx.memoryGenerateClip('本文', { ...prefs, model: 'tts-1', voice: 'marin' }, 'synthetic-key', signal),
    /組み合わせ/
  );
  await assert.rejects(
    ctx.memoryGenerateClip('本文', { ...prefs, model: 'gpt-realtime-2.1', voice: 'nova' }, 'synthetic-key', signal),
    /組み合わせ/
  );
  await assert.rejects(
    ctx.memoryGenerateClip('本文', { ...prefs, model: 'unknown-model' }, 'synthetic-key', signal),
    /組み合わせ/
  );
  assert.equal(requests.length, validRequestCount, 'unsupported choices never spend an API request');
  ctx.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(
    ctx.memoryGenerateClip('本文', { ...prefs, model: 'gpt-4o-mini-tts' }, 'synthetic-key', signal),
    /キー/
  );
  ctx.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(
    ctx.memoryGenerateClip('本文', { ...prefs, model: 'gpt-4o-mini-tts' }, 'synthetic-key', signal),
    /利用上限/
  );
  // Realtime uses a short-lived credential, waits for configuration, and saves only audio bytes.
  let socket,
    sent = [],
    expectedRealtimeModel = prefs.model;
  ctx.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/realtime/client_secrets');
    assert.equal(JSON.parse(options.body).session.model, expectedRealtimeModel);
    return { ok: true, json: async () => ({ value: 'synthetic-short-lived' }) };
  };
  ctx.WebSocket = class {
    constructor(url, protocols) {
      socket = this;
      assert.equal(url, 'wss://api.openai.com/v1/realtime?model=' + expectedRealtimeModel);
      assert.equal(protocols[1], 'openai-insecure-api-key.synthetic-short-lived');
      queueMicrotask(() => this.emit({ type: 'session.created' }));
    }
    emit(event) {
      this.onmessage({ data: JSON.stringify(event) });
    }
    send(data) {
      const event = JSON.parse(data);
      sent.push(event);
      if (event.type === 'session.update') queueMicrotask(() => this.emit({ type: 'session.updated' }));
      if (event.type === 'response.create')
        queueMicrotask(() => {
          this.emit({ type: 'response.output_audio.delta', delta: 'AQID' });
          this.emit({ type: 'response.output_audio.delta', delta: 'BA==' });
          this.emit({ type: 'response.done', response: { status: 'completed' } });
        });
    }
    close() {
      this.closed = true;
    }
  };
  const generated = await ctx.memoryGenerateClip('一語ずつ読む', prefs, 'synthetic-key', signal);
  assert.equal(socket.closed, true);
  assert.deepEqual([...new Uint8Array(await generated.arrayBuffer())], [1, 2, 3, 4]);
  assert.deepEqual(
    sent.map((x) => x.type),
    ['session.update', 'conversation.item.create', 'response.create']
  );
  assert.equal(sent[0].session.audio.output.format.rate, 24000);
  assert.equal(sent[0].session.audio.input.turn_detection, null);
  assert.equal(sent[1].item.content[0].text, '一語ずつ読む');
  for (const model of realtimeModels) {
    for (const voice of ctx.memoryVoicesForModel(model)) {
      expectedRealtimeModel = model;
      sent = [];
      const clip = await ctx.memoryGenerateClip('本文', { ...prefs, model, voice }, 'synthetic-key', signal);
      assert.equal(clip.size, 4);
      assert.equal(sent[0].session.audio.output.voice, voice);
      assert.equal(socket.closed, true);
    }
  }
  expectedRealtimeModel = prefs.model;
  // An incomplete response is rejected instead of caching a truncated memorization passage.
  ctx.WebSocket.prototype.send = function (data) {
    const event = JSON.parse(data);
    if (event.type === 'session.update') queueMicrotask(() => this.emit({ type: 'session.updated' }));
    if (event.type === 'response.create')
      queueMicrotask(() => this.emit({ type: 'response.done', response: { status: 'incomplete' } }));
  };
  await assert.rejects(ctx.memoryGenerateClip('本文', prefs, 'synthetic-key', signal), /最後まで/);
  // Aborting immediately closes the socket; errors never expose the stored key.
  ctx.WebSocket.prototype.send = function () {};
  const controller = new AbortController();
  const pending = ctx.memoryGenerateClip('本文', prefs, 'synthetic-key', controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (e) => e.name === 'AbortError');
  assert.equal(socket.closed, true);
  storage.set('rvt_memory_openai_key_v1', 'synthetic-secret');
  assert(!ctx.memoryError(Error('failure synthetic-secret')).includes('synthetic-secret'));
  assert.match(ctx.memoryError({ name: 'QuotaExceededError', message: '' }), /保存容量/);
  assert(html.includes("key:''  /* 公開リポジトリ"));
  assert(fs.existsSync('.nojekyll'));
  assert(!/\b(?:alert|prompt|confirm)\s*\(/.test(source));
  console.log(
    'PASS: memory settings, stable cache identity, exact WAV/gaps/repeat, RIFF limits, PCM REST, Realtime protocol/auth/order/PCM/completion/cancellation, quota and secret handling'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
