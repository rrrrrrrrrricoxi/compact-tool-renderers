import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const {visibleWidth}=await import(pathToFileURL(tuiPath));
const {initTheme,theme}=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {ToolExecutionComponent}=await import(pathToFileURL(`${root}/dist/modes/interactive/components/tool-execution.js`));
const {createAllToolRenderers}=await import(pathToFileURL(`${root}/dist/core/tools/renderers/index.js`));
const {codemodeRenderers}=await import(pathToFileURL(`${root}/dist/extensions/codemode/renderer.js`));
// Check the effective native ANSI foreground, not just a color token's presence.
function foregroundAt(row, label) {
 let foreground='default', plain='';
 for(const match of row.matchAll(/\x1b\[([0-9;]*)m|([^\x1b]+)/g)) {
  if(match[1]!==undefined) {
   const codes=match[1].split(';').map(Number);
   for(let i=0;i<codes.length;i++) {
    const code=codes[i];
    if(code===0||code===39)foreground='default';
    else if(code===38) {const mode=codes[++i],count=mode===2?3:1;foreground=[38,mode,...codes.slice(i+1,i+1+count)].join(';');i+=count;}
    else if(code>=30&&code<=37||code>=90&&code<=97)foreground=String(code);
    else if(code===48){const mode=codes[++i];i+=mode===2?3:1;}
   }
  }else{
   const next=plain+match[2];
   if(next.includes(label))return foreground;
   plain=next;
  }
 }
 assert.fail(`Missing color-test label: ${label}`);
}
initTheme('dark',false);
const stock={...createAllToolRenderers(),codemode:codemodeRenderers};
const module=await jiti.import(new URL('./quiet-tools.ts',import.meta.url).pathname);
const extension=await jiti.import(new URL('./index.ts',import.meta.url).pathname,{default:true});
const dir=mkdtempSync(join(tmpdir(),'pi-quiet-tools-'));
const old=process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR=dir;
try {
 writeFileSync(join(dir,'compact-tool-renderers.json'),JSON.stringify({mode:'quiet'}));
 const hooks=new Map(); let resolve; let redraws=0;
 extension({on:(name,fn)=>{if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push(fn);},getCommands:()=>[],registerToolRenderer:fn=>{resolve=fn;},registerMarkdownTransformer(){},registerCommand(){}});
 let branch=[];
 const ctx={mode:'tui',sessionManager:{getBranch:()=>branch},ui:{setToolsExpanded(){}}};
 const emit=async(name,event)=>{for(const fn of hooks.get(name)||[])await fn(event,ctx);};
 const assistant=(ids,names,text='')=>({role:'assistant',content:[...(text?[{type:'text',text}]:[]),...ids.map((id,i)=>({type:'toolCall',id,name:names[i],arguments:{}}))]});
 const result=(id,name,details={},text='FULL UNMODIFIED OUTPUT\nline two')=>({role:'toolResult',toolCallId:id,toolName:name,isError:false,content:[{type:'text',text}],details});
 const message=async(m)=>{await emit('message_end',{message:m});branch.push({type:'message',message:m});};
 const names=['codemode','codemode','codemode','bash','bash','codemode','read'];
 for(let i=0;i<names.length;i++) {
  const name=names[i],id=`old-${i}`;
  branch.push({type:'message',message:assistant([id],[name])});
  branch.push({type:'message',message:result(id,name,name==='codemode'?{calls:[{name:'read',status:'ok'}]}:{})});
 }
 const unchanged=JSON.stringify(branch);
 await emit('session_start',{});
 const make=(id,name,final)=>{
  const input=name==='codemode'?{code:'text("FULL SCRIPT")'}:name==='bash'?{command:'printf "FULL COMMAND"'}:{path:'/tmp/example.txt'};
  const definition={name,...resolve(name,()=>stock[name])};
  const card=new ToolExecutionComponent(name,id,input,{showImages:false,outputPad:1},definition,{requestRender:()=>{redraws++;}},'/tmp');
  if(final)card.updateResult(final,false);
  return card;
 };
 const cards=names.map((name,i)=>make(`old-${i}`,name,branch[i*2+1].message));
 assert.deepEqual(cards.map(c=>c.render(100).length),[0,0,0,0,0,0,2]);
 const groupLine=cards.at(-1).render(150).join('\n');
 assert.match(groupLine,/Tools · 7 calls · codemode ×4, bash ×2, read/);
 assert.ok(!groupLine.includes('Ctrl+O')&&!groupLine.includes('FULL UNMODIFIED OUTPUT'));
 assert.ok(!groupLine.includes('[48;'),'quiet success must have no filled background');
 for(const width of [1,10,20,80,150])for(const c of cards)for(const line of c.render(width))assert.ok(visibleWidth(line)<=width);
 assert.equal(JSON.stringify(branch),unchanged);
 // Native Ctrl+O opens bounded grouped detail by default, not raw blobs.
 for(const card of cards)card.setExpanded(true);
 assert.deepEqual(cards.slice(0,-1).map(c=>c.render(200).length),[0,0,0,0,0,0]);
 assert.ok(cards.at(-1).render(200).length<=13);
 assert.match(cards.at(-1).render(200).join('\n'),/1\/7 · codemode/);
 for(const card of cards)card.setExpanded(false);
 assert.deepEqual(cards.map(c=>c.render(100).length),[0,0,0,0,0,0,2]);
 // Live new calls join the earlier tool-only run and take over its single summary row.
 await message(assistant(['live-read'],['read']));
 const live=make('live-read','read');
 await emit('tool_execution_start',{toolCallId:'live-read',toolName:'read'}); live.markExecutionStarted();
 assert.equal(cards.at(-1).render(100).length,0);
 assert.match(live.render(150).join('\n'),/7\/8 settled · running read/);
 const final=result('live-read','read',{truncation:{truncated:true}});
 await emit('tool_execution_end',{toolCallId:'live-read',toolName:'read',result:final,isError:false}); live.updateResult(final,false);
 await message(final);
 assert.match(live.render(150).join('\n'),/Tools · 8 calls.*truncated/);
 // Prose is a real boundary: do not remove the preceding completed summary.
 await message(assistant(['after-prose'],['bash'],'Now I will run a different check.'));
 const after=make('after-prose','bash',result('after-prose','bash'));
 assert.match(after.render(150).join('\n'),/Tools · 1 call · bash/);
 assert.match(live.render(150).join('\n'),/Tools · 8 calls/);
 // An error inside codemode must be visible even when top-level isError is false.
 await message(assistant(['bad'],['codemode']));
 const badResult=result('bad','codemode',{calls:[{name:'read',status:'error',error:'permission denied'}]});
 await emit('tool_execution_end',{toolCallId:'bad',toolName:'codemode',result:badResult,isError:false});
 const bad=make('bad','codemode',badResult);
 assert.match(bad.render(200).join('\n'),/✗.*permission denied/);
 assert.ok(after.render(150).join('\n').includes('1 failed'));
 // Structured failures, nonzero exits, cancellations, async starts and image rows aren't hidden.
 for(const [name,details,text,content] of [
  ['bash',{},'permission denied\nProcess exited with code 2'],
  ['future_tool',{status:'cancelled'},''],
  ['subagent',{status:'started'},''],
  ['web_fetch',{isError:true,error:'HTTP 403'},''],
  ['read',{},'', [{type:'image',mimeType:'image/png',data:'unchanged-image'}]],
 ]) {
  const id=`exception-${name}`; await message(assistant([id],[name]));
  const r=result(id,name,details,text); if(content)r.content=content;
  await emit('tool_execution_end',{toolCallId:id,toolName:name,result:r,isError:false});
  const card=make(id,name,r); const output=card.render(200).join('\n');
  assert.ok(output.length>0,name); if(name==='read')assert.match(output,/1 image/);
  if(name==='bash')assert.match(output,/Failed ✗.*exit 2/);
  if(name==='future_tool')assert.match(output,/Cancelled/);
  if(name==='subagent')assert.match(output,/Started/);
  if(name==='web_fetch')assert.match(output,/HTTP 403/);
 }
 // Exact screenshot: repetition counts stay muted; two failures are an error-
 // colored status phrase, not another multiplication/cross glyph. Independent
 // group/native cards avoid changing the live/replay fixture above.
 const screenshotGroups=new module.QuietGroups();
 const screenshotNames=['bash','bash','codemode','codemode','edit'];
 const screenshotIds=screenshotNames.map((_,i)=>`screenshot-${i}`);
 const screenshotCall=assistant(screenshotIds,screenshotNames);
 const screenshotResults=screenshotNames.map((name,i)=>({...result(screenshotIds[i],name,i===0?{truncated:true,fullOutputPath:'/tmp/saved-output'}:{},i>=3?'Recorded failure':'Recorded success'),isError:i>=3}));
 const screenshotSource=JSON.stringify({screenshotCall,screenshotResults});
 screenshotGroups.assistant(screenshotCall);screenshotResults.forEach(r=>screenshotGroups.message(r));
 const screenshotCards=screenshotNames.map((name,i)=>{
  const renderers=module.quietRenderer(name,stock[name],screenshotGroups,()=> 'quiet',()=>name);
  const c=new ToolExecutionComponent(name,screenshotIds[i],{}, {showImages:false,outputPad:1},{name,...renderers},{requestRender(){}},dir);
  c.updateResult(screenshotResults[i],false);return c;
 });
 const screenshot=screenshotCards[2];
 const plain=row=>row.replace(/\x1b\[[0-9;]*m/g,'');
 assert.equal(screenshotGroups.summary(screenshotIds[2]),'Tools · 5 calls · bash ×2, codemode ×2, edit · 2 failed · truncated · full output saved');
 for(const palette of ['dark','light','system']) {
  initTheme(palette,false);screenshotCards.forEach(c=>c.invalidate());
  const muted=foregroundAt(theme.fg('muted','marker'),'marker'),error=foregroundAt(theme.fg('error','marker'),'marker');
  for(const expanded of [false,true]) {
   screenshot.setExpanded(expanded);
   const heading=screenshot.render(200)[1];
   assert.ok(!plain(heading).includes('✗'),'grouped count has no cross');
   assert.equal(foregroundAt(heading,'bash ×2'),muted);
   assert.equal(foregroundAt(heading,'codemode ×2'),muted);
   assert.equal(foregroundAt(heading,'2 failed'),error);
   assert.equal(foregroundAt(heading,'truncated'),muted,'neutral suffix restored after error foreground');
   assert.equal(foregroundAt(heading,'full output saved'),muted);
   for(const width of [1,2,3,4,28,50,100,200])for(const c of screenshotCards)for(const row of c.render(width))assert.ok(visibleWidth(row)<=width);
   if(!expanded)assert.equal(screenshot.render(200).length,2,'same native separator and one-row summary');
  }
  assert.match(plain(screenshotCards[3].render(200).join('\n')),/Failed ✗/,'standalone failure disclosure/icon retained');
 }
 screenshot.setExpanded(false);
 const recovered={...result(screenshotIds[3],'codemode',{},'Recovered recorded output'),isError:false};
 screenshotCards[3].updateResult(recovered,true);
 assert.match(plain(screenshotCards[3].render(200).join('\n')),/1 failed/);
 assert.equal(foregroundAt(screenshotCards[3].render(200)[1],'1 failed'),foregroundAt(theme.fg('error','marker'),'marker'));
 screenshotCards[3].updateResult(recovered,false);
 screenshotCards[4].updateResult({...result(screenshotIds[4],'edit'),isError:false},false);
 assert.ok(!plain(screenshotCards[4].render(200).join('\n')).includes('failed'),'failure count tracks actual result transitions');
 assert.equal(JSON.stringify({screenshotCall,screenshotResults}),screenshotSource,'styling preserves original calls/results');
 // Parent-id nested events must not create extra top-level rows/counts.
 const beforeNested=after.render(200).join('\n');
 await emit('tool_execution_start',{toolCallId:'bad/1',toolName:'read',parentToolCallId:'bad'});
 await emit('tool_execution_end',{toolCallId:'bad/1',toolName:'read',parentToolCallId:'bad',result:{content:[]},isError:false});
 assert.equal(after.render(200).join('\n'),beforeNested);
 // A human turn and custom report split runs; a branch rebuild drops abandoned IDs.
 const groups=new module.QuietGroups(); groups.assistant(assistant(['a'],['read'])); groups.result('a','read',{content:[]});
 groups.message({role:'user',content:[]}); groups.assistant(assistant(['b'],['bash'])); groups.result('b','bash',{content:[]});
 assert.match(groups.summary('a'),/1 call/); assert.match(groups.summary('b'),/1 call/);
 groups.message({role:'custom',display:true});groups.assistant(assistant(['c'],['read'])); assert.match(groups.summary('b'),/1 call/);
 groups.rebuild([{type:'message',message:assistant(['branch-only'],['read'])}]);assert.equal(groups.info('a'),undefined);
 assert.equal(module.resultState('future_tool',{content:[{type:'text',text:'{"status":"failed","error":"denied"}'}]}).status,'error');
 assert.ok(redraws>0 && redraws<300,'coalesced, bounded invalidation without recursion');
 await emit('session_shutdown',{});
 // The old per-call display remains intact as a rollback mode.
 writeFileSync(join(dir,'compact-tool-renderers.json'),JSON.stringify({mode:'compact'}));
 extension({on(){},getCommands:()=>[],registerToolRenderer:fn=>{resolve=fn;},registerMarkdownTransformer(){},registerCommand(){}});
 const restored=names.map((name,i)=>make(`old-${i}`,name,branch[i*2+1].message));
 assert.deepEqual(restored.map(c=>c.render(100).length),[3,3,3,3,3,3,3]);
 console.log('PASS: screenshot-equivalent 7 cards → one muted row; actual Pi zero-height shell; live grouping/running/error/truncation; bounded grouped Ctrl+O expansion; prose/user/custom/branch boundaries; cancelled/started/images; nested event exclusion; immutable messages; narrow Unicode-safe rendering; lifecycle cleanup');
} finally {old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(dir,{recursive:true,force:true});}
