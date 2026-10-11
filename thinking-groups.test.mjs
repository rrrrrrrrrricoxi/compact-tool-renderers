import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const preview=await jiti.import(new URL('./thinking-preview.ts',import.meta.url).pathname);
const {ThinkingGroups}=await jiti.import(new URL('./thinking-groups.ts',import.meta.url).pathname);
const {paneBodyHeight}=await jiti.import(new URL('./prompt-blocks.ts',import.meta.url).pathname);
const {AssistantMessageComponent}=await import(pathToFileURL(`${root}/dist/index.js`));
const themes=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {Container,Markdown,Text,visibleWidth}=await import(pathToFileURL(tuiPath));
const {UserMessageComponent}=await import(pathToFileURL(`${root}/dist/modes/interactive/components/user-message.js`));
const {ToolExecutionComponent}=await import(pathToFileURL(`${root}/dist/modes/interactive/components/tool-execution.js`));
const {createAllToolRenderers}=await import(pathToFileURL(`${root}/dist/core/tools/renderers/index.js`));
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const plain=lines=>lines.map(strip).join('\n');
const thought=s=>({type:'thinking',thinking:s});
const call=id=>({type:'toolCall',id,name:'read',arguments:{path:`/synthetic/${id}.ts`}});
const msg=(n,tools=true)=>({role:'assistant',content:[thought(`## Topic ${n} 行🙂\n\n${Array.from({length:10},(_,i)=>`Round ${n} original detail ${i}`).join('\n')}`),...(tools?[call(`c${n}`)]:[])],stopReason:'toolUse',timestamp:123});
const entry=message=>({type:'message',message});
const result=id=>({role:'toolResult',toolCallId:id,toolName:'read',isError:false,content:[{type:'text',text:'recorded code'}],details:{}});
themes.initTheme('dark',false);
const proto=AssistantMessageComponent.prototype;
const originals={update:proto.updateContent,render:proto.render,mouse:proto.handleMouse};
let mode='quiet',terminalRows=24;
const groups=new ThinkingGroups(()=>themes.theme,()=>mode,()=>paneBodyHeight('auto',terminalRows),()=>({frame:true,bodyHighlight:true}));
const messages=Array.from({length:5},(_,i)=>msg(i+1));
const branch=messages.flatMap(m=>[entry(m),entry(result(m.content[1].id))]);
const before=JSON.stringify(branch);
const stock=createAllToolRenderers();
const toolCards=messages.map(m=>{const c=m.content[1];const card=new ToolExecutionComponent('read',c.id,c.arguments,{showImages:false,outputPad:1},{name:'read',...stock.read},{requestRender(){}},'/synthetic');card.updateResult(result(c.id),false);return card;});
const toolBefore=toolCards.map(c=>c.render(100));
groups.rebuild(branch);
let owner=preview.installThinkingPreview(()=>themes.theme,()=>mode,'1.1.0',groups);
try{
 const cards=messages.map(m=>new AssistantMessageComponent(m,true,themes.getMarkdownTheme()));
 const rootContainer=new Container();cards.forEach(c=>rootContainer.addChild(c));
 assert.deepEqual(cards.slice(0,-1).map(c=>c.render(100)),[[],[],[],[]],'native leading Spacers produce no hidden-member gap');
 assert.equal(rootContainer.render(100).length,2);assert.equal(rootContainer.render(100)[0],'');assert.match(plain(rootContainer.render(100)),/Thinking · 5 rounds · Topic 5/);
 assert.deepEqual(toolCards.map(c=>c.render(100)),toolBefore,'real separately-owned tool components are unchanged');
 assert.equal(cards[0].hasToolCalls,true);
 const representative=cards.at(-1);
 const user=new UserMessageComponent('Original blue user prompt',themes.getMarkdownTheme(),1);
 const stack=new Container();stack.addChild(user);cards.forEach(c=>stack.addChild(c));
 const userRows=user.render(100).length;const stacked=stack.render(100);
 assert.equal(stacked.length,userRows+2);assert.equal(stacked[userRows],'','exactly one uncolored separator after native user card');assert.match(strip(stacked[userRows+1]),/Thinking · 5 rounds/);
 assert.equal(stack.handleMouse({type:'click',button:'left',x:2,y:userRows,width:100,height:stacked.length}),undefined,'separator click is not a header click');
 assert.equal(stack.handleMouse({type:'wheel',button:'none',wheelDelta:1,x:2,y:userRows,width:100,height:stacked.length}),undefined,'separator wheel remains outside thinking viewport');
 stack.handleMouse({type:'click',button:'left',x:2,y:0,width:100,height:stacked.length});assert.equal(groups.pane(groups.groupFor(representative).group).open,false,'user prompt clicks do not open thinking');
 const open=stack.handleMouse({type:'click',button:'left',x:2,y:userRows+1,width:100,height:stacked.length});assert.equal(open.handled,true);assert.ok(!open.focus&&!open.focusTarget);assert.equal(open.render,true);
 let lines=representative.render(100);assert.equal(lines.length,13);assert.match(plain(lines),/Round 1\/5/);assert.match(plain(lines),/Round 1 original detail/);
 let captured='';for(let i=0;i<150;i++){captured+=plain(representative.render(100))+'\n';const wheel=representative.handleMouse({type:'wheel',button:'none',wheelDelta:1,x:3,y:2,width:100,height:11});assert.equal(wheel.handled,true);assert.ok(!wheel.focus&&!wheel.focusTarget);}
 for(let n=1;n<=5;n++)assert.match(captured,new RegExp(`Round ${n} original detail 9`));
 assert.ok(captured.indexOf('Round 1 original detail 0')<captured.indexOf('Round 2 original detail 0'));assert.ok(captured.indexOf('Round 2 original detail 0')<captured.indexOf('Round 5 original detail 0'));
 assert.deepEqual(toolCards.map(c=>c.render(100)),toolBefore);
 let markdownBuilds=0;const originalMarkdown=Markdown.prototype.render;Markdown.prototype.render=function(...args){markdownBuilds++;return originalMarkdown.apply(this,args);};
 try{
  representative.render(80);const builds=markdownBuilds;
  for(let i=0;i<50;i++){representative.handleMouse({type:'wheel',button:'none',wheelDelta:-1,x:2,y:2,width:80,height:11});representative.render(80);}
  assert.equal(markdownBuilds,builds,'wheel does not relayout original thinking Markdown');
  for(const rows of [8,15,24,50]){terminalRows=rows;assert.ok(representative.render(80).length<=paneBodyHeight('auto',rows)+3);}assert.equal(markdownBuilds,builds,'height-only changes retain layout');terminalRows=24;
  for(const width of [1,2,3,4,28,50,100])for(const line of representative.render(width))assert.ok(visibleWidth(line)<=width);
  for(const name of ['light','dark']){themes.initTheme(name,false);for(const c of cards)c.invalidate();assert.match(plain(representative.render(100)),/Thinking · 5 rounds/);}
 }finally{Markdown.prototype.render=originalMarkdown;}
 // Fixed thinking footer contains only working thinking controls, no tool nav/menu.
 lines=representative.render(100);let footer=strip(lines.at(-1));assert.ok(!footer.includes('Jump')&&!footer.includes('/blocks'));
 const pane=groups.pane(groups.groupFor(representative).group);pane.action('home');representative.render(100);
 const downX=footer.indexOf('[↓]');stack.render(100);stack.handleMouse({type:'click',button:'left',x:downX,y:userRows+lines.length-1,width:100,height:userRows+lines.length});assert.equal(pane.scroll.scrollTop,1);
 const closeX=footer.indexOf('Close');stack.render(100);stack.handleMouse({type:'click',button:'left',x:closeX,y:userRows+lines.length-1,width:100,height:userRows+lines.length});assert.equal(representative.render(100).length,2);
 // Global Ctrl+T path is native; all original individual full rounds return.
 for(const c of cards)c.setHideThinkingBlock(false);
 for(let i=0;i<cards.length;i++){assert.match(plain(cards[i].render(100)),new RegExp(`Round ${i+1} original detail 9`));assert.equal(cards[i].hideThinkingBlock,false);}
 for(const c of cards)c.setHideThinkingBlock(true);assert.equal(rootContainer.render(100).length,2);
 // Explicit native per-run visibility override also bypasses grouping safely.
 cards[0].thinkingVisibilityOverrides.set(0,false);cards[0].updateContent(messages[0]);assert.ok(cards.every(c=>c.render(100).length>0));cards[0].setHideThinkingBlock(true);
 mode='compact';assert.ok(cards.every(c=>c.render(100).length>0));mode='expanded';assert.ok(cards.every(c=>c.render(100).length>0));mode='quiet';assert.equal(rootContainer.render(100).length,2);
 assert.equal(JSON.stringify(branch),before);
 // Exact refs only: an unobserved clone, even identical timestamp/content, stays native.
 const untrusted=new AssistantMessageComponent(structuredClone(messages[0]),true,themes.getMarkdownTheme());assert.ok(untrusted.render(100).length>1);assert.equal(groups.groupFor(untrusted),undefined);
 // Stream object replacement aliases the single ordered live record, not another round.
 const started={role:'assistant',content:[],stopReason:'toolUse',timestamp:123};groups.observe('start',started);
 const stream=new AssistantMessageComponent(started,true,themes.getMarkdownTheme());
 const partial=msg(6);groups.observe('update',partial);stream.updateContent(partial,true);assert.match(plain(stream.render(100)),/Thinking · 6 rounds/);assert.equal(representative.render(100).length,0);
 const updated={...partial,content:[thought('## New streaming topic\nFull current source'),call('c6')]};groups.observe('update',updated);stream.updateContent(updated,true);assert.match(plain(stream.render(100)),/6 rounds · New streaming topic/);
 // Later prose detaches the current round while leaving earlier group intact.
 const final={...updated,content:[...updated.content,{type:'text',text:'Visible prose remains native.'}],stopReason:'stop'};groups.observe('end',final);stream.updateContent(final,false);assert.match(plain(stream.render(100)),/Visible prose remains native/);assert.match(plain(representative.render(100)),/5 rounds/);assert.ok(stream.render(100).some(l=>l.includes('\x1b]133;'))===false,'tool-call native path retains its original OSC behavior');
 // Boundaries: user, visible prose/custom reports, compaction, branch summaries,
 // failed tool results and assistant errors/aborts/truncation split runs.
 for(const boundary of [entry({role:'user',content:'user'}),entry({role:'custom',display:true,content:'report'}),entry({role:'assistant',content:[{type:'text',text:'prose'}],stopReason:'stop'}),{type:'compaction'},{type:'branch_summary'},{type:'custom_message',display:true},entry({...result('x'),isError:true})]){
  const a=msg(10),b=msg(11);groups.rebuild([entry(a),boundary,entry(b)]);const ca=new AssistantMessageComponent(a,true,themes.getMarkdownTheme()),cb=new AssistantMessageComponent(b,true,themes.getMarkdownTheme());assert.match(plain(ca.render(100)),/Thinking · 1 round/);assert.match(plain(cb.render(100)),/Thinking · 1 round/);
 }
 for(const reason of ['error','aborted','length']){
  const a=msg(20,false),bad={...msg(21,false),stopReason:reason,errorMessage:'Original failure'},b=msg(22,false);groups.rebuild([entry(a),entry(bad),entry(b)]);const ca=new AssistantMessageComponent(a,true,themes.getMarkdownTheme()),cbad=new AssistantMessageComponent(bad,true,themes.getMarkdownTheme()),cb=new AssistantMessageComponent(b,true,themes.getMarkdownTheme());assert.match(plain(ca.render(100)),/1 round/);assert.match(plain(cb.render(100)),/1 round/);assert.match(plain(cbad.render(100)),reason==='length'?/truncated/:/Original failure/);
 }
 // Invisible custom/system + successful tool-only messages may bridge rounds.
 const a=msg(30,false),b=msg(31,false);groups.rebuild([entry(a),entry({role:'custom',display:false}),entry({role:'system'}),entry({role:'assistant',content:[call('bridge')],stopReason:'toolUse'}),entry(result('bridge')),entry(b)]);const ca=new AssistantMessageComponent(a,true,themes.getMarkdownTheme()),cb=new AssistantMessageComponent(b,true,themes.getMarkdownTheme());assert.equal(ca.render(100).length,0);assert.match(plain(cb.render(100)),/2 rounds/);
 cb.setHideThinkingBlock(false);const native=cb.render(100);assert.ok(native.some(l=>l.includes('\x1b]133;A')));assert.deepEqual(native,originals.render.call(cb,100),'native visible-thinking OSC render is unchanged');cb.setHideThinkingBlock(true);
 cb.contentContainer.addChild(new Text('Unexpected native shape',0,0));assert.match(plain(cb.render(100)),/Unexpected native shape/);assert.ok(ca.render(100).length>0,'shape drift fails back for whole group');cb.updateContent(b);
 // Short/narrow representatives retain the outer separator and correct mouse offset.
 const tiny={role:'assistant',content:[thought('Short')],stopReason:'stop'};groups.rebuild([entry(tiny)]);const tinyCard=new AssistantMessageComponent(tiny,true,themes.getMarkdownTheme());
 for(const width of [1,2,3,4,28,50,100]){
  let rendered=tinyCard.render(width);assert.equal(rendered.length,2);assert.equal(rendered[0],'');assert.equal(tinyCard.handleMouse({type:'click',button:'left',x:0,y:0,width,height:2}),undefined);
  tinyCard.handleMouse({type:'click',button:'left',x:0,y:1,width,height:2});rendered=tinyCard.render(width);assert.equal(rendered[0],'');assert.ok(rendered.length<=paneBodyHeight('auto',terminalRows)+3);for(const line of rendered)assert.ok(visibleWidth(line)<=width);
  const f=strip(rendered.at(-1));const close=f.indexOf('Close')>=0?f.indexOf('Close'):f.indexOf('×');
  if(close>=0){tinyCard.handleMouse({type:'click',button:'left',x:close,y:rendered.length-1,width,height:rendered.length});assert.equal(tinyCard.render(width).length,2);}else groups.action('close');
 }
 // Restore the prior association for the finalization mutation fixture.
 groups.rebuild([entry(a),entry(b)]);ca.updateContent(a);cb.updateContent(b);
 // Core mutation after extension end: render-time eligibility fails back safely.
 b.stopReason='length';assert.match(plain(cb.render(100)),/Thinking · 1 round · Topic 31/,'mutated finalization fails back before native update builds its notice');cb.updateContent(b);assert.match(plain(cb.render(100)),/truncated/);assert.match(plain(ca.render(100)),/1 round/);
 // Two separated groups: commands/state follow handled interaction, never render order.
 const old1=msg(50),old2=msg(51),recent=msg(52);groups.rebuild([entry(old1),entry(old2),entry({role:'user',content:'boundary'}),entry(recent)]);
 const oldCards=[old1,old2].map(m=>new AssistantMessageComponent(m,true,themes.getMarkdownTheme()));const recentCard=new AssistantMessageComponent(recent,true,themes.getMarkdownTheme());
 oldCards[1].render(100);oldCards[1].handleMouse({type:'click',button:'left',x:1,y:1,width:100,height:2});assert.equal(groups.state().rounds,2);assert.equal(groups.state().open,true);
 recentCard.render(100);assert.equal(groups.state().rounds,2,'render does not steal active thinking target');const oldPane=groups.pane(groups.groupFor(oldCards[1]).group);oldCards[1].render(100);groups.action('down');assert.equal(oldPane.scroll.scrollTop,1);assert.equal(groups.pane(groups.groupFor(recentCard).group).open,false);groups.action('close');assert.equal(oldPane.open,false);
 recentCard.handleMouse({type:'click',button:'left',x:1,y:1,width:100,height:2});assert.equal(groups.state().rounds,1);assert.equal(groups.state().open,true);
 for(const c of [...oldCards,recentCard])c.setHideThinkingBlock(false);assert.equal(groups.state().available,false);for(const c of [...oldCards,recentCard])c.setHideThinkingBlock(true);assert.equal(groups.state().rounds,1);
 // Reusing one actual component across boundaries must detach its old record,
 // leaving surviving earlier components/native full text untouched.
 for(const separator of [{role:'user',content:'u'},{role:'assistant',content:[{type:'text',text:'prose'}],stopReason:'stop'},{role:'custom',display:true,content:'report'}]){
  const first=msg(60),second=msg(61);groups.rebuild([entry(first),entry(second)]);const beforeReuse=JSON.stringify([first,second]);const earlier=new AssistantMessageComponent(first,true,themes.getMarkdownTheme()),reused=new AssistantMessageComponent(second,true,themes.getMarkdownTheme());assert.equal(earlier.render(100).length,0);
  groups.observe('end',separator);const start={role:'assistant',content:[],stopReason:'toolUse'};groups.observe('start',start);reused.updateContent(start,true);const clone=msg(62);groups.observe('update',clone);reused.updateContent(clone,true);groups.observe('end',clone);reused.updateContent(clone,false);
  assert.equal(groups.groupFor(earlier),undefined,'old group fails native rather than hiding an unrelated record');assert.ok(earlier.render(100).length>0);assert.match(plain(reused.render(100)),/1 round · Topic 62/);earlier.setHideThinkingBlock(false);assert.match(plain(earlier.render(100)),/Round 60 original detail 9/);assert.equal(JSON.stringify([first,second]),beforeReuse);
 }
 // Large-branch cost counters instrument only actual dirty regroup passes.
 const originalRegroup=groups.regroup;let passes=0;groups.regroup=function(...args){if(this.dirty)passes++;return originalRegroup.apply(this,args);};
 const large=Array.from({length:500},(_,i)=>msg(1000+i));groups.rebuild(large.map(entry));assert.equal(passes,1,'500-round branch builds membership once, not O(history²)');
 const largeCards=large.map(m=>new AssistantMessageComponent(m,true,themes.getMarkdownTheme()));for(const c of largeCards)c.render(50);assert.equal(passes,1,'ordinary renders do not rescan full history');
 const largeRepresentative=largeCards.at(-1);largeRepresentative.handleMouse({type:'click',button:'left',x:1,y:1,width:50,height:2});largeRepresentative.render(50);for(let n=0;n<30;n++){largeRepresentative.handleMouse({type:'wheel',button:'none',wheelDelta:1,x:1,y:2,width:50,height:12});largeRepresentative.render(50);}assert.equal(passes,1,'wheel/render requires no full-history regroup');
 large.at(-1).content[0].thinking='## Changed original text\nReplacement detail';largeRepresentative.updateContent(large.at(-1));const largePane=groups.pane(groups.groupFor(largeRepresentative).group);largeRepresentative.render(50);largePane.action('end');assert.match(plain(largeRepresentative.render(50)),/Replacement detail/);assert.equal(passes,1,'text changes invalidate only layout, not membership');
 large.at(-1).stopReason='length';largeCards[0].render(50);assert.equal(passes,2,'post-end stopReason mutation is caught before an earlier member paints');largeRepresentative.updateContent(large.at(-1));assert.match(plain(largeRepresentative.render(50)),/truncated/);groups.regroup=originalRegroup;
 // Branch rebuild drops old associations/state and does not retain abandoned panes.
 groups.rebuild([]);assert.equal(groups.state().available,false);assert.ok(ca.render(100).length>0);
 // Owned method cleanup/replacement: another wrapper is never overwritten.
 const successor=preview.installThinkingPreview(()=>themes.theme,()=>mode,'1.1.0',groups);owner.dispose();owner=successor;assert.notEqual(proto.render,originals.render);
 const ownRender=proto.render;const other=function(...args){return ownRender.apply(this,args);};proto.render=other;owner.dispose();assert.equal(proto.render,other);proto.render=originals.render;
 assert.equal(proto.updateContent,originals.update);assert.equal(proto.handleMouse,originals.mouse);
 console.log('PASS: five realistic thinking+tool-call rounds/actual tool components → one gap-free representative; chronological bounded original thinking, native Container mouse routing/working footer/wheel no focus; Markdown scroll/height cache; Ctrl+T/native overrides/mode bypass; ref-only stream replacement, prose detachment, all boundaries/finalization errors; 500-round branch: 1 membership pass, 0 additional ordinary render/wheel passes, text-only layout invalidation, 1 additional late-truncation pass; last-interacted targeting/reused-component guards; branch/theme/Unicode/narrow/source preservation and owned wrapper cleanup.');
}finally{owner?.dispose();if(proto.render!==originals.render)proto.render=originals.render;groups.clear();}
// Real registration lifecycle rebuilds original branch refs; commands redraw only UI.
const hooks={};let branchNow=[],redraws=0;
const ctx={mode:'tui',sessionManager:{getBranch:()=>branchNow},ui:{get theme(){return themes.theme;},setHiddenThinkingLabel(){redraws++;}}};
const registered=preview.default({on:(n,f)=>hooks[n]=f},()=> 'quiet');
const one=msg(40);branchNow=[entry(one)];hooks.session_start({},ctx);const single=new AssistantMessageComponent(one,true,themes.getMarkdownTheme());assert.match(plain(single.render(100)),/1 round/);assert.equal(registered.action('open'),true);assert.equal(redraws,2);assert.ok(single.render(100).length>2);
const temp=mkdtempSync(join(tmpdir(),'pi-thinking-menu-'));const oldAgent=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=temp;
try{
 const prompt=(await jiti.import(new URL('./prompt-blocks.ts',import.meta.url).pathname)).default;
 let command,notices=[],choices=['Thinking…','Close pane','Open pane','Back','Done'],menuCalls=0;
 prompt({getCommands:()=>[],on(){},registerMarkdownTransformer(){},registerCommand:(n,c)=>command=c},()=>false,()=>({available:false,open:false,raw:false,actions:[]}),registered);
 const commandCtx={...ctx,isIdle:()=>true,ui:{...ctx.ui,setToolsExpanded(){},getToolsExpanded:()=>false,notify:m=>notices.push(m),select:async(title,options)=>{menuCalls++;const target=choices.shift();return target?options.find(o=>o.startsWith(target)):undefined;}}};
 await command.handler('',commandCtx);assert.equal(menuCalls,5);assert.equal(registered.state().open,true,'menu closes/reopens current group');
 await command.handler('thinking down',commandCtx);await command.handler('thinking close',commandCtx);assert.equal(registered.state().open,false);
 await command.handler('thinking down',commandCtx);assert.match(notices.at(-1),/No available grouped thinking pane/);
 assert.ok(command.getArgumentCompletions('thinking ').some(c=>c.value==='thinking page-down'));
}finally{oldAgent===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=oldAgent;rmSync(temp,{recursive:true,force:true});}
const liveStart={role:'assistant',content:[],timestamp:one.timestamp,stopReason:'toolUse'};hooks.message_start({message:liveStart});const liveCard=new AssistantMessageComponent(liveStart,true,themes.getMarkdownTheme());
const liveUpdate=msg(41);hooks.message_update({message:liveUpdate});liveCard.updateContent(liveUpdate,true);assert.equal(registered.state().rounds,2);
const liveEnd={...liveUpdate,content:[...liveUpdate.content]};hooks.message_end({message:liveEnd});liveCard.updateContent(liveEnd,false);branchNow.push(entry(liveEnd));assert.equal(registered.state().rounds,2,'start/update/end clones dedup through real registration hooks');assert.equal(single.render(100).length,0);
hooks.message_start({message:{role:'user',content:'new boundary'}});const later=msg(42);hooks.message_start({message:later});const laterCard=new AssistantMessageComponent(later,true,themes.getMarkdownTheme());hooks.message_end({message:later});laterCard.updateContent(later,false);assert.equal(registered.state().rounds,2,'newly rendered groups do not steal interacted command target');assert.match(plain(laterCard.render(100)),/1 round/);laterCard.handleMouse({type:'click',button:'left',x:1,y:1,width:100,height:2});assert.equal(registered.state().rounds,1);assert.match(plain(liveCard.render(100)),/2 rounds/);
branchNow=[];hooks.session_switch({},ctx);assert.equal(registered.state().available,false);branchNow=[entry(one)];hooks.session_compact({},ctx);single.updateContent(one);assert.equal(registered.state().available,true);branchNow=[];hooks.session_tree({},ctx);assert.equal(registered.state().available,false);hooks.session_shutdown();assert.equal(proto.updateContent,originals.update);assert.equal(proto.render,originals.render);assert.equal(proto.handleMouse,originals.mouse);
