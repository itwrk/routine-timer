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
  getOpenAIKey: () => storage.get('test-openai-common-key') || '',
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
  assert.equal(normalized.echo, false);
  assert.equal(normalized.echoAmount, .3);
  assert.equal(ctx.memoryPrefsNormalize({echo:true,echoAmount:9}).echoAmount,.6);
  assert.equal(ctx.memoryPrefsNormalize({echo:'true',echoAmount:-1}).echo,false);
  assert.equal(ctx.memoryPrefsNormalize({echoAmount:-1}).echoAmount,.1);
  assert.equal(ctx.memoryPrefsNormalize({echoAmount:'bad'}).echoAmount,.3);
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
  for (const model of [...realtimeModels, 'gpt-4o-mini-tts']) assert.equal(ctx.memoryModelSupportsTone(model), true);
  for (const model of ['tts-1', 'tts-1-hd', 'unknown']) assert.equal(ctx.memoryModelSupportsTone(model), false);
  assert.equal(ctx.memoryPrefsNormalize({ tone: '  明るく\r\n親しみやすく  ' }).tone, '明るく\n親しみやすく');
  assert.equal(ctx.memoryPrefsNormalize({ tone: '声'.repeat(2000) }).tone.length, 1000);
  assert.equal(ctx.memoryPrefsNormalize({ model: 'tts-1', tone: '保存した話し方' }).tone, '保存した話し方');
  // Cache identity excludes speed, gap, title, check state and loop mode.
  const segment = { text: 'テスト' };
  const id = await ctx.memoryClipId(segment, prefs);
  assert.equal(id, await ctx.memoryClipId(segment, { ...prefs, speed: 0.5, gap: 9, loop: '30' }));
  assert.equal(id, await ctx.memoryClipId(segment, { ...prefs, echo:true,echoAmount:.6 }), 'echo is local playback processing, not another paid voice');
  assert.notEqual(id, await ctx.memoryClipId({ text: '変更' }, prefs));
  assert.notEqual(id, await ctx.memoryClipId(segment, { ...prefs, voice: 'cedar' }));
  assert.notEqual(id, await ctx.memoryClipId(segment, { ...prefs, model: 'gpt-4o-mini-tts' }));
  const oldIdentity = JSON.stringify(['memory-pcm-v1', prefs.model, prefs.voice, segment.text]);
  const oldDigest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(oldIdentity));
  assert.equal(id, Buffer.from(oldDigest).toString('hex'), 'empty tone reuses audio saved by previous releases');
  assert.notEqual(id, await ctx.memoryClipId(segment, { ...prefs, tone: '明るく' }));
  assert.notEqual(
    await ctx.memoryClipId(segment, { ...prefs, tone: '明るく' }),
    await ctx.memoryClipId(segment, { ...prefs, tone: '落ち着いて' })
  );
  assert.equal(
    await ctx.memoryClipId(segment, { ...prefs, tone: ' 明るく ' }),
    await ctx.memoryClipId(segment, { ...prefs, tone: '明るく' })
  );
  const classicPrefs = { ...prefs, model: 'tts-1', voice: 'alloy' };
  assert.equal(
    await ctx.memoryClipId(segment, classicPrefs),
    await ctx.memoryClipId(segment, { ...classicPrefs, tone: '無視される指定' })
  );
  // Line identity never includes its position. Duplicate/reordered/marked lines spend no new generation.
  const originalStore=ctx.memoryStore,originalGenerator=ctx.memoryGenerateClip,lineCache=new Map(),generatedLines=[];
  ctx.memoryStore=async(store,method,value)=>method==='get'?lineCache.get(value):(lineCache.set(value.id,value),value);
  ctx.memoryGenerateClip=async(text)=>{generatedLines.push(text);return new Blob([new Uint8Array([1,2])]);};
  const lineSignal=new AbortController().signal;
  for(const text of ['一行目','二行目'])await ctx.memoryResolveLineClip({text,line:0},prefs,'synthetic-key',lineSignal);
  for(const [line,text] of ['二行目','一行目','一行目'].entries())assert((await ctx.memoryResolveLineClip({text,line},prefs,'synthetic-key',lineSignal)).reused);
  assert.deepEqual(generatedLines,['一行目','二行目']);
  await ctx.memoryResolveLineClip({text:'変更した行',line:1},prefs,'synthetic-key',lineSignal);assert.equal(generatedLines.length,3);
  assert.equal(await ctx.memoryResolveLineClip({text:'未生成の行',line:9},prefs),null,'playback never invokes generation');
  assert.equal(generatedLines.length,3);
  const longText='長い文章。'.repeat(180),oldChunks=ctx.memoryAudioChunks(longText);
  assert(oldChunks.length>1);assert(oldChunks.every(text=>Array.from(text).length<=400));assert.equal(oldChunks.join(''),longText);
  for(const text of oldChunks){const id=await ctx.memoryClipId({text},prefs);lineCache.set(id,{id,pcm:new Blob([new Uint8Array([5,6])])});}
  const migrated=await ctx.memoryResolveLineClip({text:longText,line:20},prefs);
  assert(migrated.reused);assert.equal(migrated.clip.pcm.size,oldChunks.length*2);assert.equal(generatedLines.length,3,'old chunks combine into a reusable line without an API request');
  ctx.memoryStore=originalStore;ctx.memoryGenerateClip=originalGenerator;
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
  // Echo is deterministic local PCM processing; the native WAV transport stays the same.
  assert.deepEqual(new Uint8Array(await (await ctx.memoryPlaybackWave(plan,clips)).arrayBuffer()),new Uint8Array(bytes),'echo off is byte-for-byte identical');
  const impulseBytes=new Uint8Array(9600*2),impulseView=new DataView(impulseBytes.buffer);
  impulseView.setInt16(0,30000,true);impulseView.setInt16(impulseBytes.length-2,30000,true);
  const impulseClip={pcm:new Blob([impulseBytes])},echoPlan={prefs:{...prefs,gap:0,loop:'off',echo:true,echoAmount:.3},segments:[{line:0}]};
  const echoed=await ctx.memoryPlaybackWave(echoPlan,[impulseClip]),echoBytes=await echoed.arrayBuffer(),echoView=new DataView(echoBytes),delay=5280,normalizer=1+.3+.09+.027;
  assert.equal(echoed.size,44+(9600+delay*3)*2);
  assert.equal(echoView.getUint32(4,true),echoed.size-8);
  assert.equal(echoView.getUint32(40,true),echoed.size-44,'the WAV header must include every processed byte');
  for(let tap=0;tap<4;tap++)assert.equal(echoView.getInt16(44+delay*tap*2,true),Math.round(30000*(.3**tap)/normalizer));
  assert.equal(echoView.getInt16(echoBytes.byteLength-2,true),Math.round(30000*.027/normalizer),'the last word keeps its complete echo tail');
  assert.deepEqual(new Uint8Array(await impulseClip.pcm.arrayBuffer()),impulseBytes,'never alter cached original audio');
  const slowEcho=await ctx.memoryPlaybackWave({...echoPlan,prefs:{...echoPlan.prefs,fixed:true,fixedRate:.5}},[impulseClip]);
  assert.equal(new DataView(await slowEcho.arrayBuffer()).getInt16(44+2640*2,true),Math.round(30000*.3/normalizer),'delay stays 220ms in wall-clock time at .5x');
  const loopEchoPlan={...echoPlan,prefs:{...echoPlan.prefs,loop:'30',gap:1}},loopEcho=await ctx.memoryPlaybackWave(loopEchoPlan,[impulseClip]);
  assert.equal(loopEcho.size,44+(9600+24000)*2*30,'existing loop gap absorbs the echo tail without extending each repetition');
  const loopEchoArray=new Uint8Array(await loopEcho.arrayBuffer());assert.deepEqual(loopEchoArray.slice(44,44+67200),loopEchoArray.slice(44+67200,44+134400));
  const crossing=new Uint8Array(70000*2);new DataView(crossing.buffer).setInt16(65535*2,20000,true);
  const across=await ctx.memoryPlaybackWave(echoPlan,[{pcm:new Blob([crossing])}]);
  assert.equal(new DataView(await across.arrayBuffer()).getInt16(44+(65535+delay)*2,true),Math.round(20000*.3/normalizer),'echo survives processing-block boundaries');
  const fullScale=new Uint8Array(30000*2),fullView=new DataView(fullScale.buffer);for(let i=0;i<30000;i++)fullView.setInt16(i*2,32767,true);
  const fullEcho=await ctx.memoryPlaybackWave(echoPlan,[{pcm:new Blob([fullScale])}]);
  assert.equal(new DataView(await fullEcho.arrayBuffer()).getInt16(44+20000*2,true),32767,'overlapping taps cannot overflow PCM');
  let currentChecks=0;await assert.rejects(ctx.memoryPlaybackWave(echoPlan,[impulseClip],()=>++currentChecks<2),e=>e.name==='AbortError');
  const prepared=(seconds,loop='off')=>({blob:{size:44+seconds*48000},plan:{prefs:{loop}}});
  assert.equal(ctx.memoryEchoPosition(prepared(150,'30'),prepared(169.8,'30'),12),13.32);
  assert.equal(ctx.memoryEchoPosition(prepared(5),prepared(5.66),2),2);
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
  const requestedTone = 'ささやくように、穏やかで親しみやすく。';
  await ctx.memoryGenerateClip(
    '本文',
    { ...prefs, model: 'gpt-4o-mini-tts', voice: 'nova', tone: requestedTone },
    'synthetic-key',
    signal
  );
  const tonedRequest = JSON.parse(requests.at(-1).options.body);
  assert(tonedRequest.instructions.includes(requestedTone));
  assert(tonedRequest.instructions.includes('Do not add, omit, or summarize'));
  assert.equal(tonedRequest.input, '本文', 'tone is delivery guidance, never added to the spoken text');
  await ctx.memoryGenerateClip('本文', { ...classicPrefs, tone: requestedTone }, 'synthetic-key', signal);
  assert(!('instructions' in JSON.parse(requests.at(-1).options.body)));
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
  sent = [];
  await ctx.memoryGenerateClip('本文', { ...prefs, tone: requestedTone }, 'synthetic-key', signal);
  assert(sent[0].session.instructions.includes(requestedTone));
  assert(sent[0].session.instructions.includes('Read the entire user text verbatim'));
  assert.equal(sent[1].item.content[0].text, '本文');
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
  storage.set('test-openai-common-key', 'synthetic-secret');
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
