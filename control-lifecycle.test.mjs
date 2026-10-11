import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const sdk=await import(pathToFileURL(`${root}/dist/index.js`));
const {loadExtensionFromFactory}=await import(pathToFileURL(`${root}/dist/core/extensions/index.js`));
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const prompt=await jiti.import(new URL('./prompt-blocks.ts',import.meta.url).pathname);
const dir=mkdtempSync(join(tmpdir(),'pi-control-lifecycle-')),old=process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR=dir;
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
let session,modelRuntime,result,display,contexts=[],notices=[],errors=[],actions=[],pending,inputCalls=0,modelCalls=0;
let state={available:true,open:true,raw:false,actions:[{row:0,label:'read A'}]};
const unhandled=[];const onUnhandled=e=>unhandled.push(e);process.on('unhandledRejection',onUnhandled);
const eventBus=sdk.createEventBus();
const load=async()=>{
 const runtime=sdk.createExtensionRuntime();
 const extension=await loadExtensionFromFactory(pi=>{
  display=prompt.default(pi,a=>{actions.push(a);return true;},()=>state);
  pi.on('session_start',(_e,ctx)=>contexts.push(ctx));
  pi.on('input',()=>{inputCalls++;throw Error('FORBIDDEN_INPUT');});
 },dir,eventBus,runtime,new URL('./index.ts',import.meta.url).pathname);
 result={extensions:[extension],errors:[],runtime};
};
try {
 await load();
 const resources={getExtensions:()=>result,getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>[],getSystemPrompt:()=>'',getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources(){},reload:load};
 modelRuntime=await sdk.ModelRuntime.create({authPath:join(dir,'auth.json'),modelsPath:join(dir,'models.json')});
 for(const name of ['stream','streamSimple'])modelRuntime[name]=()=>{modelCalls++;throw Error('FORBIDDEN_MODEL');};
 const manager=sdk.SessionManager.inMemory(dir);manager.appendMessage({role:'user',content:'Ordinary original message',timestamp:1});
 ({session}=await sdk.createAgentSession({cwd:dir,agentDir:dir,sessionManager:manager,settingsManager:sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:{mode:'off'}}),resourceLoader:resources,modelRuntime,noTools:true}));
 session.agent.prompt=async()=>{modelCalls++;throw Error('FORBIDDEN_AGENT');};
 const history=JSON.stringify(manager.getBranch()),messages=JSON.stringify(session.messages);
 let failNotify=false;
 await session.bindExtensions({mode:'tui',uiContext:{setToolsExpanded(){},getToolsExpanded:()=>false,setStatus(){},select:()=>pending.promise,notify:m=>{if(failNotify==='reject')return Promise.reject(Error('FEEDBACK_FAILED'));if(failNotify)throw Error('FEEDBACK_FAILED');notices.push(m);}},onError:e=>errors.push(e)});
 // Exactly the fire-and-forget call shape used by both tool and report footers.
 pending=deferred();void display.control('menu');pending.reject(Error('SELECT_FAILED'));await tick();await tick();
 assert.deepEqual(unhandled,[],'owned footer selection failure must not escape as an unhandled rejection');
 assert.ok(notices.some(m=>m.includes('SELECT_FAILED')),'active errors remain visible');
 // A real local filesystem failure must remain visible, not silently swallowed.
 const config=join(dir,'compact-tool-renderers.json');mkdirSync(config);
 await display.control('height 2');assert.ok(notices.some(m=>m.includes('Could not apply block control') && /EISDIR|ENOTDIR|EPERM/.test(m)));
 rmSync(config,{recursive:true,force:true});
 // Jump must not apply a late selection to a different active pane.
 pending=deferred();const jump=display.control('jump');state={...state,actions:[{row:0,label:'read B'}]};pending.resolve('1. read A');await jump;
 assert.deepEqual(actions,[],'late jump must not navigate a newly selected pane');
 pending=deferred();const validJump=display.control('jump');pending.resolve('1. read B');await validJump;
 assert.deepEqual(actions,['jump 1'],'same-pane jump remains functional');actions.length=0;
 // Feedback failures have a bounded nonrecursive diagnostic, never another dialog.
 const diagnostics=[],originalError=console.error;console.error=(...args)=>diagnostics.push(args);
 try {for(const failure of ['throw','reject']){failNotify=failure;pending=deferred();void display.control('menu');pending.reject(Error('SECOND_SELECT_FAILED'));await tick();await tick();assert.deepEqual(unhandled,[]);assert.match(diagnostics.at(-1).join(' '),/SECOND_SELECT_FAILED/);assert.match(diagnostics.at(-1).join(' '),/FEEDBACK_FAILED/);}assert.equal(diagnostics.length,2);}finally{console.error=originalError;failNotify=false;}
 // Real SDK reloads revoke contexts and replace runtimes while dialogs are pending.
 for(let i=0;i<20;i++){
  const previous=display,ctx=contexts.at(-1),count=notices.length;
  pending=deferred();const selection=pending;void previous.control(i%2?'jump':'menu');
  await session.reload();assert.throws(()=>ctx.ui,/stale/);assert.notEqual(previous,display);
  if(i%2)selection.resolve('1. read B');else selection.reject(Error('DISPOSED_DIALOG'));
  await tick();await tick();assert.equal(notices.length,count,'disposed owner cannot notify its successor');assert.deepEqual(unhandled,[]);
  await previous.control('help');assert.equal(notices.length,count);
 }
 assert.deepEqual(actions,[]);assert.equal(inputCalls,0);assert.equal(modelCalls,0);assert.deepEqual(errors,[]);
 assert.equal(JSON.stringify(manager.getBranch()),history);assert.equal(JSON.stringify(session.messages),messages);
 // Awaited slash-command errors still belong to Pi, not the footer boundary.
 pending=deferred();const command=session.prompt('/blocks menu');pending.reject(Error('COMMAND_SELECT_FAILED'));await command;
 assert.ok(errors.some(e=>String(e.error ?? e.message).includes('COMMAND_SELECT_FAILED')));
 await session.extensionRunner.emit({type:'session_shutdown',reason:'exit'});
 console.log('PASS: real isolated SDK owned footer failures + safe feedback failure; stale-pane jump rejection; 20 actual reloads with pending resolve/reject, revoked contexts, disabled old controls, immutable history, zero input/model calls and zero unhandled rejection; awaited command error remains native.');
} finally {session?.dispose();modelRuntime?.dispose?.();process.off('unhandledRejection',onUnhandled);old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(dir,{recursive:true,force:true});}
