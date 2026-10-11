import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const root=process.env.PI_INSTALL_ROOT || '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent';
const {createJiti}=createRequire(`${root}/package.json`)('jiti');
const tuiPath=`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`;
const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-tui':tuiPath,'@earendil-works/pi-coding-agent':`${root}/dist/index.js`}});
const cards=await jiti.import(new URL('./subagent-cards.ts',import.meta.url).pathname);
const sdk=await import(pathToFileURL(`${root}/dist/index.js`));
const {InteractiveMode}=await import(pathToFileURL(`${root}/dist/modes/interactive/interactive-mode.js`));
const themes=await import(pathToFileURL(`${root}/dist/modes/interactive/theme/theme.js`));
const {Text}=await import(pathToFileURL(tuiPath));
const strip=s=>s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
const record=c=>c[Object.getOwnPropertySymbols(c).find(s=>s.description==='compact-subagent-report-pane')];
const proto=sdk.CustomMessageComponent.prototype,original={rebuild:proto.rebuild,render:proto.render};
const native=(m)=>new Text(`NATIVE ${m.customType}: ${m.content}`,0,0);
themes.initTheme('dark',false);
for(const mode of ['quiet','compact','quiet','compact']){
 const hooks={};let stale=false,redraws=0,targets=[];
 // Use the installed host UI factory and real setExtensionStatus implementation,
 // without starting a terminal. Its closures must not re-enter ExtensionRunner ctx.
 const host={footerDataProvider:{setExtensionStatus(key,value){assert.equal(key,'compact-tool-renderers/details-redraw');assert.equal(value,undefined);}},
  ui:{requestRender(){redraws++;}},setExtensionStatus:InteractiveMode.prototype.setExtensionStatus};
 const ui=InteractiveMode.prototype.createExtensionUIContext.call(host);
 const ctx={get mode(){if(stale)throw Error('SYNTHETIC_STALE_MODE');return 'tui';},get ui(){if(stale)throw Error('SYNTHETIC_STALE_UI');return ui;}};
 cards.default({on:(n,f)=>hooks[n]=f},()=>mode,{onInteract:t=>targets.push(t)});
 hooks.session_start({},ctx);
 const messages=[{role:'custom',customType:'subagent_result',display:true,content:'Original report details.',details:{name:'Report',exitCode:0}},
 {role:'custom',customType:'subagent_question',display:true,content:'Original question envelope.',details:{name:'Question',question:'Original question details.'}}];
 const before=JSON.stringify(messages);
 const surfaces=messages.map(m=>new sdk.CustomMessageComponent(m,native,themes.getMarkdownTheme(),1));
 surfaces.forEach(c=>{
  c.render(100);c.handleMouse({type:'click',button:'left',x:1,y:1,width:100,height:3});
  assert.ok(record(c));
 });
 const saved=surfaces.map(c=>({child:c.customComponent,target:record(c).target}));
 assert.equal(targets.length,2);
 stale=true;assert.throws(()=>ctx.mode,/SYNTHETIC_STALE_MODE/);assert.throws(()=>ctx.ui,/SYNTHETIC_STALE_UI/);
 // v1.17.0 throws from active() -> ctx.mode on this retained child repaint.
 saved.forEach(({child,target})=>{
  assert.ok(child.render(100).length>0);
  assert.equal(target.action('refresh'),true); // captured host UI method, not ctx.ui
 });
 assert.equal(redraws,2);
 hooks.session_shutdown();
 const next={};cards.default({on:(n,f)=>next[n]=f},()=>mode);
 for(const stage of ['shutdown','successor']){
  if(stage==='successor')next.session_start({}, {mode:'tui',ui});
  saved.forEach(({child,target},i)=>{
   assert.equal(target.valid(),false);assert.equal(target.state().available,false);
   for(const action of ['refresh','open','close','raw','down'])assert.equal(target.action(action),false);
   const rows=child.render(100).map(strip).join('\n');
   assert.ok(surfaces[i].render(100).length>0);
   assert.notEqual(surfaces[i].customComponent,child,'old child delegates to rebuilt current surface');
   if(stage==='shutdown') {
    assert.match(rows,/NATIVE/);
    assert.equal(record(surfaces[i]),undefined,'old surface lazily releases owned pane');
   } else {
    assert.ok(record(surfaces[i]));
    assert.notEqual(record(surfaces[i]).target,target,'successor owns a fresh target, never re-enables old target');
   }
  });
 }
 assert.equal(redraws,2,'stale saved actions never redraw');
 assert.equal(JSON.stringify(messages),before);next.session_shutdown();
}
assert.equal(proto.rebuild,original.rebuild);assert.equal(proto.render,original.render);
console.log('PASS: retained actual report/question components repaint with BOTH ctx.mode/ui revoked before shutdown; context-free redraw through actual installed host UI methods; saved targets/actions disabled, old surfaces native after shutdown and freshly owned after successor; repeated quiet/compact, immutable messages and owned cleanup.');
