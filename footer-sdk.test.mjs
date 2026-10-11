import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const sdk=await import(pathToFileURL(`${root}/dist/index.js`));
const {loadExtensionFromFactory}=await import(pathToFileURL(`${root}/dist/core/extensions/index.js`));
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const prompt=await jiti.import(new URL('./prompt-blocks.ts',import.meta.url).pathname);
const {GroupPane}=await jiti.import(new URL('./group-pane.ts',import.meta.url).pathname);
const themes=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
themes.initTheme('dark',false);
const strip=s=>s.replace(/\x1b\[[0-9;:]*m/g,'');
const ownerPath=fileURLToPath(new URL('./index.ts',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'pi-footer-sdk-'));const old=process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR=dir;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(){
 const runtime=sdk.createExtensionRuntime(),eventBus=sdk.createEventBus();
 let api,display,sessionContext,commandContexts=[],inputCalls=0,agentCalls=0,reloads=0,notices=[],errors=[],dialogs=[],selections=[];
 const extension=await loadExtensionFromFactory(pi=>{
  api=pi;
  display=prompt.default(pi,()=>false,()=>({available:true,open:true,raw:false,actions:[{row:0,label:'read'}]}),{state:()=>({available:true,open:false,rounds:5}),action:()=>false});
  pi.on('session_start',(_e,ctx)=>{sessionContext=ctx;});
  pi.on('input',()=>{inputCalls++;throw Error('UNEXPECTED agent/input dispatch');});
 },dir,eventBus,runtime,ownerPath);
 const resources={getExtensions:()=>({extensions:[extension],errors:[],runtime}),getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>[],getSystemPrompt:()=>'',getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources(){},reload:async()=>{}};
 const settings=sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:{mode:'off'}});
 const modelRuntime=await sdk.ModelRuntime.create({authPath:join(dir,'auth.json'),modelsPath:join(dir,'models.json')});
 const {session}=await sdk.createAgentSession({cwd:dir,agentDir:dir,sessionManager:sdk.SessionManager.inMemory(dir),settingsManager:settings,resourceLoader:resources,modelRuntime,noTools:true});
 session.agent.prompt=async()=>{agentCalls++;throw Error('UNEXPECTED agent/model prompt');};
 // Detect any fallthrough before model/auth too, even if no model is configured.
 const history=JSON.stringify(session.sessionManager.getBranch()),messages=JSON.stringify(session.messages);
 const ui={get theme(){return themes.theme;},setToolsExpanded(){},getToolsExpanded:()=>false,notify:m=>notices.push(m),select:async(title,options)=>{dialogs.push({title,options});const pick=selections.shift();return typeof pick==='function'?await pick(title,options):pick===undefined?undefined:options.find(o=>o.includes(pick));}};
 await session.bindExtensions({mode:'tui',uiContext:ui,onError:e=>errors.push(e),commandContextActions:{reload:async()=>{reloads++;}}});
 assert.equal(typeof sessionContext.reload,'undefined','real session context lacks reload');
 const command=extension.commands.get('blocks');const handler=command.handler;command.handler=async(args,ctx)=>{commandContexts.push(ctx);return handler(args,ctx);};
 const pane=new GroupPane(()=> 'Tools',()=>Array.from({length:20},(_,i)=>`line ${i}`),()=>5,()=>themes.theme,()=>{});pane.open=true;let control;
 pane.onControl=action=>{control=display.control(action);};
 const clickOptions=async(width=100)=>{
  const lines=pane.render(width),footer=strip(lines.at(-1));const x=footer.indexOf('Options');assert.ok(x>=0,`Options visible at ${width}`);
  const result=pane.handleMouse({type:'click',button:'left',x,y:lines.length-1,width,height:lines.length});assert.equal(result.handled,true);assert.ok(!result.focus&&!result.focusTarget);await control;
  for(let i=0;i<5;i++)await tick();
 };
 const checkClean=()=>{assert.equal(inputCalls,0);assert.equal(agentCalls,0);assert.equal(JSON.stringify(session.sessionManager.getBranch()),history);assert.equal(JSON.stringify(session.messages),messages);assert.deepEqual(errors,[]);};
 return {api,display,session,extension,dialogs,selections,notices,commandContexts,clickOptions,checkClean,get reloads(){return reloads;},get sessionContext(){return sessionContext;},dispose:()=>{session.dispose();modelRuntime.dispose?.();}};
}
try{
 for(const mode of ['quiet','compact','expanded']){
  const h=await setup();try{
   assert.equal(prompt.canDispatchBlockMode(h.api),true,'actual SDK command ownership/capability gate');
   assert.equal(prompt.canDispatchBlockMode(h.api,'unsupported'),false);
   h.selections.push('Display mode…',mode==='quiet'?'Quiet':mode==='compact'?'Compact':'Expanded');await h.clickOptions(mode==='compact'?50:100);
   assert.equal(h.reloads,1);assert.equal(h.commandContexts.length,1);assert.equal(typeof h.commandContexts[0].reload,'function');assert.notEqual(h.commandContexts[0],h.sessionContext);assert.equal(h.dialogs.length,2,'all menus exit before fresh command dispatch');
   assert.equal(JSON.parse(readFileSync(join(dir,'compact-tool-renderers.json'),'utf8')).mode,mode);h.checkClean();
  }finally{h.dispose();}
 }
 // Background notifications are not the menu help/status implementation.
 const info=await setup();try{
  info.selections.push('Help & status…','Help ·','Back','Status','Back','Back','Done');await info.clickOptions();
  const help=info.dialogs.find(d=>d.title==='Help · controls and keyboard paths');assert.ok(help);assert.ok(help.options.some(o=>o.includes('No dedicated Previous/Next/Jump keys')));
  const status=info.dialogs.find(d=>d.title==='Status · current display state');assert.ok(status);for(const label of ['Mode:','Outer frame:','Body background:','Height:','Tool pane:','Thinking:'])assert.ok(status.options.some(o=>o.startsWith(label)));assert.ok(status.options.some(o=>o.includes('adaptive 45%')));assert.equal(info.notices.length,0);assert.equal(info.reloads,0);
  await info.session.prompt('/blocks help');await info.session.prompt('/blocks status');assert.equal(info.notices.length,2);info.checkClean();
 }finally{info.dispose();}
 // Busy/children failures are visible pages with Back, not hidden notifications.
 for(const busy of ['turn','children']){
  const h=await setup();const key=Symbol.for('pi-subagents/running-children-count');try{
   if(busy==='turn')h.session._isAgentRunActive=true;else globalThis[key]=()=>1;
   h.selections.push('Display mode…','Compact','Back','Back','Done');await h.clickOptions();assert.equal(h.reloads,0);assert.equal(h.commandContexts.length,0);assert.ok(h.dialogs.some(d=>d.title.includes('Wait until the current turn')&&d.options.join()==='Back'));assert.equal(h.notices.length,0);h.checkClean();
  }finally{h.session._isAgentRunActive=false;delete globalThis[key];h.dispose();}
 }
 // The fresh command repeats guards if child activity changes after bridge gating.
 const race=await setup();try{
  const command=race.extension.commands.get('blocks'),previous=command.handler,key=Symbol.for('pi-subagents/running-children-count');
  command.handler=async(args,ctx)=>{globalThis[key]=()=>1;try{return await previous(args,ctx);}finally{delete globalThis[key];}};
  race.selections.push('Display mode…','Compact');await race.clickOptions();assert.equal(race.commandContexts.length,1);assert.equal(race.reloads,0);assert.ok(race.notices.some(n=>n.includes('Wait until the current turn')),'fresh guard feedback is visible after menus exit');race.checkClean();
 }finally{race.dispose();}
 // Foreign/missing registration and missing dispatch function fail closed.
 for(const failure of ['missing','foreign','unsupported-api']){
  const h=await setup();try{
   if(failure==='missing')h.extension.commands.delete('blocks');
   else if(failure==='foreign')h.extension.commands.get('blocks').sourceInfo={...h.extension.commands.get('blocks').sourceInfo,path:'/synthetic/other-extension.ts'};
   else h.api.sendUserMessage=undefined;
   h.selections.push('Display mode…','Compact','Back','Back','Done');await h.clickOptions();assert.equal(h.reloads,0);assert.equal(h.commandContexts.length,0);assert.ok(h.dialogs.some(d=>d.title.includes('dispatch unavailable')));h.checkClean();
  }finally{h.dispose();}
 }
 const dispatchFailure=await setup();try{
  dispatchFailure.api.sendUserMessage=()=>{throw Error('Synthetic dispatch failure');};dispatchFailure.selections.push('Display mode…','Compact','Back');await dispatchFailure.clickOptions();assert.ok(dispatchFailure.dialogs.some(d=>d.title.includes('Could not dispatch display-mode change: Synthetic dispatch failure')&&d.options.join()==='Back'));assert.equal(dispatchFailure.reloads,0);assert.equal(dispatchFailure.commandContexts.length,0);dispatchFailure.checkClean();
 }finally{dispatchFailure.dispose();}
 // Session/reload epochs close old selections without dispatching through stale ctx.
 for(const event of [{type:'session_shutdown',reason:'reload'},{type:'session_switch',reason:'resume'}]){
  const stale=await setup();try{
   stale.selections.push(async()=>{await stale.session.extensionRunner.emit(event);return 'Display mode… quiet';});await stale.clickOptions();assert.equal(stale.reloads,0);assert.equal(stale.commandContexts.length,0);assert.equal(stale.dialogs.length,1);stale.checkClean();
  }finally{stale.dispose();}
 }
 console.log('PASS: isolated installed SDK first-ever Options footer → all three modes via actual extension-command dispatch/fresh command contexts; 1 mocked reload each, 0 input/agent/model calls, immutable in-memory history; native visible help/status and blocked-action pages; busy/children/missing/foreign/unsupported/stale gates fail closed.');
}finally{old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(dir,{recursive:true,force:true});}
