// Isolated, reproducible Chromium acceptance. No user browser or account is used.
// BASELINE_ROOT=/path/to/old/checkout node scripts/qa-ux-browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { starterWorkspace, encodeWorkspace, STORAGE_KEY } from '../web/model.js';

const root = resolve(fileURLToPath(new URL('..',import.meta.url)));
const output = resolve(process.env.UX_QA_OUTPUT || `${root}/docs/assets/ux`);
const runtime = process.env.PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
const playwrightModule = await import(pathToFileURL(runtime).href);
const { chromium } = playwrightModule.default || playwrightModule;
const seed = starterWorkspace(), encodedSeed = encodeWorkspace(seed);
const baselineRoot = process.env.BASELINE_ROOT && resolve(process.env.BASELINE_ROOT);
const definitions = [
  {id:'desktop',width:1440,height:900},
  {id:'laptop',width:1280,height:720},
  {id:'ipad-landscape',width:1024,height:768,touch:true,ipad:true},
  {id:'ipad-portrait',width:768,height:1024,touch:true,ipad:true},
  {id:'mobile',width:390,height:844,touch:true,mobile:true},
  {id:'small-mobile',width:375,height:667,touch:true,mobile:true},
  {id:'mobile-landscape',width:844,height:390,touch:true,mobile:true},
  {id:'desktop-en-reduced',width:1440,height:900,locale:'en',reduced:true},
];
const cases=definitions.filter(entry=>!process.env.UX_QA_CASES || process.env.UX_QA_CASES.split(',').includes(entry.id));
const report = {generatedAt:new Date().toISOString(),browser:'Isolated Chromium',realDeviceSafari:false,modelCalls:'Scripted protocol fixtures only; no external model request',seed:{plays:seed.plays.length,players:seed.plays[0].players.length},baseline:baselineRoot || null,cases:[],screenshots:[]};
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webmanifest':'application/manifest+json'};

async function serve(checkout) {
  const web = resolve(checkout,'web');
  const server = createServer(async (req,res) => {
    try {
      const path = new URL(req.url,'http://localhost').pathname;
      const name = ['/', '/local.html'].includes(path) ? '/index.html' : decodeURIComponent(path);
      const file = resolve(web,`.${name}`);
      if (!file.startsWith(web+sep)) {res.writeHead(403).end(); return;}
      const body = await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}).end(body);
    } catch {res.writeHead(404).end('Not found');}
  });
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:() => new Promise(resolve => server.close(resolve))};
}
async function prepareContext(browser,base,entry) {
  const context = await browser.newContext({viewport:{width:entry.width,height:entry.height},deviceScaleFactor:1,hasTouch:!!entry.touch,isMobile:!!entry.mobile,locale:entry.locale || 'zh-CN',reducedMotion:entry.reduced ? 'reduce' : 'no-preference',...(entry.ipad ? {userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'} : {})});
  await context.addInitScript(({key,data,locale}) => {
    if(!localStorage.getItem(key))localStorage.setItem(key,data);
    localStorage.setItem('playbook-studio.locale',locale);
    localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
    localStorage.setItem('playbook-visual-mode','traditional');
  },{key:STORAGE_KEY,data:encodedSeed,locale:entry.locale || 'zh-CN'});
  const model = {requests:0,blocked:[],turns:new Map()};
  await context.route('**/*',async route => {
    const request = route.request(), url = request.url();
    if(url.startsWith(base+'/'))return route.continue();
    if(/^https:\/\/api\.openai\.com\/v1\/chat\/completions/.test(url)) {
      model.requests++;
      const body = request.postDataJSON(), input = JSON.parse(body.messages.find(message=>message.role==='user').content);
      const outputs = body.messages.filter(message=>message.role==='tool');
      const first = !input.instruction.includes('again') && !input.instruction.includes('再');
      const turn = model.turns.get(input.instruction) || {context:input};
      model.turns.set(input.instruction,turn);
      let name, args;
      if(!outputs.length) {name='read_board';args={};}
      else if(first && outputs.length===1) {turn.board=JSON.parse(outputs[0].content);name='resolve_player';args={role:'X'};}
      else if(outputs.length===(first?2:1)) {
        turn.board ||= JSON.parse(outputs[0].content);
        const actor=turn.board.players.find(player=>player.label==='X');
        assert.ok(actor,'scripted model requires the real X marker');
        turn.operations=[{kind:'move_player',playerId:actor.id,...(first?{dxYards:2}:{dyYards:2})}];
        name='preview_edit';args={operations:turn.operations};
      } else {name='submit_result';args={result:{kind:'edit',summary:first?'Move X two yards right':'Move the same player two yards forward',operations:turn.operations}};}
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:`qa-${model.requests}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})});
    }
    model.blocked.push(url); return route.abort('blockedbyclient');
  });
  return {context,model};
}
async function ready(page,url,mode='editor') {
  await page.goto(`${url}/local.html#${mode}`,{waitUntil:'networkidle'});
  await page.locator(mode==='editor'?'#field .pitch-svg':mode==='analysis'?'.ai-page':'.studio-home').waitFor();
  await page.evaluate(()=>document.fonts.ready);
}
async function screenshot(page,name) {
  const path = resolve(output,name); await page.screenshot({path,type:'jpeg',quality:86,fullPage:false});
  report.screenshots.push(name); return path;
}
async function geometry(page) {
  return page.evaluate(() => {
    const viewport={width:innerWidth,height:innerHeight};
    const rect=selector=>{const element=document.querySelector(selector);if(!element)return null;const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,inViewport:r.top>=0&&r.left>=0&&r.bottom<=innerHeight+1&&r.right<=innerWidth+1};};
    return {viewport,documentWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth-innerWidth,field:rect('#field'),tools:rect('.stage-dock'),status:rect('.editor-status'),navigation:rect('.workspace-nav'),composer:rect('.ba-compose'),boardAreaRatio:(document.querySelector('#field')?.getBoundingClientRect().width || 0)*(document.querySelector('#field')?.getBoundingClientRect().height || 0)/(innerWidth*innerHeight)};
  });
}
async function reachable(page,selector) {
  const item=page.locator(selector).first(); await item.waitFor({state:'visible'});
  const box=await item.boundingBox(); assert.ok(box && box.width>0 && box.height>0,`${selector} has a measurable surface`);
  const hit=await item.evaluate(element=>{const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;const target=document.elementFromPoint(x,y);return {inside:x>=0&&y>=0&&x<innerWidth&&y<innerHeight,hit:!!target&&(element===target||element.contains(target)),target:target?.className?.baseVal || target?.className || target?.tagName};});
  assert.ok(hit.inside && hit.hit,`${selector} is covered or outside the viewport: ${JSON.stringify(hit)}`);
}
async function point(page,id) {
  await page.locator(`#field [data-player="${id}"]`).scrollIntoViewIfNeeded();
  return page.locator(`#field [data-player="${id}"]`).evaluate(element=>{const p=new DOMPoint(0,0).matrixTransform(element.getScreenCTM());return {x:p.x,y:p.y};});
}
async function tapPlayer(page,id,touch) {const p=await point(page,id);if(touch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);}

await mkdir(output,{recursive:true});
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
} catch(error) {
  report.status='blocked';
  report.infrastructure={phase:'browser-launch',reason:error.message.split('Call log:')[0].trim(),localHttpProbe:'Ephemeral 127.0.0.1 HTTP binding passed independently; Chromium process singleton socket was denied.'};
  report.cases=cases.map(entry=>({...entry,status:'not-run',checks:[],errors:[],measurements:null}));
  report.summary={cases:cases.length,passed:0,failed:0,blocked:cases.length,pageErrors:0};
  await writeFile(resolve(output,'qa-matrix.json'),JSON.stringify(report,null,2)+'\n');
  console.error(JSON.stringify({status:'blocked',phase:'browser-launch',cases:cases.length,reason:error.message.match(/socket\(\) failed:[^\n]+/)?.[0] || error.message.split('\n')[0]}));
  process.exit(2);
}
const current=await serve(root);
let baseline;
try {
  if(baselineRoot) {
    await access(resolve(baselineRoot,'web/index.html')); baseline=await serve(baselineRoot);
    const {context}=await prepareContext(browser,baseline.url,definitions[0]);const page=await context.newPage();page.setDefaultTimeout(6000);
    for(const mode of ['editor','home','analysis']) {await ready(page,baseline.url,mode);await screenshot(page,`${mode}-before.jpg`);}
    await context.close();
  }
  for(const entry of cases) {
    const result={...entry,checks:[],errors:[],measurements:null}; report.cases.push(result);
    const {context,model}=await prepareContext(browser,current.url,entry),page=await context.newPage();page.setDefaultTimeout(6000);
    page.on('pageerror',error=>result.errors.push(error.message));
    const check=async(name,run)=>{try{await run();result.checks.push({name,status:'passed'});}catch(error){result.checks.push({name,status:'failed',message:error.message});await screenshot(page,`${entry.id}-${name.replace(/[^a-z0-9]+/gi,'-')}-failure.jpg`).catch(()=>{});}};
    try {
      await ready(page,current.url); result.measurements=await geometry(page);
      await screenshot(page,entry.id==='desktop'?'editor-after.jpg':`${entry.id}-after.jpg`);
      if(entry.id==='ipad-landscape')await screenshot(page,'ipad-after.jpg');
      await check('horizontal-overflow',async()=>assert.ok(result.measurements.overflow<=1,JSON.stringify(result.measurements)));
      await check('initial-tool-access',async()=>assert.ok(result.measurements.tools?.inViewport,'Drawing tools should be reachable without leaving the board: '+JSON.stringify(result.measurements)));
      await check('visible-save-status',async()=>{await reachable(page,'.editor-status');assert.ok(await page.locator('.editor-status').textContent());});
      if(!entry.touch)await check('keyboard-property-focus',async()=>{const title=page.locator('[data-prop="title"]');await title.fill('UX verification');await title.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.prop),'category');await page.locator('[data-action="undo"]').click();});
      await check('module-roundtrip',async()=>{const title=await page.locator('.play-header h1').textContent();await page.locator('[data-workspace-mode="roster"]').click();await page.locator('#roster-root:not([hidden])').waitFor();await page.locator('[data-workspace-mode="editor"]').click();await page.locator('#app:not([hidden])').waitFor();assert.equal(await page.locator('.play-header h1').textContent(),title);});
      await check('multiple-selection-and-undo',async()=>{
        const actors=seed.plays[0].players.filter(player=>['X','Z'].includes(player.label));assert.equal(actors.length,2);
        await page.locator('[data-action="multi-select"]').click();
        for(const actor of actors)await tapPlayer(page,actor.id,entry.touch);
        assert.match(await page.locator('.selection-count').textContent(),/2/);
        await page.locator('[data-action="multi-select"]').click();
        const initial=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).plays[0].players,STORAGE_KEY);
        if(entry.touch)await page.locator('.compact-nav [data-action="inspector-panel"]').click();
        await page.locator('[data-action="selection-nudge:right"]').click();
        if(entry.touch)await page.locator('.inspector-panel [data-action="close-panel"]').click();
        await page.locator('.play-actions [data-action="undo"]').click();
        assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).plays[0].players,STORAGE_KEY),initial);
        await page.locator('[data-action="clear-selection"]').first().click();
      });
      await check('route-completion',async()=>{
        const actor=seed.plays[0].players.find(player=>player.label==='X');await tapPlayer(page,actor.id,entry.touch);
        const before=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).plays[0].routes.length,STORAGE_KEY);
        await page.locator('[data-action="tool:route"]').click();
        await page.locator('#field').scrollIntoViewIfNeeded();
        const target=await page.locator('#field .pitch-svg').evaluate(svg=>{const p=new DOMPoint(400,320).matrixTransform(svg.getScreenCTM());return{x:p.x,y:p.y};});
        if(entry.touch)await page.touchscreen.tap(target.x,target.y);else await page.mouse.click(target.x,target.y);
        await page.locator('[data-action="finish-route"]').click();
        assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).plays[0].routes.length,STORAGE_KEY),before+1);
        await page.locator('.play-actions [data-action="undo"]').click();
        await page.locator('[data-action="clear-selection"]').first().click();
      });
      await check('assistant-composer-access',async()=>{
        await page.locator('[data-ba="open"]').click();await page.locator('[data-ba-prompt]').fill(entry.locale==='en'?'Adjust this play':'调整当前战术');
        await reachable(page,'[data-ba="send"]'); await reachable(page,'[data-ba-prompt]');
        assert.equal(await page.locator('.locale-control').isVisible(),false,'utility controls must not cover the composer');
        await screenshot(page,`${entry.id}-assistant-after.jpg`);await page.locator('[data-ba="close"]').click();
      });
      await check('madden-cross-team',async()=>{
        await page.locator('[data-action="madden-library"]:visible').first().click();await page.locator('[data-madden="scope"][data-scope="all"]').click();
        assert.ok(await page.locator('.madden-active-scope').textContent());
        await page.locator('#madden-team-search').fill('Rams');assert.equal(await page.locator('[data-madden="team"]:visible').count(),1);
        await page.locator('[data-madden="team"]:visible').click();assert.match(await page.locator('.madden-active-scope').textContent(),/Rams/i);
        await page.locator('[data-madden="close"]').click();
      });
      if(entry.id==='desktop') {
        await check('scripted-ai-continuity',async()=>{
          await page.locator('[data-ba="open"]').click();await page.locator('[data-ba="settings"]').click();await page.locator('[data-ba-provider]').selectOption('openai');await page.locator('[data-ba-key]').fill('qa-fixture-key');await page.locator('[data-ba="done"]').click();
          for(const instruction of ['Move X two yards right','Move him forward again']) {await page.locator('[data-ba-prompt]').fill(instruction);await page.locator('[data-ba="send"]').click();await page.locator('[data-ba="apply"]:not(:disabled)').waitFor({timeout:15000});}
          const [first,second]=[...model.turns.values()];assert.ok(first && second);
          const actor=seed.plays[0].players.find(player=>player.label==='X');
          assert.notEqual(second.board.players.find(player=>player.id===actor.id).x,first.board.players.find(player=>player.id===actor.id).x,'the follow-up reads the first uncommitted move');
          assert.equal(second.context.focus.players[0].id,actor.id,'an omitted subject uses conversation focus');
          await screenshot(page,'assistant-proposal-after.jpg');await page.locator('[data-ba="apply"]').click();await page.locator('[data-ba="undo"]').waitFor();await page.locator('[data-ba="undo"]').click();
          const after=await page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).plays[0].players.find(player=>player.id===id),{key:STORAGE_KEY,id:actor.id});assert.deepEqual(after,actor);
          await page.locator('[data-ba="close"]').click();
        });
        for(const mode of ['home','analysis']) {await ready(page,current.url,mode);await screenshot(page,`${mode}-after.jpg`);}
      }
      if(entry.reduced)await check('reduced-motion',async()=>assert.equal(await page.evaluate(()=>document.documentElement.dataset.motion),'reduced'));
      result.network={mockedModelRequests:model.requests,blockedExternalRequests:model.blocked.length};
    }catch(error){result.errors.push(error.message);await screenshot(page,`${entry.id}-setup-failure.jpg`).catch(()=>{});}
    finally{await context.close();}
    console.log(`${entry.id}: ${result.checks.filter(check=>check.status==='passed').length}/${result.checks.length} passed, ${result.errors.length} page/setup errors`);
  }
} finally {await browser.close();await current.close();if(baseline)await baseline.close();}
report.summary={cases:report.cases.length,passed:report.cases.flatMap(item=>item.checks).filter(item=>item.status==='passed').length,failed:report.cases.flatMap(item=>item.checks).filter(item=>item.status==='failed').length,pageErrors:report.cases.flatMap(item=>item.errors).length};
await writeFile(resolve(output,'qa-matrix.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
if(report.summary.failed || report.summary.pageErrors)process.exitCode=1;
