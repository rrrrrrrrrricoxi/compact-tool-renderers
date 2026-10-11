import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const {visibleWidth}=await import(pathToFileURL(tuiPath));
const themeModule=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {ToolExecutionComponent}=await import(pathToFileURL(`${root}/dist/modes/interactive/components/tool-execution.js`));
const {createAllToolRenderers}=await import(pathToFileURL(`${root}/dist/core/tools/renderers/index.js`));
const {codemodeRenderers}=await import(pathToFileURL(`${root}/dist/extensions/codemode/renderer.js`));
const {readableText,readableValue,roundedDuration,GroupPane}=await jiti.import(new URL('./group-pane.ts',import.meta.url).pathname);
const {paneBodyHeight}=await jiti.import(new URL('./prompt-blocks.ts',import.meta.url).pathname);
const {QuietGroups}=await jiti.import(new URL('./quiet-tools.ts',import.meta.url).pathname);
const extension=await jiti.import(new URL('./index.ts',import.meta.url).pathname,{default:true});
const dir=mkdtempSync(join(tmpdir(),'pi-group-pane-'));
const old=process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR=dir;
const ansi=/\x1b\[[0-9;]*m/g;
const plain=lines=>(Array.isArray(lines)?lines.join('\n'):lines).replace(ansi,'');
try {
 themeModule.initTheme('dark',false);
 // Targeted mocks: current terminal dimensions, cache revisions, and short content.
 assert.deepEqual([8,15,24,50].map(rows=>paneBodyHeight('auto',rows)),[1,6,10,22]);
 assert.equal(paneBodyHeight(200,8),1);assert.equal(paneBodyHeight(3,50),3);assert.equal(paneBodyHeight('auto',undefined),10);
 let rows=24,revision=0,builds=0,count=1000;
 let pane;pane=new GroupPane(()=> 'Tools · mock',width=>{builds++;return Array.from({length:count},(_,n)=>('行🙂 '+n).slice(0,100));},()=>paneBodyHeight('auto',rows),()=>themeModule.theme,()=>{pane.invalidate();pane.render(80);},()=>revision);
 pane.open=true;assert.equal(pane.render(80).length,12);assert.equal(builds,1);
 for(let n=0;n<100;n++)pane.handleMouse({type:'wheel',button:'none',wheelDelta:1,x:2,y:3,width:80,height:11});
 assert.equal(builds,1,'100 wheel redraws must not relayout 1000 rows');
 revision++;pane.render(80);pane.render(80);assert.equal(builds,2,'content revision rebuilds once');
 pane.render(40);pane.render(40);assert.equal(builds,3,'width change rebuilds once');
 for(const height of [8,15,24,50]){rows=height;assert.ok(pane.render(40).length<=paneBodyHeight('auto',height)+2);}
 for(const width of [1,2,3,4,10,28,30,50,80])for(const line of pane.render(width))assert.ok(visibleWidth(line)<=width);
 count=0;revision++;assert.equal(pane.render(80).length,2);count=1;revision++;assert.equal(pane.render(80).length,3);
 themeModule.initTheme('light',false);const beforeTheme=builds;pane.render(80);assert.equal(builds,beforeTheme+1);pane.render(80);assert.equal(builds,beforeTheme+1);
 pane.render(80,true);assert.equal(pane.handleMouse({type:'click',button:'left',x:0,y:0,width:80,height:3},true),undefined);assert.equal(pane.render(80,false).length,1,'native header collapse clears prior local open');
 assert.equal(readableValue({path:'/long/path',timeout:10,nested:{status:'ok'}}),'path: /long/path\ntimeout: 10\nnested:\n  status: ok');
 assert.equal(roundedDuration(8.124665999), '8ms');assert.equal(roundedDuration(.91),'1ms');assert.equal(roundedDuration(1234),'1.2s');
 assert.equal(readableText('==> text 1/2 <==\n{"path":"a"}\n==> text 2/2 <==\n"line1\\nline2"\n'),'==> text 1/2 <==\npath: a\n==> text 2/2 <==\nline1\nline2\n');
 assert.equal(readableText('not JSON\\n stays literal'),'not JSON\\n stays literal');
 // Joining an already-observed member must invalidate the target group even
 // when the argument reference and status have not changed.
 const groups=new QuietGroups(),firstArgs={path:'first'},joinedArgs={path:'joined'};
 const toolCall=(id,arguments_)=>({role:'assistant',content:[{type:'toolCall',id,name:'read',arguments:arguments_}]});
 groups.assistant(toolCall('first',firstArgs));
 const first=groups.info('first'),groupPane=groups.pane(first,themeModule.theme,()=>200,()=>{});
 groupPane.open=true;assert.match(plain(groupPane.render(100)),/1\/1 · read/);
 groups.observe('joined','read').args=joinedArgs;
 const previousRevision=first.group.revision;
 groups.assistant(toolCall('joined',joinedArgs));
 assert.ok(first.group.revision>previousRevision);
 assert.match(plain(groupPane.render(100)),/2\/2 · read/);
 // Installed Pi tool shell/MouseRegion exercise, not mocks of the shell.
 writeFileSync(join(dir,'compact-tool-renderers.json'),JSON.stringify({mode:'quiet',paneHeight:5,otherPreference:true}));
 let hooks,commands,resolver,redraws=0,reloads=0;const notices=[];
 const install=()=>{hooks=new Map();commands=new Map();extension({on:(n,f)=>{if(!hooks.has(n))hooks.set(n,[]);hooks.get(n).push(f);},getCommands:()=>[],registerToolRenderer:f=>resolver=f,registerMarkdownTransformer(){},registerCommand:(n,c)=>commands.set(n,c)});};install();
 const calls=[{id:'first',name:'read',arguments:{path:'/tmp/group-example.ts'}},{id:'second',name:'bash',arguments:{command:'printf example',timeout:10}},{id:'third',name:'ask_question',arguments:{question:'Which option?'}},{id:'fourth',name:'codemode',arguments:{code:'const result = await tools.read({path:"example"});\ntext(result);'}}];
 const results=calls.map((c,i)=>({role:'toolResult',toolCallId:c.id,toolName:c.name,isError:false,content:[{type:'text',text:i===3?'==> text 1/1 <==\n'+JSON.stringify({check:0,result:{status:'fulfilled',value:{output:'alpha\nbeta\ngamma',exit_code:0}}}):'recorded output '+i+'\n'+Array.from({length:15},(_,n)=>`line ${n}`).join('\n')}],details:i===3?{calls:[{id:'fourth/1',name:'read',args:'{"path":"example","timeout":10}',status:'ok',durationMs:8.12345},{id:'fourth/2',name:'bash',arguments:{command:'echo nested\nprintf second',options:{timeout:10}},status:'ok',durationMs:.91}]}:{},...(i===3?{nestedCalls:{calls:[{id:'fourth/1',name:'read',arguments:{path:'example'},status:'ok'}],complete:false}}:{})}));
 let branch=[{type:'message',message:{role:'assistant',content:calls.map(c=>({type:'toolCall',...c}))}},...results.map(message=>({type:'message',message}))];
 const original=JSON.stringify(branch);
 const allCards=[];
 const ctx={mode:'tui',sessionManager:{getBranch:()=>branch},isIdle:()=>true,reload:async()=>{reloads++;},ui:{setToolsExpanded(expanded){for(const card of allCards)card.setExpanded(expanded);},getToolsExpanded:()=>false,notify:(m)=>notices.push(m)}};
 const emit=async(n,e={})=>{for(const f of hooks.get(n)||[])await f(e,ctx);};
 const command=async(s)=>commands.get('blocks').handler(s,ctx);
 const stock={...createAllToolRenderers(),codemode:codemodeRenderers};
 let readLayouts=0;const originalReadResult=stock.read.renderResult;stock.read={...stock.read,renderResult(...args){readLayouts++;return originalReadResult(...args);}};
 const make=(c,result)=>{const card=new ToolExecutionComponent(c.name,c.id,c.arguments,{showImages:false,outputPad:1},{name:c.name,...resolver(c.name,()=>stock[c.name])},{requestRender:()=>redraws++},'/tmp');if(result)card.updateResult(result,false);allCards.push(card);return card;};
 await emit('session_start');const cards=calls.map((c,i)=>make(c,results[i]));const last=cards.at(-1);last.render(100);
 const click=last.handleMouse({type:'click',button:'left',x:1,y:1,width:100,height:2});assert.equal(click.handled,true);assert.ok(!click.focus&&!click.focusTarget);assert.equal(last.expanded,false);
 assert.equal(last.render(100).length,8,'separator + summary + 5 body rows + footer');assert.equal(cards[0].render(100).length,0);
 assert.ok(!last.render(100)[1].includes('/blocks'));assert.match(last.render(100).at(-1),/\[Jump…\].*\[Options\]/);
 // Navigation through the installed Pi ToolExecutionComponent/MouseRegion.
 await command('jump 2');let nav=plain(last.render(100));assert.match(nav.split('\n')[1],/2\/4 bash/);assert.match(nav,/┌ 2\/4 · bash/);
 await command('scroll down');await command('scroll down');await command('previous');assert.match(plain(last.render(100)),/┌ 2\/4 · bash/);
 await command('previous');assert.match(plain(last.render(100)),/┌ 1\/4 · read/);await command('next');assert.match(plain(last.render(100)),/┌ 2\/4 · bash/);
 let footer=plain(last.render(100).at(-1));let nextX=footer.indexOf('Next');const nextClick=last.handleMouse({type:'click',button:'left',x:nextX,y:7,width:100,height:8});assert.equal(nextClick.handled,true);assert.ok(!nextClick.focus&&!nextClick.focusTarget);assert.match(plain(last.render(100)),/┌ 3\/4 · ask_question/);assert.equal(last.expanded,false);
 ctx.ui.select=async(title,options)=>title==='Jump to recorded call'?options[0]:undefined;
 footer=plain(last.render(100).at(-1));last.handleMouse({type:'click',button:'left',x:footer.indexOf('Jump'),y:7,width:100,height:8});await new Promise(resolve=>setImmediate(resolve));assert.match(plain(last.render(100)),/┌ 1\/4 · read/);
 await command('frame off');assert.ok(!plain(last.render(100)[1]).startsWith('╭'));await command('body-highlight off');const offConfig=JSON.parse(readFileSync(join(dir,'compact-tool-renderers.json')));assert.equal(offConfig.frame,false);assert.equal(offConfig.bodyHighlight,false);assert.equal(offConfig.otherPreference,true);
 await command('frame on');await command('body-highlight on');assert.ok(plain(last.render(100)[1]).startsWith('╭'));assert.equal(reloads,0);
 const collect=async()=>{await command('scroll home');let captured='';for(let n=0;n<60;n++){captured+=plain(last.render(120))+'\n';await command('scroll page-down');}return captured;};
 const all=await collect();for(const [i,c] of calls.entries())assert.match(all,new RegExp(`${i+1}/4 · ${c.name}`));
 assert.match(all,/┌ 1\/4 · read/);assert.match(all,/│ path: \/tmp\/group-example.ts/);assert.match(all,/4\.1 · read/);assert.match(all,/path: example/);assert.match(all,/timeout: 10/);assert.match(all,/8ms/);assert.ok(!all.includes('8.12345'));assert.match(all,/4\.2 · bash/);assert.match(all,/printf second/);assert.match(all,/options:/);assert.match(all,/Script output \(not attributed/);assert.match(all,/alpha/);assert.match(all,/beta/);assert.match(all,/Nested record incomplete/);
 last.render(100);const cachedReadLayouts=readLayouts;for(let n=0;n<100;n++){last.handleMouse({type:'wheel',button:'none',wheelDelta:-1,x:1,y:3,width:100,height:8});last.render(100);}assert.equal(readLayouts,cachedReadLayouts,'actual tool-shell wheel redraw does not rebuild body');
 await command('raw');const raw=await collect();assert.match(raw,/alpha\\nbeta/);await command('raw');
 for(const delta of [-100000,100000,100000]){const wheel=last.handleMouse({type:'wheel',button:'none',wheelDelta:delta,x:1,y:3,width:100,height:8});assert.equal(wheel.handled,true);assert.ok(!wheel.focusTarget);}
 for(const width of [1,2,3,4,10,28,30,50,80])for(const line of last.render(width)){assert.ok(visibleWidth(line)<=width);assert.ok(last.render(width).length<=8);}
 await command('close');assert.equal(last.render(100).length,2);await command('scroll down');assert.match(notices.at(-1),/No active tool pane/);await command('open');assert.equal(last.render(100).length,8);await command('close');
 for(const card of cards)card.setExpanded(true);assert.equal(cards[0].render(100).length,0);assert.ok(last.render(100).length<=8);await command('scroll home');assert.match(plain(last.render(100)),/┌ 1\/4 · read/);
 await command('close');assert.ok(cards.every(card=>!card.expanded));assert.equal(last.render(100).length,2,'/blocks close collapses native Ctrl+O through public UI');
 await command('open');for(const card of cards)card.setExpanded(true);last.render(100);last.handleMouse({type:'click',button:'left',x:1,y:1,width:100,height:8});assert.equal(last.expanded,false);assert.equal(last.render(100).length,2,'native heading also clears prior local opening');for(const card of cards)card.setExpanded(false);
 await command('height auto');assert.equal(JSON.parse(readFileSync(join(dir,'compact-tool-renderers.json'))).paneHeight,'auto');await command('height 1');await command('open');assert.ok(last.render(100).length<=4);await command('height 5');
 const saved=JSON.parse(readFileSync(join(dir,'compact-tool-renderers.json')));assert.equal(saved.otherPreference,true);await command('height 900');assert.equal(JSON.parse(readFileSync(join(dir,'compact-tool-renderers.json'))).paneHeight,5);assert.equal(reloads,0);assert.equal(JSON.stringify(branch),original);
 // Streaming summary owner changes, then running -> error and cancellation.
 await emit('message_end',{message:{role:'assistant',content:[{type:'toolCall',id:'live',name:'read',arguments:{path:'/tmp/live.txt'}}]}});
 const live=make({id:'live',name:'read',arguments:{path:'/tmp/live.txt'}});await emit('tool_execution_start',{toolCallId:'live',toolName:'read'});live.markExecutionStarted();assert.equal(last.render(120).length,0);assert.match(plain(live.render(120)),/4\/5 settled/);assert.ok(live.render(120).length<=8);
 const failure={content:[{type:'text',text:'permission denied'}],details:{}};await emit('tool_execution_end',{toolCallId:'live',toolName:'read',result:failure,isError:true});live.updateResult({...failure,isError:true},false);assert.match(plain(live.render(120)),/Failed/);live.setExpanded(true);assert.ok(live.render(120).length<=8);
 const cancelled={content:[],details:{status:'cancelled'}};await emit('message_end',{message:{role:'assistant',content:[{type:'toolCall',id:'cancel',name:'future_tool',arguments:{}}]}});await emit('tool_execution_end',{toolCallId:'cancel',toolName:'future_tool',result:cancelled,isError:false});const cancel=make({id:'cancel',name:'future_tool',arguments:{}},cancelled);assert.match(plain(cancel.render(100)),/cancelled/);cancel.setExpanded(true);assert.ok(cancel.render(100).length<=8);
 branch=[];await emit('session_tree');await command('open');assert.match(notices.at(-1),/No active tool pane/);await emit('session_shutdown');
 // Explicit expanded mode is the unbounded/raw escape; compact stays per-call.
 for(const mode of ['expanded','compact']){writeFileSync(join(dir,'compact-tool-renderers.json'),JSON.stringify({mode,paneHeight:5}));install();const card=make(calls[0],results[0]);card.setExpanded(true);assert.ok(card.render(100).length>8);assert.match(plain(card.render(100)),/recorded output 0/);}
 if(process.env.PI_RENDERER_REPLAY_SESSION){
  const entries=readFileSync(process.env.PI_RENDERER_REPLAY_SESSION,'utf8').trim().split('\n').map(line=>JSON.parse(line));const entry=entries[214];assert.equal(entry.message?.toolName,'codemode');const id=entry.message.toolCallId;
  const assistantEntry=entries.slice(0,214).reverse().find(e=>e.type==='message'&&e.message?.role==='assistant'&&e.message.content?.some(c=>c.type==='toolCall'&&c.id===id));const call=assistantEntry.message.content.find(c=>c.type==='toolCall'&&c.id===id);
  writeFileSync(join(dir,'compact-tool-renderers.json'),JSON.stringify({mode:'quiet',paneHeight:5}));install();branch=[{type:'message',message:{role:'assistant',content:[call]}},entry];await emit('session_start');const replay=make(call,entry.message);replay.setExpanded(true);assert.ok(replay.render(120).length<=8);
  const output=entry.message.content.filter(c=>c.type==='text').map(c=>readableText(c.text)).join('\n');console.log(`Offline screenshot replay: ${entry.message.content[1].text.length} raw characters → ${output.split('\n').length} readable lines; actual Ctrl+O card bounded to ${replay.render(120).length} rows including summary/footer/separator.`);
 }
 console.log('PASS: executed adaptive 8/15/24/50-row mocks; widths1/2/Unicode; empty/short content; 1000-line wheel cache; explicit content/width/theme revision; scalar/nested args and framing; installed Pi click/no focus/footer/action cards; mixed invocation order; bounded Ctrl+O/raw; explicit unbounded/compact escape; streaming owner/error/cancel; immutable branch/config fields.');
}finally{old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(dir,{recursive:true,force:true});}
