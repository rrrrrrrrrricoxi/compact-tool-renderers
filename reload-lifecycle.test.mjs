import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const preview=await jiti.import(new URL('./thinking-preview.ts',import.meta.url).pathname);
const reports=await jiti.import(new URL('./subagent-cards.ts',import.meta.url).pathname);
const {ThinkingGroups}=await jiti.import(new URL('./thinking-groups.ts',import.meta.url).pathname);
const sdk=await import(pathToFileURL(`${root}/dist/index.js`));
const {loadExtensionFromFactory}=await import(pathToFileURL(`${root}/dist/core/extensions/index.js`));
const themes=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {MouseRegion,Text}=await import(pathToFileURL(tuiPath));
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const thought=s=>({type:'thinking',thinking:s});
const source=()=>({role:'assistant',content:[thought('## Retained topic\nOriginal private reasoning.'),{type:'text',text:'Ordinary visible prose.'}],stopReason:'stop'});
const round=()=>({role:'assistant',content:[thought('## Group topic\nOriginal grouped reasoning.')],stopReason:'stop'});
const entry=message=>({type:'message',message});
const originals={update:sdk.AssistantMessageComponent.prototype.updateContent,render:sdk.AssistantMessageComponent.prototype.render};
// Observe the real pane objects without adding production registries/test hooks.
let panes=[];
const originalPane=ThinkingGroups.prototype.pane;
ThinkingGroups.prototype.pane=function(...args){const pane=originalPane.apply(this,args);if(!panes.includes(pane))panes.push(pane);return pane;};
function retained(messages){
 const cards=messages.map(m=>new sdk.AssistantMessageComponent(m,true,themes.getMarkdownTheme()));
 cards.forEach(c=>c.render(100));
 const children=cards.flatMap(c=>c.contentContainer.children.filter(x=>x instanceof MouseRegion).map(x=>x.child));
 return {cards,children,panes:panes.slice()};
}
function retainReports(){
 const messages=[{role:'custom',customType:'subagent_result',display:true,content:'Original report.',details:{name:'Report',exitCode:0}},
 {role:'custom',customType:'subagent_question',display:true,content:'Question envelope.',details:{name:'Question',question:'Original question.'}}];
 return messages.map(message=>{
  const card=new sdk.CustomMessageComponent(message,m=>new Text(`Native ${m.content}`,0,0),themes.getMarkdownTheme(),1);
  card.render(100);
  const record=card[Object.getOwnPropertySymbols(card).find(s=>s.description==='compact-subagent-report-pane')];
  assert.ok(record);
  return {card,child:card.customComponent,target:record.target,message,before:JSON.stringify(message)};
 });
}
function renderAll(saved){
 for(const r of saved.reports || []){
  assert.equal(r.target.valid(),false);
  for(const action of ['refresh','open','close','raw','down'])assert.equal(r.target.action(action),false);
  assert.ok(r.child.render(100).length>0);assert.ok(r.card.render(100).length>0);
  assert.notEqual(r.card.customComponent,r.child);
  assert.equal(JSON.stringify(r.message),r.before);
 }
 saved.cards.forEach(c=>assert.ok(c.render(100).length>0));
 saved.children.forEach(c=>assert.match(c.render(100).map(strip).join('\n'),/Thinking/));
 saved.panes.forEach(p=>{p.open=true;p.invalidate();assert.match(p.render(100).map(strip).join('\n'),/Original grouped reasoning/);});
}
function checkTheme(saved){
 const child=saved.children[0];
 themes.initTheme('dark',false);const dark=child.render(100)[0];
 themes.initTheme('light',false);child.invalidate();const light=child.render(100)[0];
 assert.notEqual(dark,light,'retained preview uses current live palette, not a frozen snapshot');
 assert.ok(light.includes(themes.theme.fg('thinkingText','Thinking · Retained topic · Ctrl+T to expand')) || light.includes(themes.theme.fg('thinkingText','▸ Thinking · 1 round · Retained topic')));
 for(const p of saved.panes){
  themes.initTheme('dark',false);p.invalidate();const a=p.render(100).join('\n');
  themes.initTheme('light',false);p.invalidate();const b=p.render(100).join('\n');
  assert.notEqual(a,b,'retained grouped pane accepts live palette changes');
  assert.ok(b.includes(themes.theme.fg('muted','Round 1/1')));
 }
}
try {
 // More adversarial than host ordering: getters are revoked BEFORE shutdown.
 for(const mode of ['quiet','compact','quiet','compact']){
  themes.initTheme('dark',false);panes=[];
  const hooks={};let stale=false;
  const messages=[source(),round()],before=JSON.stringify(messages);
  const ui={get theme(){return themes.theme;},setHiddenThinkingLabel(){}};
  const ctx={get mode(){if(stale)throw Error('SYNTHETIC_STALE_CTX');return 'tui';},get ui(){if(stale)throw Error('SYNTHETIC_STALE_CTX');return ui;},sessionManager:{getBranch:()=>messages.map(entry)}};
  const display=preview.default({on:(n,f)=>hooks[n]=f},()=>mode);
  hooks.session_start({},ctx);const saved=retained(messages);
  stale=true;assert.throws(()=>ctx.ui,/SYNTHETIC_STALE_CTX/);
  saved.children[0].render(100); // This failed on v1.17.0, before disposal even runs.
  hooks.session_shutdown();renderAll(saved);checkTheme(saved);
  assert.equal(display.state().available,false);assert.equal(display.action('open'),false);
  const next={};preview.default({on:(n,f)=>next[n]=f},()=>mode);
  next.session_start({}, {mode:'tui',ui,sessionManager:{getBranch:()=>[]}});
  renderAll(saved);checkTheme(saved);
  // Native Ctrl+T rebuilding and complete immutable source still work on old cards.
  saved.cards[0].setHideThinkingBlock(false);
  assert.match(saved.cards[0].render(100).map(strip).join('\n'),/Original private reasoning/);
  saved.cards[0].setHideThinkingBlock(true);
  assert.match(saved.cards[0].render(100).map(strip).join('\n'),/Retained topic/);
  assert.equal(JSON.stringify(messages),before);next.session_shutdown();
 }
 // Actual SDK reload: new extension runtime/resources, actual revoked old runner,
 // retained native cards painted while resource reload is awaiting completion.
 const dir=mkdtempSync(join(tmpdir(),'pi-renderer-real-reload-'));
 const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=dir;
 let modelRuntime,session;
 try {
  for(const mode of ['quiet','compact']){
   panes=[];let currentMode=mode,result,contexts=[],displays=[],errors=[],inputCalls=0,modelCalls=0,reloadCalls=0,saved;
   const eventBus=sdk.createEventBus();
   const load=async()=>{
    const runtime=sdk.createExtensionRuntime(),activeMode=currentMode;
    const extension=await loadExtensionFromFactory(pi=>{
     displays.push(preview.default(pi,()=>activeMode));
     reports.default(pi,()=>activeMode);
     pi.on('session_start',(_e,ctx)=>contexts.push(ctx));
     pi.on('input',()=>{inputCalls++;throw Error('FORBIDDEN_INPUT');});
    },dir,eventBus,runtime,new URL('./index.ts',import.meta.url).pathname);
    result={extensions:[extension],errors:[],runtime};
   };
   await load();
   const resources={getExtensions:()=>result,getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>[],getSystemPrompt:()=>'',getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources(){},reload:async()=>{
    reloadCalls++;
    assert.throws(()=>contexts[0].ui,/stale/,'real old ctx is revoked inside resource reload');
    await new Promise((resolve,reject)=>setImmediate(()=>{try{renderAll(saved);checkTheme(saved);resolve();}catch(e){reject(e);}}));
    await load();
   }};
   modelRuntime=await sdk.ModelRuntime.create({authPath:join(dir,'auth.json'),modelsPath:join(dir,'models.json')});
   // A hard no-model boundary at both model runtime stream methods and Agent.prompt.
   for(const name of ['stream','streamSimple'])modelRuntime[name]=()=>{modelCalls++;throw Error('FORBIDDEN_MODEL');};
   const manager=sdk.SessionManager.inMemory(dir),messages=[source(),round()];messages.forEach(m=>manager.appendMessage(m));
   ({session}=await sdk.createAgentSession({cwd:dir,agentDir:dir,sessionManager:manager,settingsManager:sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:{mode:'off'}}),resourceLoader:resources,modelRuntime,noTools:true}));
   session.agent.prompt=async()=>{modelCalls++;throw Error('FORBIDDEN_AGENT_PROMPT');};
   const history=JSON.stringify(manager.getBranch()),modelHistory=JSON.stringify(session.messages);
   await session.bindExtensions({mode:'tui',uiContext:{get theme(){return themes.theme;},setHiddenThinkingLabel(){},setStatus(){}},onError:e=>errors.push(e)});
   for(let cycle=0;cycle<10;cycle++){
    saved=retained(messages);saved.reports=retainReports();
    const previous=contexts.at(-1),oldDisplay=displays.at(-1);
    currentMode=currentMode==='quiet'?'compact':'quiet';panes=[];
    await session.reload(); // Not a command-context setter spy or RPC /reload.
    assert.equal(reloadCalls,cycle+1);assert.equal(contexts.length,cycle+2);assert.notEqual(previous,contexts.at(-1));
    assert.throws(()=>previous.ui,/stale/);assert.throws(()=>previous.mode,/stale/);
    renderAll(saved);checkTheme(saved);
    themes.initTheme(themes.SYSTEM_THEME_NAME,false);renderAll(saved);
    for(const width of [1,2,3,4])saved.children.forEach(c=>c.render(width));
    saved.cards[0].setHideThinkingBlock(false);
    assert.match(saved.cards[0].render(100).map(strip).join('\n'),/Original private reasoning/);
    saved.cards[0].setHideThinkingBlock(true);
    assert.equal(oldDisplay.action('open'),false);assert.equal(oldDisplay.state().available,false);
    assert.equal(JSON.stringify(manager.getBranch()),history);assert.equal(JSON.stringify(session.messages),modelHistory);
    assert.equal(inputCalls,0);assert.equal(modelCalls,0);assert.deepEqual(errors,[]);
   }
   await session.extensionRunner.emit({type:'session_shutdown',reason:'exit'});
   session.dispose();session=undefined;modelRuntime.dispose?.();modelRuntime=undefined;
  }
 } finally {session?.dispose();modelRuntime?.dispose?.();old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(dir,{recursive:true,force:true});}
 assert.equal(sdk.AssistantMessageComponent.prototype.updateContent,originals.update);
 assert.equal(sdk.AssistantMessageComponent.prototype.render,originals.render);
 console.log('PASS: revoked-before-shutdown retained native preview children/cards and grouped panes; repeated quiet/compact teardown/successor/theme-color/native visibility/source tests; 20 actual isolated SDK session.reload cycles with alternating quiet/compact, system/light/dark palettes, revoked old runner and pending redraw during resource reload, fresh extension runtimes, report/question lazy fallback and disabled saved targets, 0 input/model calls and unchanged history.');
} finally {ThinkingGroups.prototype.pane=originalPane;}
