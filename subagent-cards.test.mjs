import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const aliases={'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`,'@mariozechner/pi-tui':tuiPath,'@mariozechner/pi-coding-agent':`${root}/dist/index.js`,'@sinclair/typebox':`${root}/node_modules/typebox/build/index.mjs`};
const jiti=createJiti(import.meta.url,{alias:aliases});
const mod=await jiti.import(new URL('./subagent-cards.ts',import.meta.url).pathname);
const sdk=await import(pathToFileURL(`${root}/dist/index.js`));
const {loadExtensionFromFactory}=await import(pathToFileURL(`${root}/dist/core/extensions/index.js`));
const {ExtensionRunner}=await import(pathToFileURL(`${root}/dist/core/extensions/runner.js`));
const {initTheme,getMarkdownTheme,theme}=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {visibleWidth,Container}=await import(pathToFileURL(tuiPath));
const {QuietGroups}=await jiti.import(new URL('./quiet-tools.ts',import.meta.url).pathname);
const {collectPrompts}=await jiti.import('/Users/notrico/.pi/agent/local-packages/sticky-prompt-strip/navigation.ts');
const nativePath=process.env.PI_AMOS_EXTENSION || '/Users/notrico/.pi/agent/git/github.com/amosblomqvist/pi-interactive-subagents/pi-extension/subagents/index.ts';
const amos=await jiti.import(nativePath);
initTheme('dark',false);
const runtime=sdk.createExtensionRuntime(),bus=sdk.createEventBus();
const native=await loadExtensionFromFactory(amos.default,'/tmp',bus,runtime,nativePath);
let secondCalls=0;
const later=await loadExtensionFromFactory(pi=>pi.registerMessageRenderer('subagent_result',()=>{secondCalls++;throw Error('later renderer must not win');}),'/tmp',bus,runtime,'/synthetic/later.ts');
const runner=new ExtensionRunner([native,later],runtime,'/tmp',sdk.SessionManager.inMemory('/tmp'),{});
const nativeRenderer=native.messageRenderers.get('subagent_result');
assert.equal(runner.getMessageRenderer('subagent_result'),nativeRenderer,'installed runner uses native first match, not later duplicate');
const settings=JSON.parse(readFileSync('/Users/notrico/.pi/agent/settings.json','utf8'));
assert.ok(settings.packages.findIndex(p=>typeof p==='string'&&p.includes('amosblomqvist/pi-interactive-subagents'))<settings.packages.indexOf('local-packages/compact-tool-renderers'),'actual configured load order');
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const rows=(card,width=100)=>card.render(width).map(strip);
const make=(details={},content='Original report\nSecond line\nThird line\nFourth line\nFifth line\nSixth line')=>({role:'custom',customType:'subagent_result',display:true,timestamp:123,content,details:{name:'Worker',exitCode:0,elapsed:12,...details}});
const card=(m,pad=1,renderer=nativeRenderer)=>new sdk.CustomMessageComponent(m,renderer,getMarkdownTheme(),pad);
const record=cc=>cc[Object.getOwnPropertySymbols(cc).find(key=>key.description==='compact-subagent-report-pane')];
const proto=sdk.CustomMessageComponent.prototype,origRebuild=proto.rebuild,origRender=proto.render,origExpanded=proto.setExpanded;
let mode='quiet',active=true;
assert.equal(mod.installSubagentCards(()=>mode,()=>active,'1.2.0'),undefined);
let control=mod.installSubagentCards(()=>mode,()=>active);
try {
 const source=make({stats:{toolCount:7,model:'synthetic',contextTokens:100,inputTokens:5,outputTokens:8,cacheReadTokens:0,cacheWriteTokens:0,cost:0},agent:'worker',sessionFile:'/long/路径/'+ '界'.repeat(180),sessionId:'session-id',unknown:{field:'preserved'}});
 const before=JSON.stringify(source),c=card(source);
 assert.equal(c.message,source);assert.equal(c.customRenderer,nativeRenderer);
 assert.equal(rows(c).length,2,'one native separator + one content row');assert.equal(rows(c)[0],'');assert.match(rows(c).join('\n'),/Subagent completed ✓ · Worker · 12s/);assert.ok(rows(c).join('').includes('Original report'));assert.ok(!rows(c).join('').includes('Second line'));
 for(const [name,elapsed] of [['pi-sync-portability',109],['pi-bundle-staging',572]])assert.match(rows(card(make({name,elapsed}))).join('\n'),new RegExp(`Subagent completed ✓ · ${name} · ${elapsed}s`),'screenshot-equivalent completion identifies the child, not a routine tool');
 mode='compact';assert.equal(rows(c).length,3,'one separator + at most two content rows');assert.match(rows(c).join('\n'),/✓ Subagent completed · Worker · 12s/);
 mode='expanded';c.setExpanded(true);assert.match(rows(c).join('\n'),/✓ Subagent completed · Worker · 12s/);assert.match(rows(c).join('\n'),/Sixth line/);assert.ok(!rows(c).join('\n').includes('Recorded metadata')); // readable by default
 mode='quiet';assert.ok(rows(c).length<=13);c.setExpanded(false);assert.equal(rows(c).length,2);
 for(const [d,pattern] of [[{exitCode:2},/Failed.*exit 2/],[{errorMessage:'Subscription quota limit reached'},/Failed.*Subscription quota/],[{error:'Provider failed'},/Failed.*Provider failed/],[{error:'cancelled'},/Cancelled.*cancelled/],[{status:'cancelled'},/Cancelled/],[{exitCode:null},null]]) {
  const m=make(d),cc=card(m);if(pattern)assert.match(rows(cc).join('\n'),pattern);else assert.deepEqual(rows(cc),rows(card(m,1,nativeRenderer)));
 }
 const cancel=make({exitCode:1},'Sub-agent "Worker" failed (exit code 1).\n\nSubagent cancelled.\n\nFollow up with subagent_message({ name: "Worker", message: "…" })');assert.match(rows(card(cancel)).join('\n'),/Cancelled/);
 assert.match(rows(card(make({},'Please cancel obsolete work next time.'))).join('\n'),/Subagent completed/);
 for(const elapsed of [-1,null,'12'])assert.match(rows(card(make({elapsed}))).join('\n'),/elapsed unknown/);
 const unknown=make();delete unknown.details.exitCode;delete unknown.details.elapsed;assert.match(rows(card(unknown)).join('\n'),/status unknown.*elapsed unknown/);
 // Exact full original text, including huge Unicode/ASCII tails and follow-up source,
 // is recoverable by joining wrapped lines. No Markdown/source stripping or slices.
 const long='START-'+('abcdefgh界🙂'.repeat(80))+'-END_SENTINEL';
 const body='Original **source**\n'+long+'-BODY_ONLY_TAIL\nError body: subscription limit\n\nFollow up with subagent_message({ name: "Worker", message: "SOURCE_FOLLOWUP" })';
 const full=make({errorMessage:'Provider error',stats:{model:'synthetic',toolCount:1,contextTokens:0,extra:'STATS_TAIL'},sessionFile:'/路径/'+long,unknown:{all:'METADATA_TAIL'}},body);
 mode='expanded';const fullBefore=JSON.stringify(full),fc=card(full);fc.setExpanded(true);record(fc).pane.raw=true;
 for(const name of ['dark','light','system']) {
  initTheme(name,false);fc.invalidate();
  for(const width of [1,2,3,4,28,50,100])for(const pad of [0,1,4]) {
   fc.setOutputPad(pad);const lines=rows(fc,width);assert.ok(lines.every(s=>visibleWidth(s)<=width),`${name} width ${width} pad ${pad}`);
   const joined=lines.map(s=>s.trim()).join('');assert.ok(joined.includes('END_SENTINEL'),`long tail at ${width}`);assert.ok(joined.includes('BODY_ONLY_TAIL'));assert.ok(joined.includes(width-2*Math.min(pad,Math.floor((width-1)/2))===1?'\\u754c':'界'));assert.ok(joined.includes(width-2*Math.min(pad,Math.floor((width-1)/2))===1?'\\ud83d\\ude42':'🙂'));assert.ok(joined.includes('SOURCE_FOLLOWUP'));assert.ok(joined.includes('STATS_TAIL'));assert.ok(joined.includes('METADATA_TAIL'));
  }
 }
 assert.equal(JSON.stringify(full),fullBefore);assert.equal(JSON.stringify(source),before);
 fc.setOutputPad(0);const metadataLines=rows(fc,10000);const metadataStart=metadataLines.findIndex(line=>line.trimEnd()==='Recorded metadata (JSON):');
 assert.ok(metadataStart>0);const {content:ignoredContent,...expectedMetadata}=full;assert.deepEqual(JSON.parse(metadataLines.slice(metadataStart+1).join('\n')),expectedMetadata);
 for(const width of [1,2,3,4,28,50,100]) {
  const text='  repeated   spaces  界🙂 é '+long+'  ';
  const wrapped=mod.wrapRecordedLine(text,width);assert.ok(wrapped.every(s=>visibleWidth(s)<=width));
  const recovered=wrapped.join('').replace(/\\u([a-f0-9]{4})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16)));assert.equal(recovered,text,'literal original spaces/graphemes/tail preserved');
 }
 assert.equal(mod.wrapRecordedLine('\x1b[31m\tcontrol',100).join(''),'\\u001b[31m\\tcontrol');
 // Extract only the actual report, skipping known native wrapper/boilerplate.
 const report=make({},'Sub-agent "Worker" completed (12s).\n\n## Changes\n\n**Implemented** a width-safe report view.\nMore details.\n\nFollow up with subagent_message({ name: "Worker", message: "…" })');
 const reportBefore=JSON.stringify(report);assert.equal(mod.reportExcerpt(report),'Implemented a width-safe report view.');
 assert.equal(mod.reportExcerpt(make({},'## Summary\nNo blocker found.\nMore details.')),'No blocker found.');
 assert.equal(mod.reportExcerpt(make({},'## Unicode connection check\nBody')),'Unicode connection check');
 assert.equal(mod.reportExcerpt(make({},'## Changes\n\nFollow up with subagent_message({ name: "Worker", message: "…" })')),'');
 assert.equal(mod.reportExcerpt(make({},'\n'.repeat(8192)+'Outside bounded scan')),'');
 assert.equal(mod.reportExcerpt(make({},'Sub-agent "Different" completed (12s).\nReal body')),'Sub-agent "Different" completed (12s).');
 assert.ok(visibleWidth(mod.reportExcerpt(make({},'界🙂'.repeat(1000))))<=160);
 // Actual native Container -> CustomMessageComponent -> component mouse dispatch.
 // Two independent cards stacked after a real user prompt; no root adapter.
 for(const displayMode of ['quiet','compact','expanded']) {
  mode=displayMode;
  for(const width of [1,2,3,4,28,50,100])for(const pad of [0,1,4]) {
   const a=card(report,pad),b=card(make({name:'Other'},'Independent second report'),pad);
   // Real InteractiveMode.addMessageToChat applies this global preset.
   a.setExpanded(displayMode==='expanded');b.setExpanded(displayMode==='expanded');
   const prompt=new sdk.UserMessageComponent('Stacked prompt',getMarkdownTheme());
   const stack=new Container();stack.addChild(prompt);stack.addChild(a);stack.addChild(b);
   const click=(target,offset=0,type='click',button='left')=>{
    stack.render(width);const y=prompt.render(width).length+(target===b?a.render(width).length:0)+1+offset;
    const result=stack.handleMouse({type,button,x:0,y,width,height:stack.render(width).length,originX:0,originY:0});
    if(result){assert.ok(!result.focus&&!result.focusTarget&&!result.capture);assert.ok(result.target,'native dispatch adds target');return {handled:result.handled,render:result.render};}
    return result;
   };
   const check=()=>{for(const cc of [a,b])assert.ok(rows(cc,width).every(line=>visibleWidth(line)<=width));};
   // Leading separator never toggles. Expanded body click/drag/wheel pass through.
   const initial=a._expanded;assert.equal(click(a,-1),undefined);assert.equal(a._expanded,initial);
   if(initial){assert.equal(click(a,1),undefined);assert.equal(click(a,1,'drag'),undefined);assert.equal(click(a,1,'wheel'),undefined);assert.equal(a._expanded,true);}
   if(initial){assert.deepEqual(click(a),{handled:true,render:true});assert.equal(a._expanded,false);assert.equal(b._expanded,true);}
   assert.ok(rows(a,width)[1].trimStart().startsWith('▸'));
   assert.deepEqual(click(a),{handled:true,render:true});assert.equal(a._expanded,true);check();
   if(displayMode==='expanded')assert.ok(rows(a,width)[1].trimStart().startsWith('▾'));else assert.ok(rows(a,width).length<=14,'normal expansion bounded');
   assert.equal(click(a,1),undefined);assert.equal(click(a,0,'drag'),undefined);if(displayMode==='expanded')assert.equal(click(a,0,'wheel'),undefined);else assert.deepEqual(click(a,0,'wheel'),{handled:true,render:true});assert.equal(click(a,0,'click','right'),undefined);assert.equal(a._expanded,true);
   assert.deepEqual(click(a),{handled:true,render:true});assert.equal(a._expanded,false);check();
   // Native global Ctrl+O after mouse and per-card click after global state.
   for(const cc of [a,b])cc.setExpanded(true);assert.equal(a._expanded,true);assert.equal(b._expanded,true);
   assert.deepEqual(click(b),{handled:true,render:true});assert.equal(b._expanded,false);assert.equal(a._expanded,true);
   for(const cc of [a,b])cc.setExpanded(false);assert.equal(a._expanded,false);assert.equal(b._expanded,false);
   assert.deepEqual(click(b),{handled:true,render:true});assert.equal(b._expanded,true);assert.equal(a._expanded,false);
   assert.equal(a.handleInput,undefined);assert.equal(b.focused,undefined);
   if(width===100&&pad===0){const collapsed=rows(a,width);assert.match(collapsed.join(''),/Implemented a width-safe report view/);assert.equal(collapsed.length,displayMode==='compact'?3:2);}
  }
 }
 mode='quiet';assert.equal(JSON.stringify(report),reportBefore);
 const failure=card(make({errorMessage:'Subscription limit reached'},'## Changes\nGeneric success-looking body'));assert.match(rows(failure).join(''),/Subscription limit reached/);assert.ok(!rows(failure).join('').includes('Generic success'));
 assert.match(rows(failure,2)[1],/▸✗/);assert.match(rows(card(make({error:'cancelled'})),2)[1],/▸⊘/);
 const resizing=card(report);for(const width of [100,1,50,2,100]){assert.ok(rows(resizing,width).every(line=>visibleWidth(line)<=width));assert.ok(rows(resizing,width)[1].trimStart().startsWith('▸'));}
 resizing.setExpanded(true);for(const width of [1,100,2,50]){assert.ok(rows(resizing,width).every(line=>visibleWidth(line)<=width));assert.ok(rows(resizing,width).length<=14);}
 const orphan=card(report);const oldSurface=orphan.customComponent;orphan.setExpanded(true);assert.equal(oldSurface.handleMouse({type:'click',button:'left',x:0,y:0,width:100}),undefined,'stale surface cannot toggle current card');
 // Native expansion demonstrably clips the same sentinel; our complete view doesn't.
 const stock=new sdk.CustomMessageComponent(full,nativeRenderer,getMarkdownTheme(),0);
 active=false;stock.setExpanded(true);assert.ok(!rows(stock,28).join('').includes('SOURCE_FOLLOWUP'));assert.ok(!rows(stock,28).join('').includes('BODY_ONLY_TAIL'));active=true;
 // Unsupported payloads delegate byte-for-byte to native, including its fallback.
 const badName=make({name:42});active=false;assert.throws(()=>rows(card(badName)),TypeError);active=true;assert.throws(()=>rows(card(badName)),TypeError);
 for(const m of [{...make(),details:null},{...make(),content:[{type:'image',data:'synthetic',mimeType:'image/png'}]},make({status:'running'}),make({status:'waiting'}),make({status:'started'}),make({status:'question'}),make({question:'Pending action?'}),make({requiresAction:true}),{...make(),customType:'ordinary'}]) {
  active=false;const expected=rows(card(m));active=true;assert.deepEqual(rows(card(m)),expected);
 }
 for(const type of ['subagent_status']) {
  const renderer=runner.getMessageRenderer(type),m={...make(),customType:type,details:{name:'Worker',lines:['Still running'],question:'Must answer now'}};
  active=false;const expected=rows(card(m,1,renderer));active=true;assert.deepEqual(rows(card(m,1,renderer)),expected);
 }
 const absent=()=>undefined,throws=()=>{throw Error('Synthetic renderer failure');};
 for(const renderer of [absent,throws]) {const cc=card(make(),1,renderer);assert.equal(cc.customRenderer,renderer);assert.match(rows(cc).join('\n'),/Original report/);}
 const cycle=make();cycle.details.self=cycle.details;active=false;const cycleStock=rows(card(cycle));active=true;assert.deepEqual(rows(card(cycle)),cycleStock);
 const malformed=card(make());delete malformed.outputPad;const oldComponent=malformed.customComponent;malformed.rebuild();assert.equal(malformed.customRenderer,nativeRenderer);assert.notEqual(malformed.customComponent,oldComponent);
 const throwingRebuild=card(make()),removeChild=throwingRebuild.removeChild;throwingRebuild.removeChild=()=>{throw Error('Synthetic rebuild throw');};
 assert.throws(()=>throwingRebuild.rebuild(),/Synthetic rebuild throw/);assert.equal(throwingRebuild.customRenderer,nativeRenderer);throwingRebuild.removeChild=removeChild;throwingRebuild.rebuild();
 // Completed cards remain actual custom-message boundaries for quiet tools.
 const groups=new QuietGroups();const assistant=id=>({role:'assistant',content:[{type:'toolCall',id,name:'read',arguments:{}}]});
 groups.assistant(assistant('before'));groups.result('before','read',{content:[]});groups.message(source);groups.assistant(assistant('after'));groups.result('after','read',{content:[]});
 assert.match(groups.summary('before'),/1 call/);assert.match(groups.summary('after'),/1 call/);
 // Read-only companion integration: sticky anchors use real leaf heights, not
 // traversal or patched roots in this adapter, in collapsed and expanded modes.
 const firstPrompt=new sdk.UserMessageComponent('First prompt',getMarkdownTheme()),lastPrompt=new sdk.UserMessageComponent('Last prompt',getMarkdownTheme());
 const document=new Container();document.addChild(firstPrompt);document.addChild(c);document.addChild(lastPrompt);
 for(const expanded of [false,true]) {
  c.setExpanded(expanded);const snapshot=collectPrompts(document,50);
  assert.equal(snapshot.height,document.render(50).length);assert.equal(snapshot.anchors[1].row,firstPrompt.render(50).length+c.render(50).length);
 }
 c.setExpanded(false);
 // No key/focus interception and native public controls are untouched.
 assert.equal(proto.setExpanded,origExpanded);assert.equal(c.handleInput,undefined);assert.equal(c.focused,undefined);
 // Unsupported mode and non-TUI activation restore existing cards lazily.
 mode='unsupported';assert.ok(rows(c).length>3);mode='quiet';c.invalidate();assert.equal(rows(c).length,2);
 active=false;assert.ok(rows(c).length>3);active=true;c.invalidate();assert.equal(rows(c).length,2);
 const first=proto.rebuild,successor=mod.installSubagentCards(()=>mode,()=>active);assert.notEqual(proto.rebuild,first);control.dispose();assert.notEqual(proto.rebuild,origRebuild);control=successor;
 c.invalidate();assert.equal(rows(c).length,2);const disposedSurface=c.customComponent;control.dispose();assert.equal(disposedSurface.handleMouse({type:'click',button:'left',x:0,y:0,width:100}),undefined);assert.equal(proto.rebuild,origRebuild);assert.equal(proto.render,origRender);assert.ok(rows(c).length>3,'existing card restores native after disposal with no registry');
 assert.equal(secondCalls,0);
} finally {control.dispose();}
const handlers={};mod.default({on:(event,handler)=>handlers[event]=handler},()=>mode);
handlers.session_start({}, {mode:'rpc'});assert.equal(proto.rebuild,origRebuild);
handlers.session_start({}, {mode:'tui',ui:{}});assert.notEqual(proto.rebuild,origRebuild);
handlers.session_shutdown();assert.equal(proto.rebuild,origRebuild);assert.equal(proto.render,origRender);
console.log('PASS: actual installed CustomMessageComponent + Amos renderers, SDK first-match/configured load order, quiet/compact/expanded preset, disclosure + bounded extractive report excerpts, actual stacked Container header click/open/close/per-card/global expansion, separator/body/drag/wheel pass-through, full wrapped original report/all JSON metadata, errors/quota/cancellation/unknowns, Unicode/narrow/themes/outputPad, immutable source, native status/unsupported fallback, no input/focus interception, lifecycle/version/shape/reload/lazy disposal guards.');
