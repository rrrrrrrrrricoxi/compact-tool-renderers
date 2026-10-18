import assert from 'node:assert/strict';
import { loadSource, core, tui, themeModule, stripAnsi, assertCardBackground } from './test-runtime.mjs';
const { registerModernThinking } = await loadSource('./modern-thinking.ts');
const { installModernThinkingAdapter } = await loadSource('./modern-thinking-adapter.ts');
const { RecordedTextPane } = await loadSource('./modern-recorded-pane.ts');
const { createDisplayMode } = await loadSource('./display-mode.ts');
const { AssistantMessageComponent } = core;
const plain = lines => lines.map(stripAnsi).join('\n');
const round = n => ({ role: 'assistant', content: [{type:'thinking',thinking:`Round-${n} original first\nsecond original ${n}\n最后🙂`},{type:'toolCall',id:`c${n}`,name:'read',arguments:{path:'/fixture'}}], stopReason:'toolUse' });
const result = n => ({role:'toolResult',toolName:'read',toolCallId:`c${n}`,isError:false,content:[{type:'text',text:'fixture'}]});
const entry = message => ({type:'message',message});
const rounds = [round(1), round(2), round(3)];
let branch = rounds.flatMap((m,i) => [entry(m),entry(result(i+1))]);
const originalBranch = JSON.stringify(branch);
const listeners = new Map(), bus = new Map(), terminal = new Set(), cards = [];
const subscribe = (map,key,fn) => { const set = map.get(key)||new Set();map.set(key,set);set.add(fn);return()=>set.delete(fn); };
const pi = { on:(event,fn)=>subscribe(listeners,event,fn), events:{on:(event,fn)=>subscribe(bus,event,fn),emit:(event,data)=>{for(const fn of [...bus.get(event)||[]])fn(data);}} };
const mode = createDisplayMode();
const ctx = {mode:'tui',sessionManager:{getBranch:()=>branch},ui:{theme:themeModule.theme,setHiddenThinkingLabel(){for(const c of cards)c.setHiddenThinkingLabel('Thinking...');},onTerminalInput(fn){terminal.add(fn);return()=>terminal.delete(fn);}}};
const emit = (event,data={}) => { for(const fn of [...listeners.get(event)||[]])fn(data,ctx); };
const key = data => [...terminal].some(fn => fn(data)?.consume);
const native = {update:AssistantMessageComponent.prototype.updateContent,render:AssistantMessageComponent.prototype.render,mouse:AssistantMessageComponent.prototype.handleMouse};
let dispose = registerModernThinking(pi,mode);
emit('session_start',{type:'session_start',reason:'startup'});
try {
  cards.push(...rounds.map(m => new AssistantMessageComponent(m,true,themeModule.getMarkdownTheme())));
  assert.deepEqual(cards.slice(0,2).map(c=>c.render(70)),[[],[]]);
  assert.match(plain(cards[2].render(70)),/Thinking · 3 rounds/);
  const collapsedThinking = cards[2].render(100);
  assert.equal(collapsedThinking.length, 4, 'native spacer and padded three-row collapsed card');
  assert.equal(stripAnsi(collapsedThinking[1]).trim(), '', 'top padding keeps the card surface');
  assert.match(stripAnsi(collapsedThinking[2]), /^ ▸ Thinking/);
  assert.equal(stripAnsi(collapsedThinking.at(-1)).trim(), '', 'bottom padding keeps the card surface');
  assertCardBackground(cards[2].render(100).slice(1), 100, 'customMessageBg');
  assert.doesNotMatch(plain(cards[2].render(100)), /Alt\+T/, 'collapsed thinking omits repeated key hints');
  assert.equal(key('\x1b[B'),false,'arrows stay with editor until focused');
  assert.equal(key('\x1bt'),true);assert.equal(key('\r'),true);
  const expandedThinking = cards[2].render(100);
  assertCardBackground(expandedThinking.slice(1), 100, 'customMessageBg');
  const thinkingBody = expandedThinking.find(row => stripAnsi(row).includes('Round-1 original first'));
  assert.ok(thinkingBody.includes(themeModule.theme.getFgAnsi('text')), 'recorded thinking uses readable native text');
  assert.ok(!thinkingBody.includes(themeModule.theme.getFgAnsi('thinkingText')), 'body does not inherit dim thinking foreground');
  assert.match(stripAnsi(thinkingBody), /^   Round-1/, 'recorded thinking sits inside the heading');
  assert.match(stripAnsi(expandedThinking.at(-2)), /^ ↑\/↓ scroll/, 'footer shares the header gutter');
  assert.equal(stripAnsi(expandedThinking.at(-1)).trim(), '');
  let text = '';
  for(let n=0;n<14;n++){text+=plain(cards[2].render(70));key('\x1b[B');}
  for(let n=1;n<=3;n++)assert.match(text,new RegExp(`Round-${n} original first`));
  assert.ok(text.indexOf('Round-1')<text.indexOf('Round-2') && text.indexOf('Round-2')<text.indexOf('Round-3'));
  assert.equal(key('\x1b'),true);assert.equal(key('\x1b[B'),false);
  key('\x1bt');pi.events.emit('compact-renderer:focus:v1',{owner:'tools'});assert.equal(key('\r'),false);
  key('\x1bt');emit('ui_prompt_start');assert.equal(key('\r'),false);
  const mouseThinking = (y, type = 'click') => cards[2].handleMouse({ type, button: type === 'click' ? 'left' : 'none', x: 2, y, screenX: 2, screenY: y, width: 100, height: cards[2].render(100).length, wheelDelta: 1, shift: false, alt: false, ctrl: false });
  const beforePaddingClick = plain(cards[2].render(100));
  assert.equal(mouseThinking(1).handled, true);
  assert.equal(plain(cards[2].render(100)), beforePaddingClick, 'padding click cannot invoke native thinking expansion');
  assert.equal(mouseThinking(2).handled, true);
  assert.doesNotMatch(plain(cards[2].render(100)), /Round-1 original first/);
  assert.equal(key('\r'), false, 'mouse collapse leaves Enter with editor');
  mouseThinking(2);
  assert.match(plain(cards[2].render(100)), /Round-1 original first/);
  assert.doesNotMatch(plain(cards[2].render(100)), /focused/);
  assert.equal(key('\r'), false, 'mouse expansion leaves Enter with editor');
  for(const width of [1,2,3,8,24,70]) for(const row of cards[2].render(width))assert.ok(tui.visibleWidth(row)<=width);
  for(const c of cards)c.setHideThinkingBlock(false);
  for(let i=0;i<3;i++)assert.match(plain(cards[i].render(70)),new RegExp(`Round-${i+1} original first`));
  for(const c of cards)c.setHideThinkingBlock(true);
  cards[0].thinkingVisibilityOverrides.set(0,false);cards[0].updateContent(rounds[0]);
  assert.ok(cards.every(c=>c.render(70).length>0),'one native override restores every member');
  cards[0].setHideThinkingBlock(true);
  mode.setEnabled(false);assert.ok(cards.every(c=>c.render(70).length>0));mode.setEnabled(true);assert.equal(cards[0].render(70).length,0);
  // Actual resumed/rebuilt native components, with public lifecycle boundaries.
  for(const event of ['session_tree','session_compact']) {
    emit(event);assert.match(plain(cards[2].render(70)),/Thinking · 3 rounds/);assert.equal(terminal.size,1);
  }
  const error = {...result(3),isError:true};
  const visible = {role:'assistant',content:[{type:'text',text:'Visible answer'}],stopReason:'stop'};
  for(const boundary of [visible,error,{role:'user',content:'question'},{type:'toolResult',role:'toolResult',toolName:'ask_user_question',content:[],isError:false}]) {
    const a=round(8), b=round(9);branch=[entry(a),entry(boundary),entry(b)];cards.length=0;emit('session_start',{type:'session_start',reason:'resume'});
    cards.push(new AssistantMessageComponent(a,true,themeModule.getMarkdownTheme()),new AssistantMessageComponent(b,true,themeModule.getMarkdownTheme()));
    assert.ok(cards.every(c=>/Thinking · 1 round/.test(plain(c.render(70)))));
  }
  // Public streaming events may replace message objects; preserve recorded order.
  branch=[];cards.length=0;emit('session_start',{type:'session_start',reason:'resume'});
  const start=round(10);emit('message_start',{message:start});cards.push(new AssistantMessageComponent(start,true,themeModule.getMarkdownTheme()));
  const update={...start,content:[{type:'thinking',thinking:'Updated exact recorded text'},start.content[1]]};emit('message_update',{message:update});cards[0].updateContent(update);emit('message_end',{message:update});
  assert.match(plain(cards[0].render(70)),/Thinking · 1 round/);
  key('\x1bt');key('\r');assert.match(plain(cards[0].render(70)),/Updated exact recorded text/);
  // A very large recorded block still paints a bounded native assistant surface.
  const hugeRound={...round(11),content:[{type:'thinking',thinking:'Large exact recorded line 行🙂\n'.repeat(100000)},round(11).content[1]]};
  branch=[entry(hugeRound)];cards.length=0;emit('session_start',{type:'session_start',reason:'resume'});cards.push(new AssistantMessageComponent(hugeRound,true,themeModule.getMarkdownTheme()));
  const markdownRender=tui.Markdown.prototype.render;let markdownPaints=0;
  tui.Markdown.prototype.render=function(...args){markdownPaints++;return markdownRender.apply(this,args);};
  try{assert.match(plain(cards[0].render(60)),/Thinking · 1 round/);key('\x1bt');key('\r');assert.ok(cards[0].render(60).length<=17);assert.match(plain(cards[0].render(60)),/Large exact recorded line/);assert.equal(markdownPaints,0,'bounded thinking never eagerly paints native full Markdown');}
  finally{tui.Markdown.prototype.render=markdownRender;}
  // Exercise the real SessionManager and native initial transcript projection.
  // bindExtensions emits session_start before InteractiveMode.renderInitialMessages.
  const recorded=core.SessionManager.inMemory('/synthetic');
  for(const item of JSON.parse(originalBranch))recorded.appendMessage(item.message);
  const resumed=core.SessionManager.inMemory('/synthetic',undefined,JSON.parse(JSON.stringify(recorded.getEntries())));
  const originalManager=ctx.sessionManager;ctx.sessionManager=resumed;cards.length=0;
  emit('session_start',{type:'session_start',reason:'resume',previousSessionFile:'/synthetic/previous.jsonl'});
  const nativeDisplay=()=>{
    let messages;
    core.InteractiveMode.prototype.renderSessionEntries.call({renderer:undefined,renderSessionItems(items){messages=items;}},resumed.buildContextEntries());
    return messages;
  };
  const projected=nativeDisplay().filter(m=>m.role==='assistant');
  const branchMessages=resumed.getBranch().filter(e=>e.type==='message'&&e.message.role==='assistant').map(e=>e.message);
  assert.deepEqual(projected,branchMessages);projected.forEach((m,i)=>assert.equal(m,branchMessages[i],'native resume projection preserves recorded message identity'));
  cards.push(...projected.map(m=>new AssistantMessageComponent(m,true,themeModule.getMarkdownTheme())));
  assert.deepEqual(cards.slice(0,2).map(c=>c.render(70)),[[],[]]);assert.match(plain(cards[2].render(70)),/Thinking · 3 rounds/);
  for(const reason of ['reload','fork','new','startup','resume']){
    emit('session_start',{type:'session_start',reason});assert.equal(terminal.size,1);assert.match(plain(cards[2].render(70)),/Thinking · 3 rounds/);
  }
  // Native context entries omit pre-compaction rounds, so those missing cards
  // must not prevent retained thinking from grouping after compaction/resume.
  const kept=resumed.getBranch().find(e=>e.type==='message'&&e.message===branchMessages[1]);
  resumed.appendCompaction('Recorded fixture summary',kept.id,100);
  cards.length=0;emit('session_compact',{type:'session_compact',compactionEntry:resumed.getLeafEntry(),fromExtension:false,reason:'manual',willRetry:false});
  cards.push(...nativeDisplay().filter(m=>m.role==='assistant').map(m=>new AssistantMessageComponent(m,true,themeModule.getMarkdownTheme())));
  assert.equal(cards.length,2);assert.equal(cards[0].render(70).length,0);assert.match(plain(cards[1].render(70)),/Thinking · 2 rounds/);
  emit('session_start',{type:'session_start',reason:'resume'});assert.match(plain(cards[1].render(70)),/Thinking · 2 rounds/);
  ctx.sessionManager=originalManager;
  // Shutdown releases hooks/listeners; subsequent resume reinstalls one listener.
  emit('session_shutdown');assert.equal(terminal.size,0);assert.equal(AssistantMessageComponent.prototype.render,native.render);
  branch=rounds.map(entry);cards.length=0;emit('session_start',{type:'session_start',reason:'startup'});cards.push(...rounds.map(m=>new AssistantMessageComponent(m,true,themeModule.getMarkdownTheme())));
  assert.match(plain(cards[2].render(70)),/Thinking · 3 rounds/);
  dispose();dispose();assert.equal(terminal.size,0);assert.deepEqual({update:AssistantMessageComponent.prototype.updateContent,render:AssistantMessageComponent.prototype.render,mouse:AssistantMessageComponent.prototype.handleMouse},native);
  assert.ok(cards.every(c=>c.render(70).length>0));
  dispose=registerModernThinking(pi,mode);emit('session_start',{type:'session_start',reason:'startup'});assert.equal(terminal.size,1);
  const staleDispose=dispose;dispose=registerModernThinking(pi,mode);assert.equal(terminal.size,0,'replacement registration disposes the prior input listener');emit('session_start',{type:'session_start',reason:'startup'});assert.equal(terminal.size,1);staleDispose();assert.equal(terminal.size,1);dispose();
  assert.equal(JSON.stringify(rounds.flatMap((m,i)=>[entry(m),entry(result(i+1))])),originalBranch,'transcript objects remain exact');
  assert.equal(installModernThinkingAdapter({clear(){},associate(){},render(){},mouse(){}},'1.1.0'),undefined,'legacy gate is not widened');
  assert.equal(installModernThinkingAdapter({clear(){},associate(){},render(){},mouse(){}},'9.0.0'),undefined);
  const pane=new RecordedTextPane();const huge='Large exact recorded line 行🙂\n'.repeat(100000);pane.setSources([huge]);pane.open=true;
  const first=pane.view(60,9);assert.equal(first.length,9);assert.ok(pane.visitedCharacters<1000,'first paint visits only viewport and one lookahead');
  const visits=pane.visitedCharacters;for(let i=0;i<50;i++)pane.view(60,9);assert.equal(pane.visitedCharacters,visits,'stable paints do not reprocess source');
  pane.move('down',9);pane.view(60,9);assert.ok(pane.visitedCharacters-visits<100);
  pane.setSources(['\x1b]52;c;secret\x07\noriginal']);assert.ok(!pane.view(60,9).join('').includes('\x1b'),'recorded controls cannot execute');
  console.log('modern thinking: native grouping, keyboard, lifecycle, fallback, exact transcripts, and bounded painting passed');
} finally { dispose(); }
