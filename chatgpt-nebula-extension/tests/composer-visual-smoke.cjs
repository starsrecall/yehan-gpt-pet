/*
 * 普通聊天“方形外框＋圆角黑底内层”的来源派生真实 Chrome 回归。
 * 比较无扩展原生布局与同 DOM 启停，测几何、阴影、outline、四角半径，
 * 不把 alpha<1 当作已经对齐视觉表面的证据。图片仅存新测试工件目录。
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let playwright;
if(process.env.NEBULA_PLAYWRIGHT_PATH)playwright=require(process.env.NEBULA_PLAYWRIGHT_PATH);
else{try{playwright=require('playwright');}catch{throw new Error("需要 Playwright 测试依赖；请使用项目开发依赖或设置 NEBULA_PLAYWRIGHT_PATH。");}}
const rootDir=path.resolve(__dirname,'..'),extensionArg=process.argv.indexOf('--extension-dir');
const extensionDir=extensionArg<0?rootDir:path.resolve(process.argv[extensionArg+1]),before=process.argv.includes('--before');
const template=fs.readFileSync(path.join(__dirname,'fixtures','chatgpt-composer.html'),'utf8');
const variants=[
 {name:'classic-semantic-24',radius:24,surfaceClass:'rounded-3xl bg-token-main-surface-primary',style:'',theme:'',form:'',editor:'prompt-textarea'},
 {name:'classic-inline-black-28',radius:28,surfaceClass:'rounded-[28px] cursor-text',style:'style="background:rgb(12,12,12)"',theme:'',form:'',editor:'prompt-textarea'},
 {name:'classic-nested-theme-16',radius:16,surfaceClass:'rounded-2xl bg-surface-primary',scopeClass:'cursor-text',style:'',theme:'data-theme="dark"',form:'',editor:'prompt-textarea'},
 {name:'classic-nested-theme-inline-30',radius:30,surfaceClass:'rounded-[30px] bg-token-bg-primary',style:'style="background:#000"',theme:'data-theme="dark"',form:'',editor:'prompt-textarea'},
 {name:'work-recognized-24',radius:24,surfaceClass:'composer-surface-chrome',style:'',theme:'data-theme="dark"',form:'data-type="unified-composer"',editor:'work-native-editor'},
 {name:'primary-recognized-28',radius:28,surfaceClass:'bg-(--composer-surface-primary)',style:'',theme:'',form:'',formClass:'group/composer',editor:'prompt-textarea'},
 {name:'data-composer-surface-26',radius:26,surfaceClass:'rounded-[26px]',style:'style="background:#090909"',surfaceAttrs:'data-composer-surface-variant="pill" data-composer-layout="vertical"',theme:'',form:'',editor:'prompt-textarea'},
 {name:'unknown-shape-scope-26',radius:26,surfaceClass:'Fixture_randomPill__unobserved',style:'style="background:#050505"',theme:'',form:'',editor:'prompt-textarea',supported:false}
];
const attachmentChips=Array.from({length:7},(_,i)=>'<div class="attachment-chip"><span>▤　附件 '+(i+1)+' · 本机测试</span><button type="button" aria-label="移除附件 '+(i+1)+'">×</button></div>').join('');
function fixtureFor(variant){return template.replaceAll('__VARIANT__',variant.name).replaceAll('__RADIUS__',String(variant.radius)).replace('__FORM_ATTR__',variant.form).replace('__FORM_CLASS__',variant.formClass||'').replace('__SCOPE_CLASS__',variant.scopeClass||'').replace('__THEME_ATTR__',variant.theme).replace('__SURFACE_CLASS__',variant.surfaceClass).replace('__SURFACE_STYLE__',variant.style).replace('__SURFACE_ATTR__',variant.surfaceAttrs||'').replace('__EDITOR_ID__',variant.editor).replace('__ATTACHMENT_CHIPS__',attachmentChips);}
const report={startedAt:new Date().toISOString(),phase:before?'before':'after',scope:'真实 Chrome + 来源派生圆角输入区夹具；非实机账号 DOM。',extensionVersion:JSON.parse(fs.readFileSync(path.join(extensionDir,'manifest.json'),'utf8')).version,stylesheetSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir,'styles','site.css'))).digest('hex'),templateSha256:crypto.createHash('sha256').update(template).digest('hex'),checks:[],nativeBaselines:{},samples:{},errors:[],remoteRequests:[],profiles:[],screenshots:[]};
report.supportScope={supportedVariants:variants.filter(v=>v.supported!==false).map(v=>v.name),unknownVariants:variants.filter(v=>v.supported===false).map(v=>v.name),unknownPolicy:'未知纯随机内层只检查原生布局、焦点、操作及停用恢复，记录实际形状样式，不以测试通过宣称成功识别未知圆角。'};
report.fixtureSuiteSha256=crypto.createHash('sha256').update(variants.map(fixtureFor).join('\n')).digest('hex');
const resultPath=path.join(__dirname,before?'composer-results-before.json':'composer-results-after.json'),artifactDir=path.join(__dirname,'composer-artifacts',report.extensionVersion);
const contexts=[];let cleanContext,context,settingsPage,page;
async function check(name,action){try{const detail=await action();report.checks.push({name,passed:true,detail});process.stdout.write('PASS '+name+'\n');}catch(error){report.checks.push({name,passed:false,error:error.message});process.stdout.write('FAIL '+name+': '+error.message+'\n');}}
function alpha(color){if(color==='transparent')return 0;const parts=color.match(/^rgba?\(([^)]+)\)$/)?.[1].split(',').map(Number);if(!parts)throw new Error('无法解析颜色 '+color);return parts.length===4?parts[3]:1;}
async function launch(label){
 const profiles=path.resolve(rootDir,'..','.test-profiles');fs.mkdirSync(profiles,{recursive:true});const profile=fs.mkdtempSync(path.join(profiles,'nebula-composer-'+label+'-'));report.profiles.push(profile);
 const result=await playwright.chromium.launchPersistentContext(profile,{executablePath:process.env.NEBULA_CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check'],viewport:{width:1600,height:1000},reducedMotion:'no-preference'});contexts.push(result);
 await result.route('**/*',async route=>{const url=new URL(route.request().url());if(!['http:','https:'].includes(url.protocol))return route.continue();if(url.hostname==='chatgpt.com'){const variant=variants.find(v=>v.name===url.searchParams.get('variant'))||variants[0];return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixtureFor(variant),headers:{'content-security-policy':"default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; frame-src 'none'; connect-src 'none'; img-src 'none'; object-src 'none'"}});}report.remoteRequests.push(route.request().url());return route.abort();});
 result.on('page',candidate=>candidate.on('pageerror',error=>report.errors.push({url:candidate.url(),message:error.message})));return result;
}
async function openFixture(target,variant){const result=await target.newPage();await result.goto('https://chatgpt.com/nebula-composer-regression?variant='+variant.name);await result.locator('#actual-rounded-surface').waitFor();await result.evaluate(()=>document.fonts.ready);await result.waitForTimeout(200);return result;}
async function setState(target,attached,scrolled){await target.evaluate(({attached,scrolled})=>{document.getElementById('native-attachments').hidden=!attached;document.getElementById('native-menu').hidden=true;document.getElementById('protected-native-form').hidden=true;document.getElementById('model-native').setAttribute('aria-expanded','false');const editor=document.querySelector('#editor-region [contenteditable]');editor.textContent=Array.from({length:12},(_,i)=>'输入第 '+(i+1)+' 行，检查原生滚动和内边距。').join('\n');editor.scrollTop=scrolled?80:0;},{attached,scrolled});await target.waitForTimeout(100);}
async function enabled(mode,value){await settingsPage.evaluate(patch=>NebulaSettings.set(patch),{enabled:value,mode,preset:'character',panelOpacity:75,blur:12,dim:35,motion:false,accent:'#76d9ff'});if(value)await page.waitForFunction(mode=>document.documentElement.dataset.nebulaEnabled==='true'&&document.documentElement.dataset.nebulaMode===mode,mode);else await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-nebula-enabled'));await page.waitForTimeout(300);}
async function capture(target){return target.evaluate(()=>{
 const ids=['composer-wrapper','composer-theme-scope','actual-rounded-surface','native-attachments','editor-region','native-toolbar','native-disclaimer','attach-native','model-native','send-native'];
 const result={};const round=n=>Math.round(n*1000)/1000;
 for(const id of ids){const element=document.getElementById(id),s=getComputedStyle(element),r=element.getBoundingClientRect();result[id]={rect:{x:round(r.x),y:round(r.y),width:round(r.width),height:round(r.height)},padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],margin:[s.marginTop,s.marginRight,s.marginBottom,s.marginLeft],radius:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius],background:s.backgroundColor,shadow:s.boxShadow,blur:s.backdropFilter,outline:{style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor},border:{width:s.borderTopWidth,color:s.borderTopColor},scrollTop:round(element.scrollTop),scrollHeight:element.scrollHeight,clientHeight:element.clientHeight};}
 const editor=document.querySelector('#editor-region [contenteditable]'),s=getComputedStyle(editor),r=editor.getBoundingClientRect();result.editor={rect:{x:round(r.x),y:round(r.y),width:round(r.width),height:round(r.height)},padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft],margin:[s.marginTop,s.marginRight,s.marginBottom,s.marginLeft],radius:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius],border:{width:s.borderTopWidth,color:s.borderTopColor},scrollTop:round(editor.scrollTop),scrollHeight:editor.scrollHeight,clientHeight:editor.clientHeight,outline:{style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor}};return result;
 });}
function compareGeometry(actual,expected){const differences=[];for(const [id,native]of Object.entries(expected)){const value=actual[id];for(const key of ['x','y','width','height'])if(Math.abs(value.rect[key]-native.rect[key])>.5)differences.push(id+'.'+key+' '+native.rect[key]+'→'+value.rect[key]);for(const key of ['padding','margin','radius','scrollTop','scrollHeight','clientHeight'])if(JSON.stringify(value[key])!==JSON.stringify(native[key]))differences.push(id+'.'+key+' '+JSON.stringify(native[key])+'→'+JSON.stringify(value[key]));if(value.border.width!==native.border.width)differences.push(id+'.border-width');}assert.ok(differences.length===0,'原生输入布局改变:\n'+differences.slice(0,8).join('\n'));}
function assertSurface(actual,native){
 const surface=actual['actual-rounded-surface'];
 for(const id of ['composer-wrapper','composer-theme-scope']){const wrapper=actual[id];assert.equal(alpha(wrapper.background),0,id+' 方形外壳仍有底色 '+wrapper.background);assert.equal(wrapper.shadow,'none',id+' 外壳仍有蓝边/阴影 '+wrapper.shadow);assert.equal(wrapper.blur,'none',id+' 外壳仍有blur '+wrapper.blur);assert.equal(wrapper.outline.style,native[id].outline.style,id+' 原生outline style被修改');assert.equal(wrapper.outline.width,native[id].outline.width,id+' 原生outline width被修改');}
 assert.ok(Math.abs(alpha(surface.background)-.75)<.01,'真实圆角表面黑底未替换成设定玻璃: '+JSON.stringify(surface));
 assert.equal(surface.blur,'blur(12px)','blur 未落在真实圆角表面。');
 assert.deepEqual(surface.radius,native['actual-rounded-surface'].radius,'表面四角半径与原生不一致。');
 assert.ok(surface.radius.every(r=>parseFloat(r)>0),'被上色的表面不是原生圆角表面。');
 const accent='118, 217, 255';const borderBlue=parseFloat(surface.border.width)>0&&surface.border.color.includes(accent),outlineBlue=parseFloat(surface.outline.width)>0&&surface.outline.color.includes(accent),shadowBlue=surface.shadow!=='none'&&surface.shadow.includes(accent);
 assert.ok(borderBlue||outlineBlue||shadowBlue,'蓝色边缘未落在保留原生半径的同一表面: '+JSON.stringify(surface));
 assert.equal(actual['send-native'].background,native['send-native'].background,'原生发送按钮颜色被改变。');
}
async function installNativeActions(){await page.evaluate(()=>{
 document.getElementById('attach-native').addEventListener('click',()=>{document.getElementById('native-attachments').hidden=false;document.getElementById('attach-native').setAttribute('aria-pressed','true');document.getElementById('attach-icon').textContent='▤';});
 document.getElementById('model-native').addEventListener('click',()=>{const menu=document.getElementById('native-menu');menu.hidden=!menu.hidden;document.getElementById('protected-native-form').hidden=menu.hidden;document.getElementById('model-native').setAttribute('aria-expanded',String(!menu.hidden));});
 document.getElementById('send-native').addEventListener('click',()=>{document.getElementById('test-output').textContent=document.querySelector('#editor-region [contenteditable]').textContent;});
 });}

async function main(){
 fs.mkdirSync(artifactDir,{recursive:true});cleanContext=await launch('native');context=await launch('skin');report.browserVersion=context.browser().version();const loaded=await(await context.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked',{path:extensionDir});report.extensionId=loaded.id;
 settingsPage=await context.newPage();await settingsPage.goto('chrome-extension://'+loaded.id+'/options.html');await settingsPage.waitForFunction(()=>typeof NebulaSettings!=='undefined');await settingsPage.evaluate(()=>NebulaSettings.set({enabled:false}));
 for(const variant of variants){
  const nativePage=await openFixture(cleanContext,variant),native={};
  for(const attached of [false,true]){await setState(nativePage,attached,true);native[String(attached)]=await capture(nativePage);}report.nativeBaselines[variant.name]=native;
  page=await openFixture(context,variant);await installNativeActions();await enabled('soft',false);
  await check(variant.name+' 初始停用保持原生布局',async()=>{for(const attached of [false,true]){await setState(page,attached,true);compareGeometry(await capture(page),native[String(attached)]);}return '无扩展原生基线与相同DOM停用布局一致。';});
  for(const mode of ['soft','glass']){
   await enabled(mode,true);
   for(const attached of [false,true]){
    await setState(page,attached,true);await check(variant.name+'/'+mode+'/attachments='+attached+(variant.supported===false?' 未知结构保持布局并记录支持边界':' 圆角表面承担底色与蓝边'),async()=>{const actual=await capture(page);report.samples[variant.name+'/'+mode+'/'+attached]=actual;compareGeometry(actual,native[String(attached)]);if(variant.supported!==false)assertSurface(actual,native[String(attached)]);return {shapeRecognitionAsserted:variant.supported!==false,wrapper:actual['composer-wrapper'],surface:actual['actual-rounded-surface'],editor:actual.editor};});
   }
   await enabled(mode,false);await check(variant.name+'/'+mode+' 停用恢复原背景/阴影/形状',async()=>{for(const attached of [false,true]){await setState(page,attached,true);const actual=await capture(page);compareGeometry(actual,native[String(attached)]);for(const id of ['composer-wrapper','composer-theme-scope','actual-rounded-surface'])for(const key of ['background','shadow','blur'])assert.equal(actual[id][key],native[String(attached)][id][key],'停用后原外观未恢复: '+id+'/'+key);}return '原黑底、四角半径、wrapper透明及滚动均恢复。';});
  }
  await enabled('glass',true);await setState(page,false,false);
  await check(variant.name+' 原生附件/发送/图标和编辑焦点保留',async()=>{
   await page.locator('#attach-native').click();assert.equal(await page.locator('#attach-native').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#attach-icon').textContent(),'▤');assert.equal(await page.locator('.attachment-chip').count(),7);await page.locator('#native-attachments').waitFor({state:'visible'});
   const editor=page.locator('#editor-region [contenteditable]');await editor.fill('原生编辑与发送 ✓');await editor.focus();await page.keyboard.press('ArrowRight');const focus=await editor.evaluate(el=>({focused:document.activeElement===el,outline:getComputedStyle(el).outlineWidth}));assert.equal(focus.focused,true);assert.equal(focus.outline,'2px');await page.locator('#send-native').click();assert.equal(await page.locator('#test-output').textContent(),'原生编辑与发送 ✓');return {attachmentIcon:'▤',focus};
  });
  await check(variant.name+' menu与嵌套受保护输入保持实色',async()=>{
   await page.locator('#model-native').click();assert.equal(await page.locator('#model-native').getAttribute('aria-expanded'),'true');await page.locator('#native-menu').waitFor({state:'visible'});const actual=await page.evaluate(()=>['native-menu','nested-menu-theme','protected-native-form','protected-native-surface'].map(id=>{const element=document.getElementById(id),s=getComputedStyle(element);return{id,background:s.backgroundColor,shadow:s.boxShadow,blur:s.backdropFilter};}));for(const node of actual){assert.equal(alpha(node.background),1,'受保护弹层误绘为玻璃: '+JSON.stringify(node));assert.equal(node.blur,'none','受保护弹层误应用输入blur: '+JSON.stringify(node));}return actual;
  });
  await setState(page,true,true);await page.mouse.move(1500,950);const screenshot=path.join(artifactDir,(before?'before-':'after-')+variant.name+'.png');await page.screenshot({path:screenshot,fullPage:true});report.screenshots.push(screenshot);
  await enabled('glass',false);await page.close();await nativePage.close();
 }
 await check('形状回归没有脚本错误或额外远程请求',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.remoteRequests,[]);return '全程独立Chrome profile、本机页面与本机扩展。';});
}
main().catch(error=>{report.fatal={message:error.message,stack:error.stack};process.stdout.write('FATAL '+error.message+'\n');}).finally(async()=>{for(const context of contexts)await context.close();report.finishedAt=new Date().toISOString();report.passed=!report.fatal&&report.checks.every(check=>check.passed);fs.writeFileSync(resultPath,JSON.stringify(report,null,2));process.stdout.write('RESULT '+resultPath+'\n');process.exitCode=report.passed?0:1;});
