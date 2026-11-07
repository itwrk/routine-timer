const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('memory-drive.gs','utf8');
const props=new Map([['SECRET','synthetic-sync-key']]),files=new Map(),sessions=new Map();
let calls=0,starts=0,wrongFolder=false,corrupt=false,locked=false;
const reply=(code,data={},headers={})=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(data),getAllHeaders:()=>headers});
const ctx={console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)})},LockService:{getScriptLock:()=>({tryLock(){locked=true;return true},hasLock:()=>locked,releaseLock(){locked=false}})},ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this}})},ScriptApp:{getOAuthToken:()=> 'synthetic-oauth-token'},Utilities:{base64Decode:s=>[...Buffer.from(s,'base64')]},UrlFetchApp:{fetch(url,options){
  calls++;assert.equal(options.headers.Authorization,'Bearer synthetic-oauth-token');assert.equal(options.followRedirects,false);
  const parsed=new URL(url),query=parsed.searchParams;
  if(parsed.pathname==='/upload/drive/v3/files'&&options.method==='post'){
    assert.equal(query.get('supportsAllDrives'),'true');const id='session-'+(++starts),metadata=JSON.parse(options.payload);sessions.set(id,{metadata,bytes:Buffer.alloc(0),total:Number(options.headers['X-Upload-Content-Length'])});return reply(200,{}, {Location:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id='+id});
  }
  if(parsed.pathname==='/upload/drive/v3/files'){
    const id=query.get('upload_id'),session=sessions.get(id);if(!session)return reply(404);
    const range=options.headers['Content-Range'];
    if(!range.startsWith('bytes */')){const match=range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);assert(match);assert.equal(Number(match[1]),session.bytes.length);session.bytes=Buffer.concat([session.bytes,Buffer.from(options.payload)]);assert.equal(session.bytes.length,Number(match[2])+1);}
    if(session.bytes.length===session.total){const fid='file-'+id;files.set(fid,{...session.metadata,id:fid,size:String(session.total),webViewLink:'https://drive.google.com/file/d/'+fid+'/view',driveId:ctx.RVT_MEMORY_DRIVE_ID,trashed:false});return reply(200,{id:fid});}
    return reply(308,{},session.bytes.length?{Range:'bytes=0-'+(session.bytes.length-1)}:{});
  }
  assert.equal(query.get('supportsAllDrives'),'true');
  if(parsed.pathname==='/drive/v3/files'){
    assert(query.get('q').includes(ctx.RVT_MEMORY_FOLDER_ID));return reply(200,{files:[...files.values()].filter(x=>query.get('q').includes(x.appProperties.rvtMemoryAudio)).map(x=>({id:x.id}))});
  }
  const id=parsed.pathname.split('/').pop();
  if(id===ctx.RVT_MEMORY_FOLDER_ID)return reply(200,{id,name:'暗記音声',mimeType:'application/vnd.google-apps.folder',driveId:wrongFolder?'another-drive':ctx.RVT_MEMORY_DRIVE_ID,capabilities:{canAddChildren:true}});
  const file=files.get(id);return file?reply(200,{...file,size:corrupt?'0':file.size}):reply(404);
}}};
vm.createContext(ctx);vm.runInContext(source,ctx);
const post=data=>JSON.parse(ctx.rvtMemoryPost({postData:{contents:JSON.stringify({key:'synthetic-sync-key',...data})}}).text);
assert.equal(ctx.rvtMemoryPost({postData:{contents:'{"action":"oldSync"}'}}),null);
assert.equal(post({action:'rvtMemoryStatus',key:'wrong'}).error,'unauthorized');assert.equal(calls,0,'authorize before any Drive calls');
assert.equal(post({action:'rvtMemoryStatus'}).folderId,ctx.RVT_MEMORY_FOLDER_ID);
const audioId='a'.repeat(64),bytes=1048576+444,meta={action:'rvtMemoryStart',audioId,bytes,name:'test/audio.wav',model:'tts-1',voice:'alloy'};
assert.equal(post({...meta,bytes:-1}).error,'invalid_input');assert.equal(post({...meta,audioId:'invalid'}).error,'invalid_input');
let state=post(meta);assert.equal(state.offset,0);assert.equal(starts,1);
const pcm=Buffer.alloc(bytes);pcm.write('RIFF');pcm.write('WAVE',8);
assert.equal(post({action:'rvtMemoryChunk',audioId,offset:0,base64:Buffer.alloc(100).toString('base64')}).error,'invalid_input');
assert.equal(post({action:'rvtMemoryChunk',audioId,offset:0,base64:pcm.subarray(0,100).toString('base64')}).error,'invalid_input','nonfinal chunks must align');
state=post({action:'rvtMemoryChunk',audioId,offset:0,base64:pcm.subarray(0,1048576).toString('base64')});assert.equal(state.offset,1048576);
state=post(meta);assert.equal(state.offset,1048576);assert.equal(starts,1,'resume an existing session');
state=post({action:'rvtMemoryChunk',audioId,offset:0,base64:pcm.subarray(0,1048576).toString('base64')});assert.equal(state.offset,1048576,'uncertain old chunk is not duplicated');
state=post({action:'rvtMemoryChunk',audioId,offset:1048576,base64:pcm.subarray(1048576).toString('base64')});assert.equal(state.done,true);assert.equal(state.offset,bytes);assert(state.url.startsWith('https://drive.google.com/file/d/'));assert(!JSON.stringify(state).includes('synthetic'));
assert.deepEqual(sessions.get('session-1').bytes,pcm);assert.equal(props.has('RVT_MEMORY_UPLOAD_'+audioId),false);
assert.equal(post(meta).done,true);assert.equal(starts,1,'completed archives are reused');
corrupt=true;assert.equal(post(meta).error,'verify_failed');corrupt=false;
wrongFolder=true;assert.equal(post({action:'rvtMemoryStatus'}).error,'wrong_folder');wrongFolder=false;
assert.throws(()=>ctx.rvtMemoryFetch_('https://example.com/steal',{}),/invalid_input/);assert.equal(locked,false);
console.log('PASS: auth and folder boundaries, WAV/alignment limits, resumable chunks, uncertain retry, byte integrity, deduplication, API readback, metadata mismatch, credential-safe responses');
