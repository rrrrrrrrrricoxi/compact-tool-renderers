import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorkStripPreview} from './preview-work-strip.mjs';
const preview=await createWorkStripPreview({stepMs:20});
const {core,runtime,manager}=preview;
const {visibleWidth}=await import(pathToFileURL(path.join(preview.runtimePath,'node_modules/@earendil-works/pi-tui/dist/index.js')));
const {theme,initTheme}=await import(pathToFileURL(path.join(preview.runtimePath,'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js')));
initTheme('dark',false);
const strip=s=>s.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const errors=[];
runtime.session.extensionRunner.onError(error=>errors.push(error));
const ui=new core.InteractiveMode(runtime,{tuiMode:'fullscreen'});
ui.updateTerminalTitle=()=>{};
Object.defineProperty(ui.ui,'isFollowingOutput',{get:()=>true});
const inputs=[];
runtime.session.extensionRunner.setUIContext({...ui.createExtensionUIContext(),theme,onTerminalInput(fn){inputs.push(fn);return()=>{};},setHiddenThinkingLabel(){},setStatus(){},setWidget(){},notify(){}},'tui');
const paint=()=>strip(ui.chatContainer.render(110).join('\n'));
let off;
try{
  // Native reload ordering: replay first, extension session_start second.
  ui.renderSessionEntries(manager.getBranch());
  await runtime.session.extensionRunner.emit({type:'session_start',reason:'resume'});
  const before=paint();
  const lines=before.split('\n');
  const dddLine=lines.findIndex(line=>line.includes('DDD · Five recorded maintenance'));
  assert.equal(lines[dddLine-1].trim(),'','DDD has the same one-line separation as decision rows');
  const projected=ui.chatContainer[Symbol.for('compact-renderer:projected-children:v1')];
  const canonical=ui.chatContainer.children;
  const skill=canonical.find(row=>row.constructor.name==='SkillInvocationMessageComponent');
  const skillPosition=projected.indexOf(skill);
  assert.ok(skillPosition>0,'native skill remains visible');
  assert.equal(projected[skillPosition-1],canonical[canonical.indexOf(skill)-1],'folding preserves the native gap before the skill');
  for(let i=1;i<projected.length;i++) if(projected[i] instanceof core.UserMessageComponent) {
    assert.equal(projected[i-1].constructor.name,'Spacer','next prompt keeps an outside gap after folded work');
  }
  const header=projected.find(row=>row.constructor.name==='WorkStripHeader');
  assert.ok(header.render(110).join('\n').includes(theme.fg('text',theme.bold('▸ '+header.title))),'work-strip label uses the primary text contrast');
  assert.match(strip(header.render(110).join('\n')),/Worked for.*─{4}/,'work strip has a visible divider');
  for(const width of [1,2,4,20,80,160]) for(const line of header.render(width)) assert.ok(visibleWidth(line)<=width,'divider stays within the terminal width');
  header.render(110);
  assert.equal(header.handleMouse({type:'click',button:'left',x:30,y:1})?.handled,true,'divider is part of the disclosure target');
  assert.equal(header.open,true);
  header.handleMouse({type:'click',button:'left',x:30,y:1});
  assert.equal((before.match(/▸ Worked for/g)||[]).length,3);
  assert.match(before,/Question · Answered/); assert.match(before,/DDD · Five recorded maintenance/);
  assert.doesNotMatch(before,/Run Node.js script|Subagent workflow|Synthetic instruction 70|Read files/);
  assert.match(before,/Work-strip preview/);
  // Final mixed thinking is folded, while final Markdown remains native.
  ui.isInitialized=true;
  off=runtime.session.subscribe(event=>ui.handleEvent(event));
  const playing=preview.play();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.match(paint(),/Working · 0s · Reading the recorded sample labels/);
  assert.match(paint(),/Reading the recorded sample labels/);
  if(process.env.PI_PREVIEW_STATUSLINE) {
    assert.ok(ui.customFooter,'matching native footer mounted');
    assert.doesNotMatch(strip(ui.customFooter.render(160).join('\n')),/Working ·/,'work strip owns execution status');
  }
  await playing; await new Promise(resolve=>setTimeout(resolve,150));
  const after=paint();
  assert.equal((after.match(/▸ Worked for/g)||[]).length,4);
  assert.doesNotMatch(after,/Comparing the recorded units|Checking the recorded result|Compare the invented samples|Thinking/);
  assert.match(after,/The invented samples agree/);
  assert.equal(manager.getBranch().filter(e=>e.customType==='compact-renderer:work-settled:v1').length,4);
  assert.deepEqual(errors,[]);
  console.log('Work strip real runtime preview, native reload order, live playback and final folding passed');
}finally{off?.(); ui.ui.stop(); await preview.cleanup(); ui.footerDataProvider.dispose();}
