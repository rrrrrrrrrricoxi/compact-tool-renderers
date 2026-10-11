import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.env.PI_INSTALL_ROOT||'/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`,'@mariozechner/pi-tui':tuiPath,'@mariozechner/pi-coding-agent':`${root}/dist/index.js`,'@sinclair/typebox':`${root}/node_modules/typebox/build/index.mjs`}});
const extension=await jiti.import(new URL('./index.ts',import.meta.url).pathname,{default:true});
const {installQuietImages,default:registerQuietImages}=await jiti.import(new URL('./quiet-images.ts',import.meta.url).pathname);
const {humanAnswerRenderer}=await jiti.import(new URL('./human-answers.ts',import.meta.url).pathname);
const sdk=await import(pathToFileURL(`${root}/dist/index.js`));
const {loadExtensionFromFactory}=await import(pathToFileURL(`${root}/dist/core/extensions/index.js`));
const {ToolExecutionComponent}=await import(pathToFileURL(`${root}/dist/modes/interactive/components/tool-execution.js`));
const {readRenderers}=await import(pathToFileURL(`${root}/dist/core/tools/renderers/read.js`));
const tui={...await import(pathToFileURL(tuiPath)),...await import(pathToFileURL(`${root}/node_modules/@earendil-works/pi-tui/dist/terminal-image.js`))};
const themes=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const amosPath='/Users/notrico/.pi/agent/git/github.com/amosblomqvist/pi-interactive-subagents/pi-extension/subagents/index.ts';
const amos=await jiti.import(amosPath);
const amosStatus=await jiti.import(amosPath.replace('index.ts','status.ts'));
const native=await loadExtensionFromFactory(amos.default,'/tmp',sdk.createEventBus(),sdk.createExtensionRuntime(),amosPath);
const originalRender=ToolExecutionComponent.prototype.render;
const originalCaps={...tui.getCapabilities()};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const images={content:[{type:'text',text:'Recorded read output'},{type:'image',mimeType:'image/png',data:png},{type:'image',mimeType:'image/png',data:png}],details:{original:true}};
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-9;]*m/g,'');
const text=c=>c.render(100).filter(row=>!tui.isImageLine(row)).map(strip).join('\n');
const imageLines=c=>c.render(100).filter(tui.isImageLine);
const call=(id,name,arguments_)=>({role:'assistant',stopReason:'toolUse',content:[{type:'toolCall',id,name,arguments:arguments_}]});
const result=(id,name,r)=>({role:'toolResult',toolCallId:id,toolName:name,isError:false,...r});
const qArgs={question:'Which route?\nSecond question line',details:'Context with full detail',options:[{label:'Human-facing choice',value:'machine_value',description:'Helpful option description'}]};
const qResult={content:[{type:'text',text:'Model-facing result ORIGINAL'}],details:{status:'answered',question:qArgs.question,mode:'single-select',answers:[{type:'option',index:1,label:'Human-facing choice',value:'machine_value'}]}};
const statusLine=amosStatus.formatStatusLine('question-answer-cards',{kind:'stalled',elapsedText:'1m',snapshotProblemText:'1m',statusLabel:null});
const status={role:'custom',customType:'subagent_status',display:true,content:amosStatus.formatStatusAggregate([statusLine],4),details:{lines:[statusLine],overflow:0}};
const done={role:'custom',customType:'subagent_result',display:true,content:'Full original child report',details:{name:'question-answer-cards',exitCode:0,elapsed:263}};
const childQuestion={role:'custom',customType:'subagent_question',display:true,content:'Question envelope',details:{name:'question-answer-cards',question:'Actual pending child question'}};
const dir=mkdtempSync(join(tmpdir(),'pi-quiet-surfaces-')),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=dir;
try {
for(const mode of ['quiet','compact','expanded']){
 writeFileSync(join(dir,'compact-tool-renderers.json'),JSON.stringify({mode}));
 let resolve,command,redraws=0;const hooks=new Map(),notices=[];
 extension({on(n,f){if(!hooks.has(n))hooks.set(n,[]);hooks.get(n).push(f);},registerToolRenderer(f){resolve=f;},registerCommand(n,c){if(n==='blocks')command=c;},registerMarkdownTransformer(){},getCommands:()=>[]});
 let branch=[call('routine','read',{path:'/tmp/text'}),result('routine','read',{content:[{type:'text',text:'Original ordinary output'}]}),call('message','subagent_message',{name:'question-answer-cards',message:'Original message'}),result('message','subagent_message',{content:[{type:'text',text:'Original start'}],details:{status:'started'}}),call('image','read',{path:'/tmp/Screenshot.png'}),result('image','read',images),call('q1','ask_user_question',qArgs),result('q1','ask_user_question',qResult),call('q2','ask_user_question',qArgs),result('q2','ask_user_question',qResult),{type:'custom',...status},{type:'custom',...done},{type:'custom',...childQuestion}].map(message=>({type:'message',message}));
 const original=JSON.stringify(branch),originalImages=JSON.stringify(images);
 const ctx={mode:'tui',hasUI:true,sessionManager:{getBranch:()=>branch},ui:{theme:themes.theme,setHiddenThinkingLabel(){},setToolsExpanded(){},notify(s){notices.push(s);}},isIdle:()=>true};
 const emit=async(n,e)=>{for(const f of hooks.get(n)||[])await f(e,ctx);};
 themes.initTheme('dark',false);tui.setCapabilities({images:'kitty',trueColor:true,hyperlinks:false});await emit('session_start',{});
 const make=(id,name,args,r,pad=1,show=true)=>{const c=new ToolExecutionComponent(name,id,args,{outputPad:pad,showImages:show,imageWidthCells:13},{name,...resolve(name,()=>name==='read'?readRenderers:undefined)},{requestRender(){redraws++;}},dir);if(r)c.updateResult(r,false);return c;};
 for(const pad of [0,1,2,4]){
  const routine=make('routine','read',{path:'/tmp/text'},{content:[{type:'text',text:'Original ordinary output'}]},pad);
  const message=make('message','subagent_message',{name:'question-answer-cards',message:'Original message'},{content:[{type:'text',text:'Original start'}],details:{status:'started'}},pad);
  const image=make('image','read',{path:'/tmp/Screenshot.png'},images,pad);
  const thoughtMessage={role:'assistant',content:[{type:'thinking',thinking:'Original thinking topic'}],stopReason:'stop'};
  const thinking=new sdk.AssistantMessageComponent(thoughtMessage,true,themes.getMarkdownTheme());
  const custom=m=>new sdk.CustomMessageComponent(m,native.messageRenderers.get(m.customType),themes.getMarkdownTheme(),pad);
  const completion=custom(done),question=custom(childQuestion),statusCard=custom(status);
  const rows=[routine,message,image,thinking,completion,question,statusCard];
  const kinds=['Tools','Message','Read image','Thinking','Subagent completed ✓','Child question','Status'];
  for(const palette of ['dark','light','system']){
   themes.initTheme(palette,false);rows.forEach(c=>c.invalidate());
   if(mode==='quiet'){
    for(let i=0;i<rows.length;i++){
     const heading=rows[i].render(100).map(strip).find(row=>row.trim());
     assert.ok(heading.startsWith('▸ '),`${kinds[i]} disclosure: ${heading}`);
     assert.equal(heading.indexOf(kinds[i]),2,`${kinds[i]} heading column pad${pad}`);
    }
    assert.match(text(statusCard),/⚠ Stalled 1m · Running 1m/);
    assert.match(text(image),/2 images/);
    assert.equal(imageLines(image).length,0,'Quiet collapsed does not paint native images');
   }else{
    assert.ok(imageLines(image).length>=2,'other presets keep native collapsed image behavior');
    assert.match(text(statusCard),/Subagent status/,'status adaptation is Quiet-only');
   }
   for(const width of [1,2,3,4,28,50,100])for(const c of rows)for(const row of c.render(width))if(!tui.isImageLine(row) && !(mode!=='quiet'&&c===statusCard&&width<=4))assert.ok(tui.visibleWidth(row)<=width,`${mode}/${pad}/${width}: ${strip(row)}`);
  }
  const nativeImages=image.imageComponents.slice(),sources=image.imageSources;
  assert.equal(nativeImages.length,2);assert.ok(nativeImages.every(c=>c instanceof tui.Image));
  image.setExpanded(true);assert.ok(imageLines(image).length>=2,'native Ctrl+O expansion paints original images');
  assert.equal(image.imageComponents[0],nativeImages[0]);assert.equal(image.imageSources[0].data,png);assert.equal(image.imageWidthCells,13);
  assert.ok(!text(image).includes(png),'readable details never dump base64');
  image.setExpanded(false);image.render(100);assert.equal(image.imageComponents[0],nativeImages[0]);
  assert.equal(image.handleMouse({type:'click',button:'left',x:0,y:1,width:100,height:50})?.handled,true);assert.ok(imageLines(image).length>=2);image.setExpanded(false);
  image.setShowImages(false);image.setExpanded(true);assert.equal(imageLines(image).length,0);assert.equal(image.showImages,false);
  if(mode==='quiet')assert.match(text(image),/Show images is disabled/);
  image.setShowImages(true);tui.setCapabilities({images:null,trueColor:true,hyperlinks:false});image.invalidate();
  assert.equal(imageLines(image).length,0);if(mode==='quiet')assert.match(text(image),/protocol is unsupported/);
  tui.setCapabilities({images:'kitty',trueColor:true,hyperlinks:false});image.invalidate();image.setExpanded(false);
  if(mode==='quiet'){
   statusCard.render(100);assert.equal(statusCard.handleMouse({type:'click',button:'left',x:0,y:1,width:100,height:50})?.handled,true);assert.match(text(statusCard),/stalled 1m/);statusCard.setExpanded(false);
   for(const unsupported of [{...status,details:{...status.details,requiresAction:true}},{...status,details:{lines:['unknown line'],overflow:0}},{...status,content:'Untrusted unmatched body'}])assert.match(text(custom(unsupported)),/Subagent status/,'unknown/action payload keeps native renderer');
   const statusFixture=line=>custom({...status,content:amosStatus.formatStatusAggregate([line],4),details:{lines:[line],overflow:0}});
   const snapshot={elapsedText:'1h 2m',statusLabel:null,activeDurationText:'12s',waitingDurationText:'2m',snapshotProblemText:'1m',activityLabel:'tool execution',activeScope:null};
   for(const kind of ['starting','active','waiting','stalled','running'])assert.match(text(statusFixture(amosStatus.formatStatusLine('child',{...snapshot,kind}))),/▸ Status/);
   for(const kind of ['active','waiting'])assert.match(text(statusFixture(amosStatus.formatTransitionLine('child',{...snapshot,kind},'recovered'))),/▸ Status/);
   assert.match(text(statusFixture(amosStatus.formatTransitionLine('child',{...snapshot,kind:'waiting'},'recovered'))),/⚠ Recovered; waiting 2m · Running/);
   for(const tail of ['waiting for input','waiting for confirmation','active requires you to act','starting unknown','stalled mysteriously','recovered; unknown','active (approval required)'])assert.match(text(statusFixture(`child running 1m, ${tail}.`)),/Subagent status/);
   for(const duration of ['1.5m','1m 2s','2h'])assert.match(text(statusFixture(`child running ${duration}.`)),/Subagent status/);
   const failed=make('failed','subagent_message',{name:'child'},{content:[{type:'text',text:'Recorded failure'}],isError:true},pad);
   assert.match(text(failed),/▸ Failed ✗ · Message · child · Recorded failure/);
  }
 }
 if(mode==='quiet'){
  const selectedTool=make('routine','read',{path:'/tmp/text'},{content:[{type:'text',text:'Original ordinary output'}],details:{toolRawMarker:'retained target'}});
  const backgroundTool=make('image','read',{path:'/tmp/Screenshot.png'},images);
  selectedTool.render(100);selectedTool.handleMouse({type:'click',button:'left',x:0,y:1,width:100,height:50});text(selectedTool);
  backgroundTool.setExpanded(true);text(backgroundTool);backgroundTool.invalidate();text(backgroundTool);
  await command.handler('raw',ctx);assert.match(text(selectedTool),/"path": "\/tmp\/text"/,'native expansion/repaint of another tool cannot steal an interacted tool target');assert.ok(!text(backgroundTool).includes('Recorded details'));
  backgroundTool.setExpanded(false);backgroundTool.render(100);backgroundTool.handleMouse({type:'click',button:'left',x:0,y:1,width:100,height:50});text(backgroundTool);await command.handler('raw',ctx);assert.match(text(backgroundTool),/Recorded details/,'actual native standalone header interaction selects its own tool');assert.match(text(selectedTool),/"path": "\/tmp\/text"/);
 }
 // Raw is explicit and branch/invocation ordered, not selected by render order.
 const q1=make('q1','ask_user_question',qArgs,qResult),q2=make('q2','ask_user_question',qArgs,qResult);
 const heldReport=new sdk.CustomMessageComponent(done,native.messageRenderers.get('subagent_result'),themes.getMarkdownTheme(),1);
 heldReport.render(100);heldReport.handleMouse({type:'click',button:'left',x:0,y:1,width:100,height:50});
 await command.handler('raw latest-question',ctx);assert.match(notices.at(-1),/Expand a question first/);
 await command.handler('raw',ctx);assert.match(text(heldReport),/Recorded metadata/,'failed explicit question selection leaves actual report target unchanged');
 q2.setExpanded(true);q1.setExpanded(true);q2.invalidate();
 for(const q of [q1,q2]){assert.match(text(q),/Context with full detail/);assert.match(text(q),/Helpful option description/);assert.match(text(q),/Your answer · Selected option/);assert.ok(!text(q).includes('machine_value')&&!text(q).includes('Recorded details')&&!text(q).includes('Original arguments'));}
 // Bare raw has not acquired a question through global expansion/background paint.
 q1.updateResult(qResult,false);await command.handler('raw',ctx);assert.ok(!text(q1).includes('machine_value')&&!text(q2).includes('machine_value'));assert.ok(!text(heldReport).includes('Recorded metadata'),'global expansion and late results did not steal the report target');
 await command.handler('raw latest-question',ctx);assert.match(text(q2),/machine_value/);assert.match(text(q2),/Original arguments/);assert.match(text(q2),/Model-facing result ORIGINAL/);assert.ok(!text(q1).includes('machine_value'));
 await command.handler('raw',ctx);assert.ok(!text(q2).includes('machine_value'));
 // Exact per-card Raw button selects only its own invocation.
 const rawY=q1.render(100).map(strip).findIndex(row=>row.includes('[Raw]'));
 assert.ok(rawY>0);assert.equal(q1.handleMouse({type:'click',button:'left',x:1,y:rawY,width:100,height:50})?.handled,true);assert.match(text(q1),/machine_value/);assert.ok(!text(q2).includes('machine_value'));
 q2.invalidate();await command.handler('raw',ctx);assert.ok(!text(q1).includes('machine_value'),'background q2 render did not steal q1');
 // Native MouseRegion supplies the separator offset. Both footer boundaries
 // must miss; only the exact painted button selects/toggles its own card.
 const footer=q1.render(100).map(strip).findIndex(row=>row.includes('[Raw]')),pad=1;
 for(const x of [pad-1,pad+5]){q1.setExpanded(true);q1.render(100);q1.handleMouse({type:'click',button:'left',x,y:footer,width:100,height:50});assert.ok(!text(q1).includes('machine_value'));}
 q1.setExpanded(true);q1.render(100);q1.handleMouse({type:'click',button:'left',x:pad+4,y:footer,width:100,height:50});assert.match(text(q1),/machine_value/);
 // Stale controls and abandoned branch question targets cannot be selected,
 // including a retained card that was actually Raw before branch replacement.
 const savedBranch=branch;branch=branch.filter(e=>!['q1','q2'].includes(e.message.toolCallId)&&!e.message.content?.some?.(b=>b.id==='q1'||b.id==='q2'));
 await emit('session_tree',{});await command.handler('raw latest-question',ctx);assert.match(notices.at(-1),/Expand a question first/);
 assert.ok(!text(q1).includes('machine_value'),'retained stale Raw paint resets without native invalidation');q1.invalidate();assert.ok(!text(q1).includes('machine_value'));branch=savedBranch;await emit('session_tree',{});q1.invalidate();q2.invalidate();assert.ok(!text(q1).includes('machine_value'));await command.handler('raw latest-question',ctx);assert.match(text(q2),/machine_value/);await emit('session_tree',{});q1.invalidate();q2.invalidate();assert.ok(!text(q2).includes('machine_value'),'same-branch rebuild resets Raw ownership');await command.handler('raw latest-question',ctx);assert.match(text(q2),/machine_value/);
 assert.equal(JSON.stringify(branch),original);assert.equal(JSON.stringify(images),originalImages);
 assert.ok(redraws<1000);
 await emit('session_shutdown',{});q2.invalidate();assert.ok(!text(q2).includes('machine_value'),'shutdown retained human card resets Raw');assert.equal(ToolExecutionComponent.prototype.render,originalRender);
}
// Narrow paint ownership: native behavior after teardown, successor owns only its
// wrapper, no global policy mutation, original content/native components retained.
tui.setCapabilities({images:'kitty',trueColor:true,hyperlinks:false});
const standalone=new ToolExecutionComponent('read','native',{path:'/tmp/image.png'},{showImages:true,imageWidthCells:9},readRenderers,{requestRender(){}},dir);standalone.updateResult(images,false);
assert.equal(installQuietImages(()=> 'quiet','future'),undefined);
let gate=installQuietImages(()=> 'quiet');assert.equal(imageLines(standalone).length,0);const successor=installQuietImages(()=> 'quiet');gate.dispose();assert.equal(imageLines(standalone).length,0);successor.dispose();assert.ok(imageLines(standalone).length>=2);assert.equal(standalone.showImages,true);assert.equal(standalone.imageWidthCells,9);
// Exercise native default/no-definition shells, shape fail-native and finally
// restoration on a real native render exception (not an adapter stub).
for(const definition of [undefined,readRenderers,{renderShell:'self',renderCall:()=>({render:()=>['Read image'],invalidate(){}})}]){
 const card=new ToolExecutionComponent('read','shell-fixture',{path:'/tmp/image.png'},{showImages:true,imageWidthCells:9},definition,{requestRender(){}},dir);card.updateResult(images,false);
 const nativeImage=card.imageComponents[0];
 const owner=installQuietImages(()=> 'quiet');assert.equal(imageLines(card).length,0);
 card.setExpanded(true);assert.ok(imageLines(card).length>=2);card.setExpanded(false);
 const oldSources=card.imageSources;card.imageSources=undefined;assert.ok(imageLines(card).length>=2,'unexpected adapter shape falls back to still-valid native render');card.imageSources=oldSources;
 const shell=definition?.renderShell==='self'?card.selfRenderContainer:card.children.find(c=>!(c instanceof tui.Image)&&!(c instanceof tui.Spacer));
 const nativeArrays=[card.imageComponents,card.imageSpacers,card.children];
 const paint=shell.render;shell.render=()=>{throw Error('NATIVE_PAINT_FIXTURE');};assert.throws(()=>card.render(100),/NATIVE_PAINT_FIXTURE/);shell.render=paint;
 // Expansion rebuild may replace children; capture just before failure separately
 // by checking originals of the current native state after a successful paint.
 assert.equal(card.imageComponents[0],nativeImage);assert.equal(card.imageComponents,nativeArrays[0]);assert.equal(card.imageSpacers,nativeArrays[1]);assert.equal(card.children,nativeArrays[2]);
 const restoredChildren=card.children;card.render(100);assert.equal(card.children,restoredChildren);owner.dispose();assert.ok(imageLines(card).length>=2);
}
// Actual no-model SDK reload ownership, including a paint while the old context
// is revoked and resources are being replaced. No live master session touched.
let sdkMode='quiet',loaded,contexts=[],savedCard,modelCalls=0,inputCalls=0;
const eventBus=sdk.createEventBus();
const load=async()=>{const runtime=sdk.createExtensionRuntime(),ownedMode=sdkMode;const e=await loadExtensionFromFactory(pi=>{registerQuietImages(pi,()=>ownedMode);pi.on('session_start',(_e,ctx)=>contexts.push(ctx));pi.on('input',()=>{inputCalls++;throw Error('FORBIDDEN_INPUT');});},dir,eventBus,runtime,new URL('./index.ts',import.meta.url).pathname);loaded={extensions:[e],errors:[],runtime};};
await load();
const resources={getExtensions:()=>loaded,getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>[],getSystemPrompt:()=>'',getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources(){},reload:async()=>{assert.throws(()=>contexts.at(-1).ui,/stale/);assert.ok(imageLines(savedCard).length>=2,'disposed old owner repaints natively during resource reload');await load();}};
const runtime=await sdk.ModelRuntime.create({authPath:join(dir,'auth.json'),modelsPath:join(dir,'models.json')});let session;
try{
 for(const k of ['stream','streamSimple'])runtime[k]=()=>{modelCalls++;throw Error('FORBIDDEN_MODEL');};
 const manager=sdk.SessionManager.inMemory(dir);manager.appendMessage(call('sdk-image','read',{path:'/tmp/Screenshot.png'}));manager.appendMessage(result('sdk-image','read',images));
 ({session}=await sdk.createAgentSession({cwd:dir,agentDir:dir,sessionManager:manager,settingsManager:sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:{mode:'off'}}),resourceLoader:resources,modelRuntime:runtime,noTools:true}));
 session.agent.prompt=()=>{modelCalls++;throw Error('FORBIDDEN_AGENT_PROMPT');};await session.bindExtensions({mode:'tui',uiContext:{theme:themes.theme},onError:e=>{throw e;}});
 savedCard=new ToolExecutionComponent('read','sdk-image',{path:'/tmp/Screenshot.png'},{showImages:true,imageWidthCells:11},readRenderers,{requestRender(){}},dir);savedCard.updateResult(images,false);
 const stored=JSON.stringify(manager.getBranch()),modelHistory=JSON.stringify(session.messages),nativeImage=savedCard.imageComponents[0];
 for(let i=0;i<4;i++){sdkMode=sdkMode==='quiet'?'compact':'quiet';await session.reload();assert.equal(imageLines(savedCard).length===0,sdkMode==='quiet');savedCard.setExpanded(true);assert.ok(imageLines(savedCard).length>=2);savedCard.setExpanded(false);assert.equal(savedCard.imageComponents[0],nativeImage);assert.equal(savedCard.showImages,true);assert.equal(savedCard.imageWidthCells,11);assert.equal(JSON.stringify(manager.getBranch()),stored);assert.equal(JSON.stringify(session.messages),modelHistory);}
 assert.equal(modelCalls,0);assert.equal(inputCalls,0);await session.extensionRunner.emit({type:'session_shutdown',reason:'exit'});
}finally{session?.dispose();runtime.dispose?.();}
assert.equal(ToolExecutionComponent.prototype.render,originalRender);
// Human rails use concrete theme styling, not arbitrary semantic token strings.
const renderer=humanAnswerRenderer(undefined),args={question:'Question 中文🙂\x1b[0m'},r={content:[{type:'text',text:'Original'}],details:{status:'answered',question:args.question,mode:'text',answers:[{type:'text',label:'Answer 中文🙂\x1b[0m',value:'Answer 中文🙂\x1b[0m'}]}};
const ctx={args,state:{},outputPad:2,expanded:true,invalidate(){}};
for(const palette of ['dark','light','system']){themes.initTheme(palette,false);for(const width of [1,2,3,4,28,50,100])for(const c of [renderer.renderCall(args,themes.theme,ctx),renderer.renderResult(r,{expanded:true,isPartial:false},themes.theme,ctx)])for(const row of c.render(width))assert.ok(tui.visibleWidth(row)<=width);const q=renderer.renderCall(args,themes.theme,ctx).render(100).join('\n'),a=renderer.renderResult(r,{expanded:true,isPartial:false},themes.theme,ctx).render(100).join('\n');assert.ok(q.includes('│')&&a.includes('│'));assert.match(q,/\x1b\[48;/);assert.match(a,/\x1b\[48;/);const userBg=themes.theme.getBgAnsi('userMessageBg');if(userBg.startsWith('\x1b[48;'))assert.ok(!q.includes(userBg));assert.ok(strip(q).includes('\\u001b[0m'));assert.ok(q!==a);}
assert.equal(ToolExecutionComponent.prototype.render,originalRender);
console.log('PASS: unified native Quiet headers/gutters, strict installed Amos status fixtures/fallback, native multiple-PNG collapse/expansion/policy/unsupported modes/reuse/owned disposal, explicit branch-ordered human Raw routing and readable options/context, rails/themes/narrow safety and immutable source.');
}finally{ToolExecutionComponent.prototype.render=originalRender;tui.setCapabilities(originalCaps);old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(dir,{recursive:true,force:true});}
