/*
 * Chrome 实际加载扩展，测试新预设和整套风格按钮。全部网页为本地夹具。
 * 不读取真实账号，不修改日常浏览器资料；保留独立测试目录和发布证据。
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let playwright;
if(process.env.NEBULA_PLAYWRIGHT_PATH) playwright=require(process.env.NEBULA_PLAYWRIGHT_PATH);
else {try{playwright=require('playwright');}catch{throw new Error("需要 Playwright 测试依赖；请使用项目开发依赖或设置 NEBULA_PLAYWRIGHT_PATH。");}}
const dir=path.resolve(__dirname,'..'),fixture=fs.readFileSync(path.join(__dirname,'fixtures','chatgpt-wireframe.html'),'utf8');
const report={startedAt:new Date().toISOString(),extensionVersion:JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')).version,stylesheetSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'styles','site.css'))).digest('hex'),scope:'真实 Chrome / 本地模拟页面 / 独立 profile；非当前账号实机验证',checks:[],errors:[],remoteRequests:[],screenshots:[]};
let context,options,page,origin,failImage=false;
async function check(name,action){try{const detail=await action();report.checks.push({name,passed:true,detail});process.stdout.write('PASS '+name+'\n');}catch(error){report.checks.push({name,passed:false,error:error.message});process.stdout.write('FAIL '+name+': '+error.message+'\n');}}
async function config(patch){return options.evaluate(value=>NebulaSettings.set(value),patch);}
async function bg(){for(let i=0;i<80;i++){const f=page.frames().find(x=>x.url().startsWith(origin+'/backdrop.html'));if(f&&await f.locator('#wireframe-effects').count())return f;await page.waitForTimeout(100);}throw new Error('背景未挂载');}
async function stored(){return options.evaluate(()=>NebulaSettings.get());}
async function geometry(){return page.evaluate(()=>Object.fromEntries(['sidebar','main','thread','composer-form','composer-surface','prompt-textarea','sidebar-footer'].map(id=>{const n=document.getElementById(id),r=n.getBoundingClientRect(),s=getComputedStyle(n);return[id,{x:r.x,y:r.y,w:r.width,h:r.height,padding:s.padding,margin:s.margin,radius:s.borderRadius}];})));}
async function main(){
  const profiles=path.resolve(dir,'..','.test-profiles');fs.mkdirSync(profiles,{recursive:true});report.profile=fs.mkdtempSync(path.join(profiles,'nebula-wireframe-'));
  context=await playwright.chromium.launchPersistentContext(report.profile,{executablePath:process.env.NEBULA_CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check'],viewport:{width:1920,height:1080},reducedMotion:'no-preference'});
  await context.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(failImage&&u.protocol==='chrome-extension:'&&u.pathname==='/assets/wireframe-wallpaper.png')return route.abort();
    if(!['http:','https:'].includes(u.protocol))return route.continue();
    if(u.hostname==='chatgpt.com')return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture});
    report.remoteRequests.push(u.href);return route.abort();
  });
  context.on('page',p=>p.on('pageerror',e=>report.errors.push({url:p.url(),message:e.message})));
  const cdp=await context.browser().newBrowserCDPSession();report.browserVersion=(await cdp.send('Browser.getVersion')).product;
  origin='chrome-extension://'+(await cdp.send('Extensions.loadUnpacked',{path:dir})).id;
  options=await context.newPage();await options.goto(origin+'/options.html');await options.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已自动保存'));
  await config({enabled:false,motion:false,accent:'#abcdef',dim:41,panelOpacity:91,blur:3});
  page=await context.newPage();await page.goto('https://chatgpt.com/nebula-wireframe-test');const native=await geometry();
  await check('普通线框预设只换背景，保留用户微调与动态开关',async()=>{
    const before=await stored();await options.locator('#preset-wireframe').click();await options.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('已自动保存'));const after=await stored();
    assert.equal(after.preset,'wireframe');assert.equal(after.backgroundType,'preset');for(const key of Object.keys(before).filter(k=>!['preset','backgroundType'].includes(k)))assert.deepEqual(after[key],before[key],key);return after;
  });
  await check('一键风格调整明确外观项，保留启停、动态与已保存素材',async()=>{
    await options.locator('#media-file').setInputFiles(path.join(dir,'assets','icon-16.png'));await options.waitForFunction(async()=>Boolean(await NebulaMedia.load()));
    const before=await stored(),media=await options.evaluate(()=>NebulaMedia.load().then(x=>({name:x.name,updatedAt:x.updatedAt,size:x.blob.size})));
    await options.locator('#apply-wireframe-look').click();await options.waitForFunction(()=>document.querySelector('#mode').value==='glass'&&document.querySelector('#save-status').textContent.includes('已自动保存'));const after=await stored();
    assert.equal(after.enabled,false);assert.equal(after.motion,false);assert.equal(after.assetVersion,before.assetVersion);assert.equal(after.panelOpacity,48);assert.equal(after.dim,18);assert.equal(after.blur,8);assert.equal(after.scanlines,true);assert.equal(after.accent,'#52deff');assert.equal(after.preset,'wireframe');assert.deepEqual(await options.evaluate(()=>NebulaMedia.load().then(x=>({name:x.name,updatedAt:x.updatedAt,size:x.blob.size}))),media);return {after,media};
  });
  await check('线框壁纸与光效来自本包，图片实际完成解码',async()=>{
    await config({enabled:true});await page.bringToFront();await page.waitForFunction(()=>document.documentElement.dataset.nebulaPreset==='wireframe');const f=await bg();await f.waitForFunction(()=>document.querySelector('#wallpaper-image').complete&&document.querySelector('#wallpaper-image').naturalWidth>1000);
    const detail=await f.evaluate(()=>({src:document.querySelector('#wallpaper-image').src,width:document.querySelector('#wallpaper-image').naturalWidth,height:document.querySelector('#wallpaper-image').naturalHeight,effectsHidden:document.querySelector('#wireframe-effects').hidden,scanlinesHidden:document.querySelector('#scanlines').hidden,moving:document.body.dataset.moving}));assert.equal(detail.src,origin+'/assets/wireframe-wallpaper.png');assert.equal(detail.effectsHidden,false);assert.equal(detail.scanlinesHidden,false);assert.equal(detail.moving,'false');return detail;
  });
  await check('新风格没有改变原生几何，方形外壳清底、圆角表面只绘制一层',async()=>{
    assert.deepEqual(await geometry(),native);const detail=await page.evaluate(()=>{const ids=['composer-form','composer-surface','sidebar-footer'];return Object.fromEntries(ids.map(id=>{const s=getComputedStyle(document.getElementById(id));return[id,{background:s.backgroundColor,shadow:s.boxShadow,blur:s.backdropFilter,radius:s.borderRadius}];}));});
    assert.equal(detail['composer-form'].background,'rgba(0, 0, 0, 0)');assert.equal(detail['composer-form'].shadow,'none');assert.equal(detail['composer-form'].blur,'none');assert.equal(detail['composer-surface'].background,'rgba(3, 9, 18, 0.65)');assert.equal(detail['composer-surface'].radius,'28px');assert.equal(detail['composer-surface'].blur,'blur(8px)');assert.equal(detail['sidebar-footer'].background,'rgb(11, 23, 41)');return detail;
  });
  await check('独立文档编辑器不会误用输入框透明规则',async()=>{
    const detail=await page.evaluate(()=>{const editor=document.createElement('div');editor.className='ProseMirror';editor.contentEditable='true';editor.style.cssText='background:rgb(136,153,170);color:rgb(18,52,86)';editor.textContent='独立文档编辑器';document.body.appendChild(editor);const s=getComputedStyle(editor),result={background:s.backgroundColor,color:s.color};editor.remove();return result;});assert.equal(detail.background,'rgb(136, 153, 170)');assert.equal(detail.color,'rgb(18, 52, 86)');return detail;
  });
  await check('光束/代码雨可播放，关闭动态后暂停而保留壁纸',async()=>{
    await config({motion:true});await page.bringToFront();let f=await bg();await f.waitForFunction(()=>document.body.dataset.moving==='true');assert.equal(await f.locator('.wireframe-sweep').evaluate(n=>getComputedStyle(n).animationPlayState),'running');await config({motion:false});await f.waitForFunction(()=>document.body.dataset.moving==='false');assert.equal(await f.locator('.wireframe-sweep').evaluate(n=>getComputedStyle(n).animationPlayState),'paused');assert.equal(await f.locator('#wallpaper-image').evaluate(n=>n.hidden),false);
  });
  await check('减少动态效果与父页不可见提示均暂停装饰动画',async()=>{
    await config({motion:true});await page.bringToFront();const f=await bg();
    // 分段核对异步状态，失败时保留可见性和配置，避免只有一个笼统超时。
    async function waitMoving(expected,stage){try{await f.waitForFunction(value=>document.body.dataset.moving===value,expected,{timeout:5000});}catch(error){const state=await f.evaluate(async()=>({data:{...document.body.dataset},hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,settings:await NebulaSettings.get()}));throw new Error(stage+': '+JSON.stringify(state));}}
    await waitMoving('true','开始播放');await page.emulateMedia({reducedMotion:'reduce'});await waitMoving('false','减少动态');assert.equal(await f.locator('.wireframe-sweep').evaluate(n=>getComputedStyle(n).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});await waitMoving('true','恢复动态');
    await page.evaluate(target=>document.querySelector('#nebula-backdrop').contentWindow.postMessage({type:'nebula-host-visibility',visible:false},target),origin);await waitMoving('false','父页暂停');await page.evaluate(target=>document.querySelector('#nebula-backdrop').contentWindow.postMessage({type:'nebula-host-visibility',visible:true},target),origin);await waitMoving('true','父页恢复');
  });
  await check('切换本机素材移除线框专属光效与遮罩',async()=>{
    await options.locator('#use-custom').click();const f=await bg();await f.waitForFunction(()=>document.body.dataset.preset==='custom');assert.equal(await f.locator('#wireframe-effects').evaluate(n=>n.hidden),true);await page.waitForFunction(()=>document.documentElement.dataset.nebulaPreset==='custom');const shade=await f.locator('#shade').evaluate(n=>getComputedStyle(n).backgroundImage);assert.ok(shade.includes('0.23'),shade);return {shade};
  });
  await check('点击设计预览不被当成预设按钮，也不会切走本机素材',async()=>{
    const before=await stored();await options.locator('.preview-greeting').click();await options.waitForTimeout(160);assert.deepEqual(await stored(),before);assert.equal(before.backgroundType,'custom');
  });
  await check('线框资源加载失败切回极光，移除预设光效',async()=>{
    failImage=true;await config({preset:'wireframe',backgroundType:'preset'});const f=await bg();await f.waitForFunction(()=>document.body.dataset.preset==='aurora');assert.equal(await f.locator('#wireframe-effects').evaluate(n=>n.hidden),true);assert.equal(await f.locator('#preset').evaluate(n=>n.hidden),false);failImage=false;
  });
  await check('停用恢复宿主原有预设属性与原生表面',async()=>{
    await config({enabled:false});await page.waitForFunction(()=>!document.querySelector('#nebula-backdrop'));assert.equal(await page.locator('html').getAttribute('data-nebula-preset'),'host-before');assert.deepEqual(await geometry(),native);assert.equal(await page.locator('#composer-surface').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(18, 18, 18)');
  });
  await check('完整预设截图与390px设置页无横向溢出',async()=>{
    await config({enabled:true,preset:'aurora',backgroundType:'preset'});await options.locator('#apply-wireframe-look').click();await config({motion:false});await page.bringToFront();const f=await bg();await f.waitForFunction(()=>document.body.dataset.preset==='wireframe'&&document.querySelector('#wallpaper-image').naturalWidth>1000);
    const assets=path.resolve(dir,'..','docs','assets');fs.mkdirSync(assets,{recursive:true});const shot=path.join(assets,'线框蓝光-'+report.extensionVersion+'-夹具实渲染.png');await page.screenshot({path:shot});report.screenshots.push(shot);
    // 控件点击可能已滚动页面；回到顶部再拍摄，防止 sticky 预览在长图里错位。
    await options.setViewportSize({width:1440,height:1100});await options.bringToFront();await options.evaluate(()=>scrollTo(0,0));await options.screenshot({path:path.join(assets,'线框蓝光-'+report.extensionVersion+'-设置页.png'),fullPage:true});report.screenshots.push(path.join(assets,'线框蓝光-'+report.extensionVersion+'-设置页.png'));await options.setViewportSize({width:390,height:844});assert.ok(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await options.locator('button[data-preset]').count(),5);return {screenshots:report.screenshots};
  });
  await check('新预设无脚本错误或主动外部请求',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.remoteRequests,[]);});
}
main().catch(e=>{report.errors.push({fatal:e.stack});process.exitCode=1;}).finally(async()=>{if(context)await context.close();report.finishedAt=new Date().toISOString();const file=path.join(__dirname,'wireframe-results-latest.json');fs.writeFileSync(file,JSON.stringify(report,null,2));if(report.errors.length||report.checks.some(x=>!x.passed))process.exitCode=1;process.stdout.write('RESULT '+file+'\n');});
