/*
 * 真实 Chrome + 来源派生长对话布局夹具，不是实机账号 DOM。
 * 比较无扩展、启用与停用：专门检测 early layer 注册造成的原生 normal
 * utilities 退位，及 backdrop-filter 创建 fixed 包含块、底栏透叠。
 * --before --extension-dir <固定0.1.1快照> 留存旧版失败，不删除历史产物。
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
let playwright;
if(process.env.NEBULA_PLAYWRIGHT_PATH) playwright=require(process.env.NEBULA_PLAYWRIGHT_PATH);
else {try{playwright=require('playwright');}catch{throw new Error("需要 Playwright 测试依赖；请使用项目开发依赖或设置 NEBULA_PLAYWRIGHT_PATH。");}}
const rootDir=path.resolve(__dirname,'..');
const extensionArg=process.argv.indexOf('--extension-dir');
const extensionDir=extensionArg<0?rootDir:path.resolve(process.argv[extensionArg+1]);
const before=process.argv.includes('--before');
const template=fs.readFileSync(path.join(__dirname,'fixtures','chatgpt-layout.html'),'utf8');
const nativeCSS=template.match(/<style id="native-layout-style" data-native-layout>([\s\S]*?)<\/style>/)[1];
const projectRows=Array.from({length:36},(_,index)=>'<a class="sidebar-project" id="project-'+index+'" href="#project-'+index+'">▱　测试项目 '+String(index+1).padStart(2,'0')+' · 原生列表间距</a>').join('');
const messageCards=Array.from({length:14},(_,index)=>'<article class="message-card" id="message-'+index+'"><div class="message-body" id="message-body-'+index+'"><h3>第 '+(index+1)+' 段 · 检查正文原生布局</h3><p>这是一段来源派生的长对话。正文应继续保持网页原生的最大宽度、水平居中和左右留白。皮肤开关只改变外观，不应把内容推向左侧。</p><p>每个消息卡片的内边距、段落间距以及滚动位置都在同一个 DOM 上进行测量。右侧资料面板展开后，正文和输入框应按原布局重新分配空间。</p><p>以下文字仅用于形成足够长的页面，不含真实聊天内容或账号资料。</p></div></article>').join('');
const fixture=template.replace('__PROJECT_ROWS__',projectRows).replace('__MESSAGE_CARDS__',messageCards);
const report={startedAt:new Date().toISOString(),phase:before?'before':'after',scope:'真实 Chrome 加载扩展，来源派生长对话/项目/右侧面板夹具；非当前用户实机 DOM 或真实账号验证。',extensionDir,extensionVersion:JSON.parse(fs.readFileSync(path.join(extensionDir,'manifest.json'),'utf8')).version,stylesheetSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir,'styles','site.css'))).digest('hex'),fixtureSha256:crypto.createHash('sha256').update(fixture).digest('hex'),browserVersion:'',checks:[],remoteRequests:[],errors:[],profiles:[],screenshots:[]};
const resultPath=path.join(__dirname,before?'layout-results-before.json':'layout-results-after.json');
report.footerSourceReference={url:'https://raw.githubusercontent.com/pionxzh/chatgpt-exporter/master/src/main.tsx',readDate:'2026-10-07',note:'第三方公开源码的 accounts-profile-button / data-app-action-sidebar-scroll 线索；没有声称获取当前用户实机 DOM。'};
// 版本目录让新的回归截图与历史说明中的证据分开保存。
const screenshotDir=path.resolve(rootDir,'..','docs','assets','regression-'+report.extensionVersion);
const contexts=[];
let cleanContext,extensionContext,settingsPage,skinPage;

async function check(name,action){
  try {const detail=await action();report.checks.push({name,passed:true,detail});process.stdout.write('PASS '+name+'\n');}
  catch(error){report.checks.push({name,passed:false,error:error.message});process.stdout.write('FAIL '+name+': '+error.message+'\n');}
}
function htmlFor(order){return order==='native-initial'?fixture:fixture.replace(nativeCSS,'/* 原生完整 CSS 在 content CSS 注入后再加载。 */');}
async function launch(label){
  const profileParent=path.resolve(rootDir,'..','.test-profiles');fs.mkdirSync(profileParent,{recursive:true});
  const profile=fs.mkdtempSync(path.join(profileParent,'nebula-layout-'+label+'-'));report.profiles.push(profile);
  const context=await playwright.chromium.launchPersistentContext(profile,{executablePath:process.env.NEBULA_CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check'],viewport:{width:1600,height:1000},reducedMotion:'no-preference'});
  contexts.push(context);
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!['http:','https:'].includes(url.protocol)) return route.continue();
    if(url.hostname==='chatgpt.com') return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:htmlFor(url.searchParams.get('order')||'native-initial'),headers:{'content-security-policy':"default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; frame-src 'none'; connect-src 'none'; img-src 'none'; object-src 'none'"}});
    report.remoteRequests.push(route.request().url());return route.abort();
  });
  context.on('page',page=>page.on('pageerror',error=>report.errors.push({url:page.url(),message:error.message})));
  return context;
}
async function openFixture(context,order){
  const page=await context.newPage();
  await page.goto('https://chatgpt.com/nebula-layout-regression?order='+order);
  await page.locator('#layout-shell').waitFor();
  if(order==='native-delayed'){
    await page.waitForTimeout(150);
    await page.evaluate(css=>{document.getElementById('native-layout-style').textContent=css;},nativeCSS);
  }
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(100);
  return page;
}
async function state(page,panel,scrolled){
  await page.evaluate(({panel,scrolled})=>{
    document.documentElement.dataset.panel=panel;
    document.getElementById('conversation-scroll').scrollTop=scrolled?730:0;
    document.getElementById('sidebar-project-scroll').scrollTop=scrolled?590:0;
  },{panel,scrolled});
  await page.waitForTimeout(80);
}
async function capture(page){
  return page.evaluate(()=>{
    const ids=['layout-sidebar','sidebar-fixed-header','sidebar-fixed-marker','sidebar-project-scroll','sidebar-project-list','project-0','project-17','sidebar-user','layout-main','main-fixed-header','conversation-scroll','conversation-column','message-0','message-body-0','native-editor-dock','layout-composer','native-editor-form','layout-editor','native-composer-controls','inspector-panel','inspector-card'];
    const round=value=>Math.round(value*1000)/1000;
    const data={};
    for(const id of ids){
      const element=document.getElementById(id),style=getComputedStyle(element),rect=element.getBoundingClientRect();
      data[id]={rect:{x:round(rect.x),y:round(rect.y),width:round(rect.width),height:round(rect.height)},padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],margin:[style.marginTop,style.marginRight,style.marginBottom,style.marginLeft],maxWidth:style.maxWidth,position:style.position,scrollTop:round(element.scrollTop),scrollHeight:element.scrollHeight,scrollWidth:element.scrollWidth,clientHeight:element.clientHeight,clientWidth:element.clientWidth,background:style.backgroundColor,filter:style.backdropFilter};
    }
    return data;
  });
}
function compareLayout(actual,expected,label){
  const differences=[];
  for(const [id,reference] of Object.entries(expected)){
    const item=actual[id];
    for(const prop of ['x','y','width','height']) if(Math.abs(item.rect[prop]-reference.rect[prop])>.5) differences.push(id+'.rect.'+prop+' '+reference.rect[prop]+' → '+item.rect[prop]);
    for(const prop of ['padding','margin','maxWidth','position','scrollTop','scrollHeight','scrollWidth','clientHeight','clientWidth']) if(JSON.stringify(item[prop])!==JSON.stringify(reference[prop])) differences.push(id+'.'+prop+' '+JSON.stringify(reference[prop])+' → '+JSON.stringify(item[prop]));
  }
  // 完整计算样本写入 JSON；终端只输出关键差异，避免断言把大数组重复展开。
  assert.ok(differences.length===0,label+' 原生布局改变 ('+differences.length+' 项):\n'+differences.slice(0,10).join('\n'));
}
function alpha(color){const parts=color.match(/^rgba?\(([^)]+)\)$/)?.[1].split(',').map(Number);if(!parts)throw new Error('无法解析颜色 '+color);return parts.length===4?parts[3]:1;}
async function enabled(mode,value){
  await settingsPage.evaluate(patch=>NebulaSettings.set(patch),{enabled:value,mode,preset:'character',panelOpacity:75,blur:12,dim:35,motion:false});
  if(value) await skinPage.waitForFunction(mode=>document.documentElement.dataset.nebulaEnabled==='true'&&document.documentElement.dataset.nebulaMode===mode,mode);
  else await skinPage.waitForFunction(()=>!document.documentElement.hasAttribute('data-nebula-enabled'));
  await skinPage.waitForTimeout(100);
}

/* 第三方公开源码里的账户/滚动区语义线索，不是实机账号 DOM。 */
async function footerProbe(markup){
  await skinPage.evaluate(html=>{
    const section=document.createElement('section');section.id='layout-footer-fixture';section.style.cssText='position:absolute;left:-10000px;top:0;width:360px;';
    section.innerHTML='<style>@layer components { #layout-footer-fixture .probe-native { background:var(--color-surface); padding:7px; } #layout-footer-fixture button { background:transparent; border:0; } #layout-footer-fixture button:is(:hover,:focus-visible) { background:var(--color-surface-secondary); } }</style><aside class="app-shell-left-panel" data-probe-node="sidebar" style="width:260px;height:200px"><div class="probe-native" data-probe-node="ancestor">'+html+'</div></aside>';
    document.body.appendChild(section);
  },markup);
}
async function footerMetrics(){
  return skinPage.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#layout-footer-fixture [data-probe-node]')].map(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return[node.dataset.probeNode,{background:style.backgroundColor,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft]}];})));
}

async function main(){
  fs.mkdirSync(screenshotDir,{recursive:true});
  cleanContext=await launch('native');extensionContext=await launch('skin');
  report.browserVersion=extensionContext.browser().version();
  const loaded=await(await extensionContext.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked',{path:extensionDir});report.extensionId=loaded.id;
  settingsPage=await extensionContext.newPage();await settingsPage.goto('chrome-extension://'+loaded.id+'/options.html');await settingsPage.waitForFunction(()=>typeof NebulaSettings!=='undefined');await settingsPage.evaluate(()=>NebulaSettings.set({enabled:false}));
  report.nativeBaselines={};report.samples={};
  for(const order of ['native-initial','native-delayed']){
    const nativePage=await openFixture(cleanContext,order);
    const baselines={};
    for(const panel of ['closed','open']) for(const scrolled of [false,true]){
      await state(nativePage,panel,scrolled);baselines[panel+'/'+scrolled]=await capture(nativePage);
    }
    report.nativeBaselines[order]=baselines;
    skinPage=await openFixture(extensionContext,order);
    await enabled('soft',false);
    await check(order+' 初始停用时未提前注册冲坏原生 layers',async()=>{
      const samples={};
      report.samples[order+'/initial-disabled']=samples;
      for(const panel of ['closed','open'])for(const scrolled of [false,true]){await state(skinPage,panel,scrolled);const actual=await capture(skinPage);samples[panel+'/'+scrolled]=actual;compareLayout(actual,baselines[panel+'/'+scrolled],panel+'/'+scrolled);}
      return '对比无扩展原生基线，包含左右留白、居中、最大宽度、卡片间距及滚动。';
    });
    for(const mode of ['soft','glass']){
      await enabled(mode,true);
      for(const panel of ['closed','open'])for(const scrolled of [false,true]){
        const key=order+'/'+mode+'/'+panel+'/'+scrolled;
        await state(skinPage,panel,scrolled);
        await check(key+' 启用后 rect/spacing/scroll 不变',async()=>{
          const actual=await capture(skinPage);report.samples[key]=actual;compareLayout(actual,baselines[panel+'/'+scrolled],key);
          assert.equal(actual['sidebar-fixed-header'].rect.y,0,'侧栏 filter 创建了原生 fixed header 的包含块。');
          assert.equal(actual['main-fixed-header'].rect.y,0,'main fixed header 被移位。');
          return {conversation:actual['conversation-column'],message:actual['message-0'],user:actual['sidebar-user'],projectScroll:actual['sidebar-project-scroll']};
        });
      }
      await state(skinPage,'closed',true);
      await check(order+'/'+mode+' 底部用户区保持遮挡项目的稳定底色',async()=>{
        const actual=await capture(skinPage);const user=actual['sidebar-user'];
        assert.ok(alpha(user.background)>=.96,'原生用户区实底被透明化，项目可能透叠: '+JSON.stringify(user));
        const viewportHeight=await skinPage.evaluate(()=>innerHeight);
        assert.ok(Math.abs(user.rect.y+user.rect.height-viewportHeight)<1,'sticky 用户底部脱离原生滚动口。');
        return {background:user.background,rect:user.rect,projectScrollTop:actual['sidebar-project-scroll'].scrollTop};
      });
      await enabled(mode,false);
      await check(order+'/'+mode+' 停用后恢复原生布局和 scroll',async()=>{
        const samples={};
        report.samples[order+'/'+mode+'/disabled']=samples;
        for(const panel of ['closed','open'])for(const scrolled of [false,true]){await state(skinPage,panel,scrolled);const actual=await capture(skinPage);samples[panel+'/'+scrolled]=actual;compareLayout(actual,baselines[panel+'/'+scrolled],panel+'/'+scrolled);}
        return '相同DOM停用后与无扩展原生页一致。';
      });
    }
    await enabled('glass',true);await state(skinPage,'closed',true);
    const imagePath=path.join(screenshotDir,(before?'布局验证-长对话-修复前-':'布局验证-长对话-')+order+'.png');
    await skinPage.screenshot({path:imagePath,fullPage:true});report.screenshots.push(imagePath);
    await state(nativePage,'closed',true);
    const nativeImage=path.join(screenshotDir,'布局验证-长对话-原生-'+order+'.png');
    // 原生参考也保留；仅首次创建，后续修复验证不覆盖原参考图。
    if(!fs.existsSync(nativeImage)){await nativePage.screenshot({path:nativeImage,fullPage:true});report.screenshots.push(nativeImage);}
    await enabled('glass',false);await skinPage.close();await nativePage.close();
  }
  skinPage=await openFixture(extensionContext,'native-initial');
  for(const mode of ['soft','glass']){
    for(const [name,markup,expected] of [
      ['footer标签账户区','<footer class="probe-native" data-probe-node="footer"><button data-testid="accounts-profile-button" data-probe-node="profile">账户</button></footer>','footer'],
      ['无footer的profile直接父级','<div class="probe-native" data-probe-node="footer"><button data-testid="accounts-profile-button" data-probe-node="profile">账户</button></div>','footer'],
      ['滚动区紧邻menu按钮账户区','<div data-app-action-sidebar-scroll class="probe-native">项目滚动区</div><div class="probe-native" data-probe-node="footer"><button aria-haspopup="menu" data-probe-node="profile">账户</button></div>','footer'],
      ['滚动区包裹层紧邻menu账户区','<div class="probe-native"><div data-app-action-sidebar-scroll>项目滚动区</div></div><div class="probe-native" data-probe-node="footer"><button aria-haspopup="menu" data-probe-node="profile">账户</button></div>','footer'],
      ['真menu中profile标记的保护排除','<div role="menu" class="probe-native" data-probe-node="menu"><div class="probe-native" data-probe-node="menu-inner"><button data-testid="accounts-profile-button" data-probe-node="profile">菜单账户项</button></div></div>','menu'],
      ['sidebar外profile标记不误设底栏','</div></aside><section class="probe-native" data-probe-node="outside"><button data-testid="accounts-profile-button" data-probe-node="profile">外部标记</button></section><aside><div>','outside']
    ]){
      await check(mode+'/'+name+' 精确保护与布局保持',async()=>{
        await enabled(mode,false);await footerProbe(markup);
        try{
          const native=await footerMetrics();await enabled(mode,true);const actual=await footerMetrics();
          assert.ok(Math.abs(alpha(actual.sidebar.background)-.75)<.01,'账户规则误把整个sidebar改为实底: '+JSON.stringify(actual.sidebar));
          assert.equal(alpha(actual.ancestor.background),0,'账户规则误把账户上级包裹层改为实底。');
          if(expected==='footer') assert.equal(alpha(actual.footer.background),1,'账户底部区域仍透明: '+JSON.stringify(actual.footer));
          if(expected==='menu'){
            assert.equal(actual.menu.background,'rgb(20, 35, 57)','真实menu自身被账户底栏色覆盖。');
            assert.equal(actual['menu-inner'].background,'rgb(20, 35, 57)','真实menu内部被账户底栏色覆盖。');
            assert.equal(alpha(actual.profile.background),0,'菜单中的profile按钮被误强制账户底色。');
          }
          if(expected==='outside'){
            assert.ok(alpha(actual.outside.background)<1,'sidebar以外的profile父级被误设实底。');
            assert.equal(alpha(actual.profile.background),0,'sidebar以外的profile按钮被误设实底。');
          }
          for(const key of Object.keys(native)) {assert.deepEqual(actual[key].rect,native[key].rect,'账户外观规则改动几何位置: '+key);assert.deepEqual(actual[key].padding,native[key].padding,'账户外观规则改动padding: '+key);}
          return actual;
        }finally{await enabled(mode,false);await skinPage.evaluate(()=>document.getElementById('layout-footer-fixture')?.remove());}
      });
    }
    await check(mode+'/账户按钮原生hover与focus-visible不同于固定底色',async()=>{
      await enabled(mode,false);await footerProbe('<div class="probe-native" data-probe-node="footer"><button data-testid="accounts-profile-button" data-probe-node="profile">账户</button></div>');
      let cdp,nodeId;
      try{
        await enabled(mode,true);const resting=await footerMetrics();
        cdp=await extensionContext.newCDPSession(skinPage);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
        const documentNode=await cdp.send('DOM.getDocument');nodeId=(await cdp.send('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'#layout-footer-fixture [data-probe-node="profile"]'})).nodeId;
        const states={};
        for(const pseudo of ['hover','focus-visible']){
          // CSS 引擎伪类回归；这是计算样式验证，不宣称对实机账户做了输入操作。
          await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[pseudo]});const actual=await footerMetrics();states[pseudo]=actual;
          assert.equal(alpha(actual.footer.background),1,'按钮状态改变时父级账户遮挡面变透明。');
          assert.notEqual(actual.profile.background,resting.profile.background,'账户规则遮住原生 '+pseudo+' 反馈。');
          assert.equal(actual.profile.background,'rgb(27, 44, 69)','原生 secondary 状态色未保留。');
          assert.deepEqual(actual.profile.rect,resting.profile.rect,'状态改变了账户按钮几何位置。');
        }
        return {resting,states,method:'Chrome CDP CSS.forcePseudoState'};
      }finally{
        if(cdp&&nodeId){await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});await cdp.detach();}
        await enabled(mode,false);await skinPage.evaluate(()=>document.getElementById('layout-footer-fixture')?.remove());
      }
    });
  }
  await skinPage.close();
  await check('布局测试未产生脚本错误或外部请求',async()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.remoteRequests,[]);return '本机夹具与扩展内部资源。';});
}
main().catch(error=>{report.fatal={message:error.message,stack:error.stack};process.stdout.write('FATAL '+error.message+'\n');}).finally(async()=>{
  for(const context of contexts)await context.close();report.finishedAt=new Date().toISOString();report.passed=!report.fatal&&report.checks.every(check=>check.passed);fs.writeFileSync(resultPath,JSON.stringify(report,null,2));process.stdout.write('RESULT '+resultPath+'\n');process.exitCode=report.passed?0:1;
});
