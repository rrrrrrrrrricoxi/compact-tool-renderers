import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const {visibleWidth,Text}=await import(pathToFileURL(tuiPath));
const themes=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {GroupPane,actionCard,fillBackground}=await jiti.import(new URL('./group-pane.ts',import.meta.url).pathname);
const register=(await jiti.import(new URL('./prompt-blocks.ts',import.meta.url).pathname)).default;
const plain=s=>s.replace(/\x1b\[[0-9;:]*m/g,'');
// Independent effective-SGR inspection: each printable cell carries fg/bg state.
function cells(line){
 let bg='default',fg='default',out=[];
 for(const part of line.split(/(\x1b\[[0-9;:]*m)/)){
  if(part.startsWith('\x1b[')){
   const codes=part.slice(2,-1).split(';').map(Number);
   for(let i=0;i<codes.length;i++){
    const c=codes[i];
    if(c===0){bg='default';fg='default';}
    else if(c===49)bg='default';else if(c===39)fg='default';
    else if(c===38||c===48){const n=codes[i+1]===2?5:3;const color=codes.slice(i,i+n).join(';');if(c===48)bg=color;else fg=color;i+=n-1;}
    else if(c>=40&&c<=47||c>=100&&c<=107)bg=String(c);
    else if(c>=30&&c<=37||c>=90&&c<=97)fg=String(c);
   }
  }else for(const char of part)out.push({char,bg,fg});
 }
 return out;
}
for(const palette of ['dark','light']){
 themes.initTheme(palette,false);const theme=themes.theme;
 const base=cells(theme.bg('toolSuccessBg','x'))[0].bg;
 const error=cells(theme.bg('toolErrorBg','x'))[0].bg;
 const errorFg=cells(theme.fg('error','x'))[0].fg;
 for(const reset of ['\x1b[0m','\x1b[m','\x1b[49m','\x1b[22;49m','\x1b[0;31m']){
  const line=fillBackground('a'+reset+'b',10,theme,'toolSuccessBg');
  assert.ok(cells(line).every(c=>c.bg===base),`base resumes after ${JSON.stringify(reset)}`);
 }
 const off=actionCard('title',['plain body',''],20,theme,'ok',false);
 assert.ok(cells(off[1]).every(c=>c.bg==='default'),'highlight off leaves ordinary body unshaded');
 const added=theme.fg('toolDiffAdded','+ added');
 const addedFg=cells(added)[0].fg;
 assert.ok(cells(fillBackground(added,20,theme,'toolSuccessBg')).slice(0,7).every(c=>c.fg===addedFg&&c.bg===base),'diff foreground retained');
 const nested=theme.bg('toolErrorBg',theme.fg('error','ERR'))+' parent';
 const filled=cells(fillBackground(nested,20,theme,'toolSuccessBg'));
 assert.ok(filled.slice(0,3).every(c=>c.bg===error&&c.fg===errorFg));
 assert.ok(filled.slice(3).every(c=>c.bg===base),'nested error reset and trailing padding return to parent');
 for(const width of [1,2,3,4,28,50,100]){
  const wrapped=new Text(theme.fg('toolOutput','行🙂 é long words\n\nsecond'),0,0).render(Math.max(1,width-2));
  const card=actionCard('Unicode 行🙂',wrapped,width,theme,'ok');
  for(const line of card){assert.equal(visibleWidth(line),width);assert.ok(cells(line).every(c=>c.bg===base));}
  const clipped=fillBackground(theme.fg('toolOutput','123456789 行🙂'),width,theme,'toolSuccessBg');
  assert.equal(visibleWidth(clipped),width);assert.ok(cells(clipped).every(c=>c.bg===base));
 }
}
let builds=0,revision=0,style={frame:true,bodyHighlight:true};
let pane;pane=new GroupPane(()=> 'Tools',width=>{builds++;return {rows:Array.from({length:43},(_,i)=>fillBackground(`row ${i} 行🙂`,width,themes.theme,'toolSuccessBg')),actions:[{row:0,label:'read · first'},{row:20,label:'grep · second'},{row:40,label:'ls · last'}]};},()=>5,()=>themes.theme,()=>{},()=>revision,()=>style);
pane.open=true;pane.render(50);pane.action('jump 2');assert.equal(pane.scroll.scrollTop,20);
pane.action('down');pane.action('down');pane.render(50);assert.match(plain(pane.render(50)[0]),/2\/3 grep/);
pane.action('previous');assert.equal(pane.scroll.scrollTop,20);pane.action('previous');assert.equal(pane.scroll.scrollTop,0);
pane.action('next');assert.equal(pane.scroll.scrollTop,20);pane.action('next');assert.equal(pane.scroll.scrollTop,38,'short last call clamps natively');
let lines=pane.render(50);assert.match(plain(lines[0]),/2\/3 grep/,'indicator describes actual topmost call at clamp');assert.match(plain(lines.join('\n')),/row 40/,'last target is still visible');
assert.ok(lines.slice(1,-1).every(l=>plain(l).startsWith('│')&&plain(l).endsWith('│')));
assert.ok(plain(lines.at(-1)).startsWith('╰')&&plain(lines.at(-1)).endsWith('╯'));
for(let n=0;n<100;n++){pane.handleMouse({type:'wheel',wheelDelta:-1,button:'none',x:2,y:2});pane.render(50);}assert.equal(builds,1);
let controls=[];pane.onControl=action=>controls.push(action);
for(const width of [1,2,3,4,28,50,100]){
 lines=pane.render(width);for(const line of lines)assert.ok(visibleWidth(line)<=width);
 const footer=plain(lines.at(-1));
 if(width===50||width===100)assert.ok(footer.includes('[Options]'));if(width<28)assert.ok(!footer.includes('Options'));
 for(const [text,action] of [['Previous','previous'],['Prev','previous'],['Next','next'],['Jump','jump'],['Options','menu'],['⋯','menu']]){
  const x=footer.indexOf(text);if(x<0)continue;
  const response=pane.handleMouse({type:'click',button:'left',x,y:lines.length-1});assert.equal(response.handled,true);assert.ok(!response.focus&&!response.focusTarget);assert.equal(controls.at(-1),action);assert.ok(pane.isOpen);
 }
 const before=controls.length;pane.handleMouse({type:'click',button:'left',x:0,y:1});assert.equal(controls.length,before);
}
const oldBuilds=builds;style={frame:false,bodyHighlight:false};lines=pane.render(50);assert.equal(builds,oldBuilds+1);assert.ok(!plain(lines[0]).startsWith('╭'));assert.ok(!plain(lines[1]).startsWith('│'));
revision++;pane.render(50);assert.equal(builds,oldBuilds+2);
const short=new GroupPane(()=> 'Short',()=>['one'],()=>5,()=>themes.theme,()=>{});short.open=true;let clicked;short.onControl=a=>clicked=a;lines=short.render(50);const x=plain(lines.at(-1)).indexOf('Jump');short.handleMouse({type:'click',button:'left',x,y:2});assert.equal(clicked,'jump');
const dir=mkdtempSync(join(tmpdir(),'pi-visual-controls-'));const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=dir;
try{
 const path=join(dir,'compact-tool-renderers.json');writeFileSync(path,JSON.stringify({mode:'quiet',paneHeight:'auto',unknown:{preserve:true}}));
 let command,hooks={},actions=[],reloads=0,notices=[],idle=true,state={available:true,open:false,raw:false,actions:[{row:0,label:'read first'},{row:20,label:'grep second'}]},selections=[],menus=[];
 const ctx={mode:'tui',isIdle:()=>idle,reload:async()=>{reloads++;},ui:{setToolsExpanded(){},getToolsExpanded:()=>false,notify:m=>notices.push(m),select:async(title,options)=>{menus.push({title,options});const next=selections.shift();return next===undefined?undefined:typeof next==='function'?next(options):options.find(o=>o.includes(next));}}};
 const install=()=>register({getCommands:()=>[],on:(n,f)=>hooks[n]=f,registerMarkdownTransformer(){},registerCommand:(n,c)=>command=c},a=>{actions.push(a);if(a==='refresh')return true;if(a==='open'){state.open=true;return true;}if(!state.open)return false;if(a==='close')state.open=false;if(a==='raw')state.raw=!state.raw;return true;},()=>state);
 let display=install();hooks.session_start({},ctx);
 const before=readFileSync(path,'utf8');await command.handler('',ctx);assert.equal(readFileSync(path,'utf8'),before);assert.equal(reloads,0);
 assert.equal(menus[0].options.length,6);assert.deepEqual(menus[0].options.map(o=>o.split('…')[0]),['Tools','Thinking','Appearance','Display mode','Help & status','Done']);
 selections=['Appearance…','Outer frame:','Body background:','Height…',o=>o.find(v=>v==='5'),'Back','Tools…','Open latest','Scroll…',o=>o.find(v=>v==='page-down'),'Back','Previous call','Next call','Jump to call',o=>o.find(v=>v.startsWith('2.')),'Back','Appearance…','Tool output:','Back','Tools…','Close pane','Back','Done'];await command.handler('menu',ctx);
 assert.deepEqual(display.getPaneStyle(),{frame:false,bodyHighlight:false});assert.equal(display.getPaneHeight(),5);assert.ok(actions.includes('jump 2'));assert.ok(actions.includes('page-down'));assert.equal(state.open,false);assert.equal(state.raw,true);
 const saved=JSON.parse(readFileSync(path,'utf8'));assert.deepEqual(saved.unknown,{preserve:true});assert.equal(saved.frame,false);assert.equal(saved.bodyHighlight,false);assert.equal(reloads,0);
 display=install();hooks.session_start({},ctx);assert.deepEqual(display.getPaneStyle(),{frame:false,bodyHighlight:false});
 await command.handler('frame on',ctx);await command.handler('body-highlight on',ctx);assert.deepEqual(display.getPaneStyle(),{frame:true,bodyHighlight:true});
 await command.handler('open',ctx);const beforeJump=actions.length;selections=[undefined];await command.handler('jump',ctx);assert.equal(actions.length,beforeJump);
 await command.handler('jump 2',ctx);assert.equal(actions.at(-1),'jump 2');await command.handler('jump 900',ctx);assert.match(notices.at(-1),/ordinal/);
 await command.handler('help',ctx);assert.match(notices.at(-1),/coupled/);assert.ok(command.getArgumentCompletions('frame ').some(c=>c.value==='frame off'));
 const cancelBefore=readFileSync(path,'utf8');selections=['Appearance…','Height…',undefined,'Tools…',undefined,undefined];await command.handler('',ctx);assert.equal(readFileSync(path,'utf8'),cancelBefore,'submenu Escape returns root; root Escape exits with no writes');
 state.open=false;state.available=false;const unavailableStart=menus.length;selections=['Tools…','Back','Thinking…','Back','Done'];await command.handler('',ctx);assert.deepEqual(menus[unavailableStart+1].options,['Back']);assert.deepEqual(menus[unavailableStart+3].options,['Back']);state.available=true;
 idle=false;selections=['Display mode…','Compact','Back','Done'];await command.handler('',ctx);assert.equal(reloads,0);idle=true;
 const childKey=Symbol.for('pi-subagents/running-children-count');globalThis[childKey]=()=>1;try{selections=['Display mode…','Expanded','Back','Done'];await command.handler('',ctx);assert.equal(reloads,0);}finally{delete globalThis[childKey];}
 const realReload=ctx.reload;ctx.reload=async()=>{throw Error('Synthetic reload failure');};selections=['Display mode…','Compact','Back','Back','Done'];await command.handler('',ctx);assert.ok(menus.some(m=>m.title.includes('Could not apply option: Synthetic reload failure')&&m.options.join()==='Back'));assert.equal(JSON.parse(readFileSync(path,'utf8')).mode,'quiet');ctx.reload=realReload;
 const callsBefore=menus.length;selections=['Display mode…','Compact'];await command.handler('',ctx);assert.equal(reloads,1);assert.equal(menus.length,callsBefore+2,'mode reload exits all menus immediately');assert.match(menus.at(-1).title,/idle-only reload/);assert.ok(menus.at(-1).options.every(o=>!o.includes('reload')));
 display=install();hooks.session_start({},ctx);const outOfModeStart=menus.length;selections=['Tools…','Back','Done'];await command.handler('',ctx);assert.deepEqual(menus[outOfModeStart+1].options,['Back'],'compact mode hides irrelevant tool-pane choices');
 ctx.mode='print';await command.handler('',ctx);assert.match(notices.at(-1),/native controls/);assert.equal(reloads,1);
 console.log('PASS: installed themes/Text/ScrollView effective ANSI backgrounds incl 0/49/combined reset, nested error/foreground, padding/clipping/Unicode; widths 1/2/3/4/28/50/100; persistent midbody frame, cached anchors/navigation/clamp/footer hit ranges; native-select six-item hierarchy/submenus/Back/Escape/hidden unavailable choices/height/output controls/unknown preferences/readback/idle-child guard/reload exit/help/completions/non-TUI fallback.');
}finally{old===undefined?delete process.env.PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR=old;rmSync(dir,{recursive:true,force:true});}
