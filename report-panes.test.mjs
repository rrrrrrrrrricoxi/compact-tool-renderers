// Shared report/question panes, real native components; no models/network/reload.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const host=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const require=createRequire(`${host}/package.json`),{createJiti}=require('jiti');
const tuiPath=`${host}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-coding-agent':`${host}/dist/index.js`,'@mariozechner/pi-coding-agent':`${host}/dist/index.js`,'@earendil-works/pi-tui':tuiPath,'@mariozechner/pi-tui':tuiPath,'@sinclair/typebox':require.resolve('typebox')}});
const cards=await jiti.import(new URL('./subagent-cards.ts',import.meta.url).pathname);
const {GroupPane}=await jiti.import(new URL('./group-pane.ts',import.meta.url).pathname);
const {QuietGroups,quietRenderer}=await jiti.import(new URL('./quiet-tools.ts',import.meta.url).pathname);
const {ThinkingGroups}=await jiti.import(new URL('./thinking-groups.ts',import.meta.url).pathname);
const {installThinkingPreview}=await jiti.import(new URL('./thinking-preview.ts',import.meta.url).pathname);
const {ToolExecutionComponent}=await import(pathToFileURL(`${host}/dist/modes/interactive/components/tool-execution.js`));
const {createAllToolRenderers}=await import(pathToFileURL(`${host}/dist/core/tools/renderers/index.js`));
const {paneBodyHeight,default:registerControls}=await jiti.import(new URL('./prompt-blocks.ts',import.meta.url).pathname);
const {activeDetails}=await jiti.import(new URL('./index.ts',import.meta.url).pathname);
const sdk=await import(pathToFileURL(`${host}/dist/index.js`));
const {loadExtensionFromFactory}=await import(pathToFileURL(`${host}/dist/core/extensions/index.js`));
const themes=await import(pathToFileURL(`${host}/dist/modes/interactive/theme/theme.js`));
const {Container,Markdown,visibleWidth}=await import(pathToFileURL(tuiPath));
const amos=await jiti.import('/Users/notrico/.pi/agent/git/github.com/amosblomqvist/pi-interactive-subagents/pi-extension/subagents/index.ts');
const native=await loadExtensionFromFactory(amos.default,'/tmp',sdk.createEventBus(),sdk.createExtensionRuntime(),'/synthetic/amos.ts');
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const plain=lines=>lines.map(strip).join('\n');
const record=c=>c[Object.getOwnPropertySymbols(c).find(key=>key.description==='compact-subagent-report-pane')];
const report={role:'custom',customType:'subagent_result',display:true,timestamp:123,content:'Sub-agent "Writer" completed (12s).\n\n## Changes\n\n**Implemented** shared panes.\n\n```js\nconst value = 1;\n```\n\n'+Array.from({length:80},(_,n)=>`Original report line ${n} 行🙂`).join('\n')+'\n\nREPORT_TAIL\n\nFollow up with subagent_message({ name: "Writer", message: "…" })',details:{name:'Writer',exitCode:0,elapsed:12,sessionId:'saved',unknown:'META_TAIL'}};
const question={role:'custom',customType:'subagent_question',display:true,timestamp:124,content:'Sub-agent "Scout" asks (5s):\n\nCan the parent inspect the Git log?\n\nReply with subagent_message({ name: "Scout", message: "…" })',details:{name:'Scout',agent:'scout',question:'## Parent decision\n\nCan the parent inspect the Git log?\n\n'+Array.from({length:35},(_,n)=>`Question explanation ${n}`).join('\n')+'\n\nQUESTION_TAIL',sessionId:'question-session'}};
const before=JSON.stringify([report,question]);
let mode='quiet',terminalRows=24,style={frame:true,bodyHighlight:true},toolActions=[],toolOpen=false;
const tools={onInteract(){},paneState:()=>({available:true,open:toolOpen,raw:false,actions:[{row:0,label:'read'}]}),paneAction:a=>{toolActions.push(a);if(a==='open')toolOpen=true;return true;}};
const details=activeDetails(tools,()=>mode);
let menuRequests=0;
themes.initTheme('dark',false);
const owner=cards.installSubagentCards(()=>mode,()=>true,'1.1.0',{height:()=>paneBodyHeight('auto',terminalRows),style:()=>style,onInteract:details.select,onControl:()=>menuRequests++});
const make=m=>new sdk.CustomMessageComponent(m,native.messageRenderers.get(m.customType),themes.getMarkdownTheme(),1);
try{
 // Compare actual native cards in one native mouse/layout root. outputPad is
 // supplied through native constructors, never by editing user preferences.
 const toolCall={type:'toolCall',id:'alignment-read',name:'read',arguments:{path:'/synthetic/alignment.ts'}};
 const assistant={role:'assistant',content:[{type:'thinking',thinking:'## Alignment topic\n\nRecorded thinking.'},toolCall],stopReason:'toolUse',timestamp:123};
 const toolResult={role:'toolResult',toolCallId:toolCall.id,toolName:'read',isError:false,content:[{type:'text',text:'Recorded output'}],details:{}};
 const branch=[{type:'message',message:assistant},{type:'message',message:toolResult}];
 const thinking=new ThinkingGroups(()=>themes.theme,()=>mode,()=>5,()=>style);thinking.rebuild(branch);
 const thinkingOwner=installThinkingPreview(()=>themes.theme,()=>mode,'1.1.0',thinking);
 try{
  const thought=new sdk.AssistantMessageComponent(assistant,true,themes.getMarkdownTheme());
  const variants=[report,{...report,details:{...report.details,exitCode:1,errorMessage:'Recorded failure'}},{...report,details:{...report.details,status:'cancelled'}},question];
  const leading=line=>visibleWidth(strip(line).match(/^ */)[0]);
  for(const outputPad of [0,1,2,4]){
   const groups=new QuietGroups();groups.rebuild(branch);
   const stock=createAllToolRenderers().read;
   const renderer=quietRenderer('read',stock,groups,()=>mode,args=>args.path,()=>5);
   const tool=new ToolExecutionComponent('read',toolCall.id,toolCall.arguments,{showImages:false,outputPad},{name:'read',...renderer},{requestRender(){}},'/synthetic');tool.updateResult(toolResult,false);
   for(const message of variants){
    const card=new sdk.CustomMessageComponent(message,native.messageRenderers.get(message.customType),themes.getMarkdownTheme(),outputPad);
    const nativeMouseRoot=new Container();nativeMouseRoot.addChild(tool);nativeMouseRoot.addChild(thought);nativeMouseRoot.addChild(card);
    for(const width of [1,2,3,4,28,50,100]){
     const toolRows=tool.render(width),thoughtRows=thought.render(width),cardRows=card.render(width);
     assert.equal(toolRows.length,2);assert.equal(cardRows.length,2);assert.equal(cardRows[0],'');
     assert.equal(leading(toolRows[1]),0);assert.equal(leading(thoughtRows[1]),0);
     assert.equal(leading(cardRows[1]),leading(toolRows[1]),`Quiet disclosure column: pad=${outputPad}, width=${width}, ${message.customType}/${message.details.status||message.details.exitCode}`);
     assert.equal(leading(cardRows[1]),leading(thoughtRows[1]));
     assert.ok(strip(cardRows[1]).startsWith('▸'),'disclosure itself, not differently spaced status glyphs');
     for(const line of nativeMouseRoot.render(width))assert.ok(visibleWidth(line)<=width);
     if(width>=50){
      if(message.details.exitCode===1)assert.match(plain(cardRows),/Failed.*Recorded failure/);
      if(message.details.status==='cancelled')assert.match(plain(cardRows),/Cancelled/);
      if(message.customType==='subagent_question')assert.match(plain(cardRows),/Child question/);
     }
     const headerY=toolRows.length+thoughtRows.length+1;
     const click=()=>{const rows=nativeMouseRoot.render(width);return nativeMouseRoot.handleMouse({type:'click',button:'left',x:leading(toolRows[1]),y:headerY,width,height:rows.length});};
     assert.equal(click().handled,true);assert.equal(card._expanded,true);assert.equal(details.state().label,`${message.customType==='subagent_question'?'Question':'Report'} · ${message.details.name}`);
     if(width===100){
      const expanded=card.render(width);assert.ok(strip(expanded[1]).startsWith('╭'));
      assert.ok(strip(expanded[2]).startsWith('│'+' '.repeat(outputPad)),'expanded body still honors native outputPad');
     }
     assert.equal(click().handled,true);assert.equal(card._expanded,false);assert.equal(card.render(width).length,2);
    }
    for(const otherMode of ['compact','expanded']){
     mode=otherMode;card.invalidate();
     assert.equal(leading(card.render(100)[1]),outputPad,`${otherMode} keeps native per-call padding`);
     card.setExpanded(true);assert.equal(leading(card.render(100)[1]),otherMode==='compact'?0:outputPad);
     card.setExpanded(false);
    }
    mode='quiet';card.invalidate();
   }
  }
 }finally{thinkingOwner.dispose();details.reset();}
 const r=make(report),q=make(question),parent=new sdk.UserMessageComponent('Original parent prompt',themes.getMarkdownTheme());
 const root=new Container();root.addChild(parent);root.addChild(r);root.addChild(q);
 const mouse=(c,type,y,extra={})=>{const offset=parent.render(100).length+(c===q?r.render(100).length:0);root.render(100);return root.handleMouse({type,button:type==='click'?'left':'none',x:2,y:offset+1+y,width:100,height:root.render(100).length,...extra});};
 assert.equal(r.render(100).length,2);assert.equal(q.render(100).length,2);
 assert.match(plain(q.render(100)),/Child question · Scout/);assert.ok(!plain(q.render(100)).includes('Completed'));
 assert.equal(cards.readableReport(question),question.details.question);
 assert.equal(mouse(r,'click',-1),undefined);assert.equal(r._expanded,false);
 assert.equal(mouse(r,'click',0).handled,true);assert.equal(r._expanded,true);
 assert.ok(record(r).pane instanceof GroupPane,'same shared GroupPane, not copied viewport');
 let lines=r.render(100);assert.equal(lines.length,paneBodyHeight('auto',24)+3);
 assert.ok(strip(lines[1]).startsWith('╭'));assert.ok(lines.slice(2,-1).every(line=>strip(line).startsWith('│')&&strip(line).endsWith('│')));
 assert.ok(!plain(lines).includes('Recorded metadata'));assert.ok(!plain(lines).includes('Original report (literal'));
 assert.ok(!plain(lines).includes('**Implemented**'),'readable Markdown, not literal syntax');
 assert.ok(!strip(lines.at(-1)).includes('Previous')&&!strip(lines.at(-1)).includes('Jump'));
 assert.equal(details.state().kind,'report');assert.equal(details.state().label,'Report · Writer');
 const footer=()=>strip(r.render(100).at(-1));
 const clickFooter=label=>{const view=r.render(100),x=strip(view.at(-1)).indexOf(label);assert.ok(x>=0,label);const out=mouse(r,'click',view.length-2,{x});assert.equal(out.handled,true);};
 const oldMarkdown=Markdown.prototype.render,reportMarkdown=record(r).markdown;let wraps=0;Markdown.prototype.render=function(...args){if(this===reportMarkdown)wraps++;return oldMarkdown.apply(this,args);};
 try{
  r.render(80);const initial=wraps;
  for(let n=0;n<40;n++){const out=mouse(r,'wheel',1,{wheelDelta:1});assert.equal(out.handled,true);assert.ok(!out.focus&&!out.capture);r.render(100);}
  const at100=wraps;for(let n=0;n<40;n++){mouse(r,'wheel',1,{wheelDelta:-1});r.render(100);}assert.equal(wraps,at100,'wheel reuses Markdown/body layout');
  for(const rows of [8,15,24,50]){terminalRows=rows;assert.ok(r.render(100).length<=paneBodyHeight('auto',rows)+3);}assert.equal(wraps,at100,'height only does not rewrap');terminalRows=24;
  assert.ok(wraps>=initial);
 }finally{Markdown.prototype.render=oldMarkdown;}
 assert.equal(mouse(r,'click',1),undefined,'body click is available for selection');assert.equal(mouse(r,'drag',1),undefined);
 // Fixed footer Raw/Close/Options and exact active report targets.
 details.action('home');r.render(100);clickFooter('[Raw]');assert.equal(record(r).pane.raw,true);assert.equal(details.state().raw,true);assert.match(plain(r.render(100)),/Original report \(literal/);
 let raw='';for(let n=0;n<150;n++){raw+=plain(r.render(100));mouse(r,'wheel',1,{wheelDelta:1});}
 assert.match(raw,/REPORT_TAIL/);assert.match(raw,/META_TAIL/);
 clickFooter('[Readable]');assert.equal(record(r).pane.raw,false);clickFooter('[Options]');assert.equal(menuRequests,1);
 clickFooter('[Close]');assert.equal(r._expanded,false);assert.equal(details.state().open,false,'native flag, not stale pane layout');
 assert.equal(details.action('open'),true);assert.equal(r._expanded,true);
 const oldToolCount=toolActions.length;details.action('down');assert.equal(toolActions.length,oldToolCount,'report action does not scroll previous tool pane');
 assert.equal(mouse(q,'click',0).handled,true);assert.equal(q._expanded,true);assert.equal(details.state().label,'Question · Scout');
 assert.ok(q.render(100).length<=paneBodyHeight('auto',24)+3);assert.match(plain(q.render(100)),/Parent decision/);assert.ok(!plain(q.render(100)).includes('Completed'));
 details.action('close');assert.equal(q._expanded,false);assert.equal(r._expanded,true,'another report remains open');
 details.action('open latest');assert.equal(toolOpen,true);assert.equal(details.state().kind,'tools');
 mouse(r,'click',0); // closes and selects r
 assert.equal(details.state().kind,'report');details.action('open');
 for(const width of [1,2,3,4,28,50,100])for(const c of [r,q])for(const line of c.render(width))assert.ok(visibleWidth(line)<=width);
 style={frame:false,bodyHighlight:false};r.render(100);assert.ok(!strip(r.render(100)[1]).startsWith('╭'));style={frame:true,bodyHighlight:true};
 mode='compact';r.invalidate();r.setExpanded(true);assert.ok(r.render(100).length<=paneBodyHeight('auto',24)+3);
 mode='expanded';r.invalidate();r.setExpanded(true);assert.ok(r.render(100).length>paneBodyHeight('auto',24)+3);assert.equal(mouse(r,'wheel',1,{wheelDelta:1}),undefined,'unbounded escape scrolls transcript');assert.equal(details.action('down'),false);
 assert.equal(details.action('raw'),true);assert.match(plain(r.render(100)),/META_TAIL/);assert.equal(r._expanded,true);
 // Question raw original/metadata is complete as well, with no answer mutation.
 q.invalidate();q.setExpanded(true);mouse(q,'click',0);details.action('open');details.action('raw');assert.match(plain(q.render(100)),/QUESTION_TAIL/);assert.match(plain(q.render(100)),/question-session/);
 assert.equal(JSON.stringify([report,question]),before);
 // Six root entries remain contextual, with no fake tool-call navigation.
 mode='quiet';r.invalidate();r.setExpanded(false);mouse(r,'click',0);
 const temp=mkdtempSync(join(tmpdir(),'pi-report-controls-')),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=temp;
 try{
  let command,choices=['Report…','Scroll…','down','Back','Report output:','Close pane','Open report pane','Back','Done'],menus=[],notices=[];
  registerControls({getCommands:()=>[],on(){},registerMarkdownTransformer(){},registerCommand:(_n,c)=>command=c},details.action,details.state);
  const ctx={mode:'tui',isIdle:()=>true,ui:{setToolsExpanded(){throw Error('report action must not reset global/per-card expansion');},getToolsExpanded:()=>false,notify:m=>notices.push(m),select:async(title,options)=>{menus.push({title,options});const pick=choices.shift();return pick?options.find(o=>o.includes(pick)):undefined;}}};
  await command.handler('',ctx);assert.equal(menus[0].options.length,6);assert.ok(menus.some(m=>m.title.startsWith('Report · Writer')));assert.ok(menus.every(m=>!m.options.some(o=>o.startsWith('Previous call')||o.startsWith('Jump to call'))));assert.equal(r._expanded,true);assert.equal(notices.length,0);
  mouse(q,'click',0); // closes and selects q
  choices=['Question…','Open report pane','Back','Done'];menus=[];await command.handler('',ctx);assert.ok(menus[0].options[0].startsWith('Question…'));assert.equal(q._expanded,true);
 }finally{old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(temp,{recursive:true,force:true});}
 details.reset();assert.equal(details.state().kind,'tools');
 owner.dispose();assert.ok(r.render(100).length>3);assert.equal(record(r),undefined);assert.equal(details.state().kind,'tools');
 console.log('PASS: native tool/thinking/report/question Quiet disclosure alignment across pad0/1/2/4 × widths1/2/3/4/28/50/100 and completed/failed/cancelled/question; root left-column clicks and preserved non-Quiet/body padding; shared GroupPane report/question frame, bounded Markdown/default45%/resize/cache/contained wheel; exact Raw source+metadata, fixed footer Native Close/Raw/Options, selected report/question vs tools and six-item menus; unbounded escape/root wheel, native per-card flags, immutable questions and owned cleanup.');
}finally{owner.dispose();}
