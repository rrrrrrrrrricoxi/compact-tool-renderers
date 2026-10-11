import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const mod=await jiti.import(new URL('./thinking-preview.ts',import.meta.url).pathname);
const {AssistantMessageComponent}=await import(pathToFileURL(`${root}/dist/index.js`));
const {initTheme,getMarkdownTheme,theme}=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {visibleWidth,MouseRegion}=await import(pathToFileURL(tuiPath));
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const message=content=>({role:'assistant',content,stopReason:'stop'});
const thought=text=>({type:'thinking',thinking:text});
const text=value=>({type:'text',text:value});
const prototype=AssistantMessageComponent.prototype;
const original=prototype.updateContent;
let mode='quiet';
initTheme('dark',false);
assert.equal(mod.thinkingTopic('**Considering request behavior**\n\nA long explanation.'),'Considering request behavior');
assert.equal(mod.thinkingTopic('# First\nBody\n## Second\nBody\n### Third'),'First / Second');
assert.equal(mod.thinkingTopic('# Same\n## Same'),'Same');
assert.equal(mod.thinkingTopic('A first sentence.\nMore details.'),'A first sentence.');
assert.equal(mod.thinkingTopic(''),'');
assert.ok(visibleWidth(mod.thinkingTopic('x'.repeat(100000)))<=160);
assert.ok(visibleWidth(mod.thinkingTopic('🙂'.repeat(200)))<=160);
assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(mod.thinkingTopic('🙂'.repeat(200))));
assert.equal(mod.thinkingTopic('**主题：连接与重定向**\n\n说明'),'主题：连接与重定向');
assert.ok(!mod.thinkingTopic('\x1b[31mhello\x1b[0m\u0007').includes('\x1b'));
assert.equal(mod.installThinkingPreview(()=>theme,()=>mode,'1.2.0'),undefined);
assert.equal(prototype.updateContent,original);
let control=mod.installThinkingPreview(()=>theme,()=>mode);
try {
 const source=message([thought('**Considering request behavior**\n\nHidden explanation about request encoding and redirects.'),text('Visible final answer.')]);
 const before=JSON.stringify(source);
 const card=new AssistantMessageComponent(source,true,getMarkdownTheme());
 const rows=card.render(160).map(strip);
 assert.match(rows.join('\n'),/▸ Thinking · 1 round · Considering request behavior/);
 assert.ok(!rows.join('\n').includes('Hidden explanation'));
 assert.ok(rows.join('\n').includes('Visible final answer'));
 const stock=new AssistantMessageComponent(source,false,getMarkdownTheme());
 assert.ok(rows.length<stock.render(160).length);
 for(const width of [1,2,8,20,80,160]) {
  const regions=card.contentContainer.children.filter(child=>child instanceof MouseRegion);
  const preview=regions[0].render(width);
  assert.equal(preview.length,1);
  assert.ok(visibleWidth(preview[0])<=width,`width ${width}`);
 }
 // Native Ctrl+T uses setHideThinkingBlock, without any extension shortcut override.
 card.setHideThinkingBlock(false);
 assert.ok(card.render(160).map(strip).join('\n').includes('Hidden explanation'));
 card.setHideThinkingBlock(true);
 assert.ok(!card.render(160).map(strip).join('\n').includes('Hidden explanation'));
 // Native per-block click expansion also survives.
 let region=card.contentContainer.children.find(child=>child instanceof MouseRegion);
 region.handleMouse({type:'click',button:'left',row:0,column:0});
 assert.ok(card.render(160).map(strip).join('\n').includes('Hidden explanation'));
 region=card.contentContainer.children.find(child=>child instanceof MouseRegion);
 region.handleMouse({type:'click',button:'left',row:0,column:0});
 assert.match(card.render(160).map(strip).join('\n'),/Thinking · 1 round · Considering/);
 assert.equal(JSON.stringify(source),before);
 assert.equal(card.lastMessage,source);
 // Multiple thinking runs use their own topics, not a global latest-message label.
 const multi=message([thought('## First topic\nDetails one'),thought('## Additional topic\nDetails two'),text('Middle prose'),thought('## Second run\nDetails three')]);
 const multiple=new AssistantMessageComponent(multi,true,getMarkdownTheme());
 const rendered=multiple.render(180).map(strip).join('\n');
 assert.match(rendered,/First topic \/ Additional topic/);
 assert.match(rendered,/Second run/);
 assert.match(rendered,/Middle prose/);
 // Empty blocks produce no fake thinking rows.
 assert.ok(!new AssistantMessageComponent(message([thought('  '),text('Answer')]),true,getMarkdownTheme()).render(100).map(strip).join('\n').includes('Thinking'));
 // Streaming updates refresh the preview while preserving the complete source.
 const streaming=new AssistantMessageComponent(undefined,true,getMarkdownTheme());
 const first=message([thought('## Checking')]);
 streaming.updateContent(first,true);
 assert.match(streaming.render(120).map(strip).join('\n'),/Checking/);
 const second=message([thought('## Checking compression\nFull evolving source.\n## Redirect rules\nMore details.')]);
 const secondBefore=JSON.stringify(second);
 streaming.updateContent(second,true);
 assert.match(streaming.render(160).map(strip).join('\n'),/Checking compression \/ Redirect rules/);
 assert.equal(JSON.stringify(second),secondBefore);
 assert.equal(streaming.isStreaming,true);
 // Native failure notice and tool-call classification remain intact.
 const failed={...source,stopReason:'error',errorMessage:'Synthetic provider failure'};
 assert.match(new AssistantMessageComponent(failed,true,getMarkdownTheme()).render(160).map(strip).join('\n'),/Synthetic provider failure/);
 const toolCard=new AssistantMessageComponent(message([thought('## Tool plan'),{type:'toolCall',id:'a',name:'read',arguments:{}}]),true,getMarkdownTheme());
 assert.equal(toolCard.hasToolCalls,true);
 // Ordinary prose is unaffected.
 const prose=new AssistantMessageComponent(message([text('Plain prose.')]),true,getMarkdownTheme());
 assert.match(prose.render(100).map(strip).join('\n'),/Plain prose/);
 // Native hidden/visible controls remain independent of the full block-display mode.
 mode='expanded';
 card.updateContent(source);
 assert.ok(!card.render(160).map(strip).join('\n').includes('Considering request behavior'));
 card.setHideThinkingBlock(false);
 assert.ok(card.render(160).map(strip).join('\n').includes('Hidden explanation'));
 mode='compact';card.setHideThinkingBlock(true);
 assert.match(card.render(160).map(strip).join('\n'),/Thinking · Considering/);
 for(const name of ['light','dark','system']) {
  initTheme(name,false);card.invalidate();
  assert.match(card.render(160).map(strip).join('\n'),/Thinking · Considering/);
 }
 // Reload replacement does not stack wrappers; disposing an older owner cannot undo its successor.
 const firstWrapper=prototype.updateContent;
 const successor=mod.installThinkingPreview(()=>theme,()=>mode);
 assert.notEqual(prototype.updateContent,firstWrapper);
 control.dispose();
 assert.notEqual(prototype.updateContent,original);
 control=successor;
} finally {control.dispose();}
assert.equal(prototype.updateContent,original);
// Lifecycle guard: never patch RPC/print mode; TUI startup invalidates UI only.
const handlers={};let rebuilds=0;
mod.default({on:(event,handler)=>{handlers[event]=handler;}},()=> 'quiet');
handlers.session_start({}, {mode:'rpc',ui:{}});
assert.equal(prototype.updateContent,original);
handlers.session_start({}, {mode:'tui',sessionManager:{getBranch:()=>[]},ui:{get theme(){return theme;},setHiddenThinkingLabel(){rebuilds++;}}});
assert.equal(rebuilds,1);
assert.notEqual(prototype.updateContent,original);
handlers.session_shutdown();
assert.equal(prototype.updateContent,original);
console.log('PASS: extractive thinking previews, independent runs, one-row/narrow/Unicode/theme rendering, native visibility and click expansion, streaming/errors, unchanged source, reload ownership, version and TUI-only guards.');
