/** Add to the existing sync GAS; call rvtMemoryPost(e) first in doPost(e).
 * Only this shared-drive folder is writable. No OpenAI key is accepted or stored.
 * Resumable upload URLs remain in Script Properties, never in browser responses.
 */
var RVT_MEMORY_FOLDER_ID = '1YK8MHPtLHzZ-s3e7DquGTsSesCSvPX9U';
var RVT_MEMORY_DRIVE_ID = '0AHQDfpv9WillUk9PVA';
function rvtMemoryCheckSetup() {
  var folder = rvtMemoryFolder_();
  console.log('Memory audio folder ready: '+folder.name+' ('+folder.id+'). No files created.');
}
function rvtMemoryPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (_) { return null; }
  if (!data || ['rvtMemoryStatus','rvtMemoryStart','rvtMemoryChunk'].indexOf(data.action)<0) return null;
  var value, lock;
  try {
    var expected = PropertiesService.getScriptProperties().getProperty('SECRET') || (typeof SECRET==='string' ? SECRET : '');
    if (!expected || !data.key || data.key!==expected) throw Error('unauthorized');
    var folder = rvtMemoryFolder_();
    if (data.action==='rvtMemoryStatus') value={folderId:folder.id,folderName:folder.name};
    else {
      lock=LockService.getScriptLock();
      if (!lock.tryLock(10000)) throw Error('busy');
      if (!/^[a-f0-9]{64}$/.test(data.audioId||'')) throw Error('invalid_input');
      value=data.action==='rvtMemoryStart' ? rvtMemoryStart_(data,folder) : rvtMemoryChunk_(data,folder);
    }
    value=Object.assign({ok:true,memoryDriveVersion:1},value);
  } catch (error) {
    var code=String(error.message||'drive_error');
    var messages={unauthorized:'同期の合言葉を確認してください。',busy:'別の保存を処理中です。少し待って再試行してください。',invalid_input:'音声の保存データを確認してください。',wrong_folder:'保存先は指定の共有ドライブ内に限定されています。',folder_unavailable:'GASのアカウントで暗記音声フォルダを読み書きできません。',expired:'保存の接続が期限切れです。再試行してください。',verify_failed:'共有ドライブの保存結果を確認できませんでした。再試行してください。'};
    value={ok:false,memoryDriveVersion:1,error:messages[code]?code:'drive_error',message:messages[code]||'Driveに保存できませんでした。端末の音声は残っています。通信とGASの権限を確認して再試行してください。'};
  } finally { if (lock && lock.hasLock()) lock.releaseLock(); }
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function rvtMemoryFetch_(url,options) {
  if (!/^https:\/\/www\.googleapis\.com\/(?:drive\/v3\/|upload\/drive\/v3\/files\?)/.test(url)) throw Error('invalid_input');
  options=Object.assign({muteHttpExceptions:true,followRedirects:false},options||{});
  options.headers=Object.assign({},options.headers||{},{Authorization:'Bearer '+ScriptApp.getOAuthToken()});
  return UrlFetchApp.fetch(url,options);
}
function rvtMemoryApi_(path,options) {
  var response=rvtMemoryFetch_('https://www.googleapis.com/drive/v3/'+path,options);
  if (response.getResponseCode()<200 || response.getResponseCode()>=300) throw Error('drive_error');
  return JSON.parse(response.getContentText());
}
function rvtMemoryFolder_() {
  var folder;
  try { folder=rvtMemoryApi_('files/'+RVT_MEMORY_FOLDER_ID+'?supportsAllDrives=true&fields=id,name,mimeType,driveId,trashed,capabilities(canAddChildren)'); }
  catch (_) { throw Error('folder_unavailable'); }
  if (folder.trashed || folder.mimeType!=='application/vnd.google-apps.folder' || folder.driveId!==RVT_MEMORY_DRIVE_ID) throw Error('wrong_folder');
  if (!folder.capabilities || !folder.capabilities.canAddChildren) throw Error('folder_unavailable');
  return folder;
}
function rvtMemoryVerify_(fileId,audioId,bytes,folder) {
  if (!/^[\w-]+$/.test(fileId||'')) throw Error('verify_failed');
  var file=rvtMemoryApi_('files/'+fileId+'?supportsAllDrives=true&fields=id,name,size,parents,driveId,trashed,webViewLink,appProperties');
  if (file.trashed || file.driveId!==RVT_MEMORY_DRIVE_ID || (file.parents||[]).indexOf(folder.id)<0 || Number(file.size)!==bytes || (file.appProperties||{}).rvtMemoryAudio!==audioId || !/^https:\/\/drive\.google\.com\//.test(file.webViewLink||'')) throw Error('verify_failed');
  return {done:true,offset:bytes,fileId:file.id,name:file.name,url:file.webViewLink};
}
function rvtMemoryProgress_(response,state,audioId,folder) {
  var code=response.getResponseCode();
  if (code===200 || code===201) {
    var file=JSON.parse(response.getContentText());
    var done=rvtMemoryVerify_(file.id,audioId,state.bytes,folder);
    PropertiesService.getScriptProperties().deleteProperty('RVT_MEMORY_UPLOAD_'+audioId);
    return done;
  }
  if (code===404 || code===410) throw Error('expired');
  if (code!==308) throw Error('drive_error');
  var headers=response.getAllHeaders(),range=headers.Range||headers.range||'',match=String(range).match(/^bytes=0-(\d+)$/);
  return {done:false,offset:match?Number(match[1])+1:0};
}
function rvtMemoryStart_(data,folder) {
  if (!Number.isInteger(data.bytes) || data.bytes<44 || data.bytes>250*1024*1024) throw Error('invalid_input');
  var props=PropertiesService.getScriptProperties(),prop='RVT_MEMORY_UPLOAD_'+data.audioId;
  var query="'"+folder.id+"' in parents and trashed=false and appProperties has { key='rvtMemoryAudio' and value='"+data.audioId+"' }";
  var existing=rvtMemoryApi_('files?corpora=drive&driveId='+RVT_MEMORY_DRIVE_ID+'&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=2&fields=files(id)&q='+encodeURIComponent(query)).files||[];
  if (existing.length) return rvtMemoryVerify_(existing[0].id,data.audioId,data.bytes,folder);
  var state;
  try { state=JSON.parse(props.getProperty(prop)||'null'); } catch (_) {}
  if (state && state.bytes===data.bytes && Date.now()-state.at<6*86400000) {
    try { return rvtMemoryProgress_(rvtMemoryFetch_(state.url,{method:'put',headers:{'Content-Range':'bytes */'+state.bytes},payload:''}),state,data.audioId,folder); }
    catch (error) { if (error.message!=='expired') throw error; }
  }
  var name=String(data.name||'暗記音声.wav').replace(/[\u0000-\u001f\\/]/g,'_').slice(0,180);
  if (!/\.wav$/i.test(name)) name+='.wav';
  var response=rvtMemoryFetch_('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id',{
    method:'post',contentType:'application/json',headers:{'X-Upload-Content-Type':'audio/wav','X-Upload-Content-Length':String(data.bytes)},
    payload:JSON.stringify({name:name,mimeType:'audio/wav',parents:[folder.id],appProperties:{rvtMemoryAudio:data.audioId,model:String(data.model||'').slice(0,80),voice:String(data.voice||'').slice(0,30)}})
  });
  if (response.getResponseCode()!==200) throw Error('drive_error');
  var headers=response.getAllHeaders(),url=String(headers.Location||headers.location||'');
  if (!/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(url)) throw Error('drive_error');
  // Expired sessions have no completed file. Remove only our old session properties.
  var all=props.getProperties();
  Object.keys(all).filter(function(key){return key.indexOf('RVT_MEMORY_UPLOAD_')===0;}).forEach(function(key){try{if(Date.now()-JSON.parse(all[key]).at>=6*86400000)props.deleteProperty(key);}catch(_){}});
  props.setProperty(prop,JSON.stringify({url:url,bytes:data.bytes,at:Date.now()}));
  return {done:false,offset:0};
}
function rvtMemoryChunk_(data,folder) {
  var state=JSON.parse(PropertiesService.getScriptProperties().getProperty('RVT_MEMORY_UPLOAD_'+data.audioId)||'null');
  if (!state) throw Error('expired');
  if (!Number.isInteger(data.offset) || data.offset<0 || typeof data.base64!=='string' || data.base64.length>1400000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) throw Error('invalid_input');
  var progress=rvtMemoryProgress_(rvtMemoryFetch_(state.url,{method:'put',headers:{'Content-Range':'bytes */'+state.bytes},payload:''}),state,data.audioId,folder);
  if (progress.done || progress.offset!==data.offset) return progress;
  var bytes=Utilities.base64Decode(data.base64),end=data.offset+bytes.length;
  if (!bytes.length || bytes.length>1048576 || end>state.bytes || (end<state.bytes && bytes.length%262144!==0)) throw Error('invalid_input');
  if (data.offset===0 && (bytes[0]!==82 || bytes[1]!==73 || bytes[2]!==70 || bytes[3]!==70 || bytes[8]!==87 || bytes[9]!==65 || bytes[10]!==86 || bytes[11]!==69)) throw Error('invalid_input');
  return rvtMemoryProgress_(rvtMemoryFetch_(state.url,{method:'put',contentType:'audio/wav',headers:{'Content-Range':'bytes '+data.offset+'-'+(end-1)+'/'+state.bytes},payload:bytes}),state,data.audioId,folder);
}
