const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const source=html.slice(html.indexOf('/* ============ AI comments on saved records ============ */'),html.indexOf('/* ============ UI helpers ============ */'));
function element(){return {children:[],attributes:{},textContent:'',set innerHTML(value){this.children=[]},append(...items){this.children.push(...items)},appendChild(item){this.children.push(item)},setAttribute(key,value){this.attributes[key]=value}};}
const nodes=Object.fromEntries(['aiCommentGenerate','aiCommentStatus','aiCommentResult'].map(id=>[id,element()]));
const state={settings:{apiKey:'synthetic-key',aiCommentDays:30,aiCommentMeals:false,aiCommentNotion:false},aiComments:[],simpleNotes:[],activityPages:[],boredomLogs:[],journeyLogs:[]};
let calls=0,loads=0,resolveRequest,rows=[{stamp:Date.now()-1000,type:'メモ',content:'朝の準備ができた'}];
const ctx={D:state,document:{getElementById:id=>nodes[id]||null,createElement:element},liveLogs:a=>a||[],safeNotionUrl:()=>'',notionCommentSaving:null,notionAiContext:null,notionBridgeSignature:()=>'',chatgptTimelineRows:()=>[...rows],timelineDateTime:stamp=>new Date(stamp).toISOString(),uid:()=>`comment-${calls}`,save(){},aiErrorMessage:e=>e.message,aiRequest:async()=>{calls++;return new Promise(resolve=>{resolveRequest=resolve})},loadNotionAiRecords:async()=>{loads++}};
vm.createContext(ctx);vm.runInContext(source,ctx);
(async()=>{
// Real render must work with only a generate button, status, and result nodes.
ctx.renderAiComment();assert.equal(nodes.aiCommentGenerate.disabled,false);assert.equal(nodes.aiCommentResult.children.length,0);
const pending=ctx.generateAiComment();assert.equal(calls,1);assert.equal(nodes.aiCommentGenerate.disabled,true);assert.equal(nodes.aiCommentGenerate.attributes['aria-busy'],'true');
await ctx.generateAiComment();assert.equal(calls,1,'repeated clicks cannot start parallel requests');
resolveRequest('ひとつずつ進められています。');await pending;
assert.equal(state.aiComments.length,1);assert.equal(nodes.aiCommentGenerate.disabled,false);assert.equal(nodes.aiCommentResult.children[1].textContent,'ひとつずつ進められています。');
// Notion material loads automatically as part of the same action.
state.settings.aiCommentNotion=true;const withNotion=ctx.generateAiComment();await new Promise(resolve=>setImmediate(resolve));assert.equal(loads,1);assert.equal(calls,2);resolveRequest('Notionの記録も読みました。');await withNotion;assert.equal(state.aiComments.length,2);
// A loading error restores the button and keeps the previous comment.
ctx.loadNotionAiRecords=async()=>{throw Error('読み込み失敗')};await ctx.generateAiComment();assert.equal(calls,2);assert.equal(state.aiComments.length,2);assert.equal(nodes.aiCommentGenerate.disabled,false);assert(nodes.aiCommentStatus.textContent.includes('読み込み失敗'));
state.settings.aiCommentNotion=false;rows=[];await ctx.generateAiComment();assert.equal(calls,2);assert(nodes.aiCommentStatus.textContent.includes('この期間には記録がありません'));
assert(!html.includes('送信する記録を確認'));assert(!html.includes('id="notionAiLoad"'));
console.log('PASS: minimal AI UI renders, one-action generation, duplicate-click guard, automatic Notion loading, loading failures and empty records');
})().catch(error=>{console.error(error);process.exitCode=1});
