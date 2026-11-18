// Non-AI browser acceptance. Uses disposable test data, never a user's account.
// UX_QA_CASES=desktop node scripts/qa-non-ai.mjs
// All viewports: node scripts/qa-non-ai.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { animatedPlayer, starterWorkspace, encodeWorkspace, decodeWorkspace, STORAGE_KEY } from '../web/model.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.env.UX_QA_OUTPUT || `${root}/docs/acceptance/evidence`);
const definitions = [
  { id:'desktop', width:1440, height:900 },
  { id:'wide-desktop', width:1920, height:1080 },
  { id:'laptop', width:1280, height:720 },
  { id:'ipad-landscape', width:1024, height:768, touch:true },
  { id:'ipad-portrait', width:768, height:1024, touch:true },
  { id:'ipad-split', width:507, height:768, touch:true },
  { id:'mobile', width:390, height:844, touch:true, mobile:true },
  { id:'small-mobile', width:375, height:667, touch:true, mobile:true },
  { id:'mobile-landscape', width:844, height:390, touch:true, mobile:true },
  { id:'desktop-en-reduced', width:1440, height:900, locale:'en', reduced:true },
];
const selected = process.env.UX_QA_CASES?.split(',');
if (selected?.some(id => !definitions.some(item => item.id === id))) throw new Error('Unknown UX_QA_CASES entry');
const cases = definitions.filter(item => !selected || selected.includes(item.id));
const seed = starterWorkspace({ demoDepth:true });
const encodedSeed = encodeWorkspace(seed);
const report = {
  generatedAt:new Date().toISOString(), scope:'Non-AI editor, roster, catalog and responsive acceptance',
  excluded:['All AI functionality','GitHub Pages'], realDeviceSafari:false,
  browser:'Isolated Chromium', input:'Browser mouse / emulated touch; not physical touch hardware',
  seed:{ plays:seed.plays.length, players:seed.plays[0].players.length, roster:seed.roster.length }, cases:[], screenshots:[],
};
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.jpg':'image/jpeg', '.png':'image/png', '.webmanifest':'application/manifest+json' };

async function serve() {
  const web = resolve(root,'web');
  const server = createServer(async (request,response) => {
    try {
      const url = new URL(request.url,'http://localhost');
      if (url.pathname === '/__qa/acceptance-performance.js') {
        response.writeHead(200,{'Content-Type':mime['.js']}).end(await readFile(resolve(root,'scripts/acceptance-performance.js'))); return;
      }
      const name = ['/','/local.html'].includes(url.pathname) ? '/index.html' : decodeURIComponent(url.pathname);
      const file = resolve(web,`.${name}`);
      if (!file.startsWith(web+sep)) { response.writeHead(403).end(); return; }
      response.writeHead(200,{'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((done,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',done); });
  return { base:`http://127.0.0.1:${server.address().port}`, close:() => new Promise(done => server.close(done)) };
}
async function save() {
  const checks = report.cases.flatMap(item => item.checks);
  report.summary = {
    viewports:report.cases.length, passed:checks.filter(item => item.status === 'passed').length,
    failed:checks.filter(item => item.status === 'failed').length,
    blockedViewports:report.cases.filter(item => item.status === 'not-run').length,
    pageErrors:report.cases.flatMap(item => item.errors).length,
  };
  await writeFile(resolve(output,'non-ai-matrix.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.summary));
}
async function blocked(reason,phase='browser-launch') {
  report.status='blocked'; report.infrastructure={ phase, reason };
  report.cases=cases.map(item => ({...item,status:'not-run',checks:[],errors:[],measurements:null}));
  await save(); process.exitCode=2;
}
await mkdir(output,{recursive:true});
if (process.env.UX_QA_BROWSER_BLOCK_REASON) {
  await blocked(process.env.UX_QA_BROWSER_BLOCK_REASON,'previously-observed-browser-launch');
} else {
  await run();
}

async function run() {
  const runtime = process.env.PLAYWRIGHT_MODULE || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js';
  let browser;
  try {
    const module = await import(pathToFileURL(runtime).href);
    browser = await (module.default || module).chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage'] });
  } catch(error) { await blocked(error.message.split('Call log:')[0]); return; }
  let site;
  try {
    site = await serve();
    for (const entry of cases) await runCase(browser,site.base,entry);
  } finally { await browser.close(); await site?.close(); }
  await save();
  if (report.summary.failed || report.summary.pageErrors) process.exitCode=1;
}
async function runCase(browser,base,entry) {
  const result = {...entry,status:'ran',checks:[],errors:[],measurements:null,externalRequests:[]};
  report.cases.push(result);
  const context = await browser.newContext({ viewport:{width:entry.width,height:entry.height},deviceScaleFactor:1,hasTouch:!!entry.touch,isMobile:!!entry.mobile,locale:entry.locale || 'zh-CN',reducedMotion:entry.reduced ? 'reduce' : 'no-preference',serviceWorkers:'block' });
  await context.addInitScript(({key,data,locale}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key,data);
    localStorage.setItem('playbook-studio.locale',locale);
    localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
    if (!localStorage.getItem('playbook-visual-mode')) localStorage.setItem('playbook-visual-mode','traditional');
  },{key:STORAGE_KEY,data:encodedSeed,locale:entry.locale || 'zh-CN'});
  await context.route('**/*',route => {
    if (route.request().url().startsWith(base+'/')) return route.continue();
    result.externalRequests.push(route.request().url()); return route.abort('blockedbyclient');
  });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror',error => result.errors.push(error.message));
  const screenshot = async name => {
    const file=`${entry.id}-${name}.jpg`;
    await page.screenshot({path:resolve(output,file),type:'jpeg',quality:86,fullPage:false});
    report.screenshots.push(file);
  };
  const check = async (name,action) => {
    try { await action(); result.checks.push({name,status:'passed'}); }
    catch(error) { result.checks.push({name,status:'failed',message:error.message}); await screenshot(`${name}-failure`).catch(()=>{}); }
  };
  const persisted = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).data,STORAGE_KEY);
  const click = async selector => { const node=page.locator(selector).filter({visible:true}).first(); await node.click(); };
  const visibleUndo = () => page.locator('[data-action="undo"]:visible').first().click();
  const visibleRedo = () => page.locator('[data-action="redo"]:visible').first().click();
  const ready = async () => {
    await page.goto(`${base}/local.html#editor`,{waitUntil:'networkidle'});
    await page.locator('#field .pitch-svg').waitFor(); await page.evaluate(()=>document.fonts.ready);
  };
  const actor = label => seed.plays[0].players.find(player => player.label === label);
  const playerPoint = async id => {
    const node=page.locator(`#field [data-player="${id}"]`); await node.scrollIntoViewIfNeeded();
    return node.evaluate(element => { const point=new DOMPoint(0,0).matrixTransform(element.getScreenCTM()); return {x:point.x,y:point.y}; });
  };
  const tap = async point => entry.touch ? page.touchscreen.tap(point.x,point.y) : page.mouse.click(point.x,point.y);
  const tapPlayer = async label => tap(await playerPoint(actor(label).id));
  const drag = async (from,to) => {
    if (!entry.touch) { await page.mouse.move(from.x,from.y); await page.mouse.down(); await page.mouse.move(to.x,to.y,{steps:20}); await page.mouse.up(); return; }
    const cdp=await context.newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});
      for (let i=1;i<=20;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/20,y:from.y+(to.y-from.y)*i/20}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } finally { await cdp.detach(); }
  };
  const reachable = async (selector,{scroll=true,minSize=0}={}) => {
    const node=page.locator(selector).filter({visible:true}).first();
    if(scroll)await node.scrollIntoViewIfNeeded();
    const target=await node.evaluate(element => {
      const {left,right,top,bottom,width,height}=element.getBoundingClientRect();
      const hit=document.elementFromPoint(left+width/2,top+height/2);
      return {left,right,top,bottom,width,height,hit:!!hit&&element.contains(hit),
        inside:left>=0&&top>=0&&right<=innerWidth+0.01&&bottom<=innerHeight+0.01};
    });
    assert.ok(target.inside&&target.hit&&target.width>0&&target.height>0&&target.width>=minSize&&target.height>=minSize,
      `${selector} does not provide a reachable ${minSize}px target: ${JSON.stringify(target)}`);
    return target;
  };
  const measureInitialTools = async () => {
    const tools={};
    for(const kind of ['select','route','block','motion','pass','zone','text']) {
      tools[kind]=await reachable(`.stage-dock [data-action="tool:${kind}"]`,{scroll:false,minSize:44});
    }
    return tools;
  };
  const assertSelectionCleared = async () => {
    assert.equal(await page.locator('#field [data-player][aria-pressed="true"], [data-action="clear-selection"]').count(),0,'Undo should clear the selection');
  };
  try {
    await ready();
    result.measurements = await page.evaluate(() => {
      const rect=selector => { const node=document.querySelector(selector);return node?.getBoundingClientRect().toJSON() || null; };
      return {viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,field:rect('#field'),tools:rect('.stage-dock'),navigation:rect('.workspace-nav'),status:rect('.editor-status'),pointerCoarse:matchMedia('(pointer:coarse)').matches};
    });
    await screenshot('editor');
    await check('initial-layout',async()=>{
      const m=result.measurements; assert.ok(m.documentWidth<=entry.width+1,'Horizontal document overflow');
      assert.ok(m.field.height>=200&&m.field.width>200,'Board lost usable dimensions');
      assert.ok(m.navigation.top>=0&&m.navigation.bottom<=entry.height,'Workspace navigation not visible');
      result.measurements.drawingTools=await measureInitialTools();
      await reachable('.editor-status',{scroll:false});
    });
    await check('size-popover-recovery',async()=>{
      const summary=page.locator('.board-advanced > summary'),panel=page.locator('.board-advanced');
      if(await summary.isVisible()){
        assert.equal(await panel.getAttribute('open'),null,'Advanced size must not cover the initial tools');
        await summary.click();await reachable('#board-height');await page.keyboard.press('Escape');
        assert.equal(await panel.getAttribute('open'),null);assert.equal(await summary.evaluate(node=>node===document.activeElement),true);
        await summary.click();await click('[data-board-action="zoom-in"]');assert.equal(await panel.getAttribute('open'),null);
        await click('[data-board-action="zoom-out"]');
      }
      if(entry.id==='desktop'){
        await page.setViewportSize({width:375,height:667});await page.waitForFunction(()=>!document.querySelector('.board-advanced').open);
        await summary.click();await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>!document.querySelector('.board-advanced').open);
        await measureInitialTools();
        await page.setViewportSize({width:entry.width,height:entry.height});
      }
    });
    await check('player-drag-undo-redo',async()=>{
      const before=(await persisted()).plays[0],from=await playerPoint(actor('X').id);
      await drag(from,{x:from.x+18,y:from.y-18});
      const moved=(await persisted()).plays[0]; assert.notDeepEqual(moved.players,before.players,'Drag did not move any player');
      const original=before.players.find(p=>p.id===actor('X').id),changed=moved.players.find(p=>p.id===original.id);
      assert.ok(changed.x!==original.x||changed.y!==original.y,'Wrong player moved');
      await visibleUndo(); assert.deepEqual((await persisted()).plays[0],before);
      await visibleRedo(); assert.deepEqual((await persisted()).plays[0],moved);
      await visibleUndo(); await assertSelectionCleared();
    });
    await check('group-drag-single-undo',async()=>{
      const before=(await persisted()).plays[0];await click('[data-action="multi-select"]');await tapPlayer('X');await tapPlayer('Z');
      assert.match(await page.locator('.selection-count').textContent(),/2/);await click('[data-action="multi-select"]');
      const from=await playerPoint(actor('X').id);await drag(from,{x:from.x+14,y:from.y-14});
      const moved=(await persisted()).plays[0];
      for(const label of ['X','Z']){const id=actor(label).id;assert.notDeepEqual(moved.players.find(p=>p.id===id),before.players.find(p=>p.id===id));}
      await visibleUndo();assert.deepEqual((await persisted()).plays[0],before);await assertSelectionCleared();
    });
    await check('route-cancel-and-complete',async()=>{
      const before=(await persisted()).plays[0];await tapPlayer('X');await click('.stage-dock [data-action="tool:route"]');
      const from=await playerPoint(actor('X').id);await tap({x:from.x+45,y:from.y-45});
      await click('[data-action="cancel-draft"]');assert.deepEqual((await persisted()).plays[0],before,'Canceled route changed persisted data');
      await tapPlayer('X');await click('.stage-dock [data-action="tool:route"]');
      const origin=await playerPoint(actor('X').id);
      await tap({x:origin.x+45,y:origin.y-45});
      await reachable('#field-context #draft-mode',{scroll:false,minSize:entry.touch?44:0});
      await page.locator('#draft-mode').selectOption('optional');
      await click('[data-action="finish-route"]');
      const after=(await persisted()).plays[0],added=after.routes.filter(route=>!before.routes.some(old=>old.id===route.id));
      assert.equal(added.length,1);assert.equal(added[0].optional,true);
      assert.deepEqual(after.routes.filter(route=>route.id!==added[0].id),before.routes);
      const runner=actor('X');
      for(const time of [1,2,4])assert.deepEqual(animatedPlayer(after,runner,time),animatedPlayer(before,runner,time));
      await visibleUndo();assert.deepEqual((await persisted()).plays[0],before);await assertSelectionCleared();
    });
    await check('context-menu-and-escape',async()=>{
      const before=(await persisted()).plays[0],id=actor('X').id,node=page.locator(`#field [data-player="${id}"]`);
      if(entry.touch)await tapPlayer('X');else await node.click({button:'right'});
      await reachable('#field-context [data-action="tool:route"]');
      await page.keyboard.press('Escape');assert.deepEqual((await persisted()).plays[0],before);
      await page.locator('.add-object-menu summary').click();await page.keyboard.press('Escape');
      assert.equal(await page.locator('.add-object-menu').getAttribute('open'),null,'Escape did not close add menu');
    });
    await check('property-save-reload-and-keyboard-focus',async()=>{
      if(await page.locator('.compact-nav').isVisible())await click('.compact-nav [data-action="inspector-panel"]');
      const title=page.locator('[data-prop="title"]');await title.fill(`Non AI ${entry.id}`);await title.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement?.dataset?.prop),'category','Input focus lost while saving');
      assert.equal((await persisted()).plays[0].title,`Non AI ${entry.id}`);
      if(await page.locator('.inspector-panel [data-action="close-panel"]').isVisible())await click('.inspector-panel [data-action="close-panel"]');
      await page.reload({waitUntil:'networkidle'});await page.locator('#field .pitch-svg').waitFor();
      assert.match(await page.locator('.play-header h1').textContent(),new RegExp(`Non AI ${entry.id}`));
      assert.equal((await persisted()).plays[0].title,`Non AI ${entry.id}`);
    });
    await check('roster-dialog-cancel-and-session',async()=>{
      await click('.workspace-nav [data-workspace-mode="roster"]');await page.locator('#roster-root:not([hidden])').waitFor();
      await click('[data-roster-tab="directory"]');const search=page.locator('.roster-tools [type="search"]');await search.fill('Alex');
      assert.equal(await page.locator('.roster-results tbody tr').count(),1);
      const before=(await persisted()).roster;await click('[data-roster="edit"]');await page.locator('.roster-dialog [name="name"]').fill('Unsaved acceptance name');
      await page.keyboard.press('Escape');assert.equal(await page.locator('.roster-dialog').getAttribute('open'),null);assert.deepEqual((await persisted()).roster,before);
      await click('.workspace-nav [data-workspace-mode="editor"]');await click('.workspace-nav [data-workspace-mode="roster"]');
      assert.equal(await page.locator('.roster-tools [type="search"]').inputValue(),'Alex');await screenshot('roster');
      await click('.workspace-nav [data-workspace-mode="editor"]');await page.locator('#field .pitch-svg').waitFor();
      const h=await page.locator('#field').evaluate(n=>n.getBoundingClientRect().height);assert.ok(h>=200,'Returned editor shrank');
    });
    await check('catalog-filter-preview-and-escape',async()=>{
      await click('[data-action="madden-library"]');await page.locator('#madden-team-search').fill('Rams');
      assert.equal(await page.locator('[data-madden="team"]:visible').count(),1);await click('[data-madden="team"]');
      assert.match(await page.locator('.madden-active-scope').textContent(),/Rams/i);
      await page.locator('[data-madden="scope"][data-scope="all"]').click();assert.match(await page.locator('.madden-active-scope').textContent(),/13/);
      await page.locator('#madden-search').fill('mesh');await page.locator('[data-madden="preview"]').first().click();
      await reachable('.madden-detail [data-madden="back"]');await click('.madden-detail [data-madden="back"]');
      assert.equal(await page.locator('#madden-search').inputValue(),'mesh');await screenshot('catalog');
      await page.keyboard.press('Escape');assert.equal(await page.locator('.madden-panel').isVisible(),false);
    });
    await check('export-dialog-reachable-and-cancel',async()=>{
      await click('[data-action="export"]');for(const kind of ['download-svg','download-png','download-json','download-play'])await reachable(`[data-action="${kind}"]`);
      await screenshot('export');await page.keyboard.press('Escape');assert.equal(await page.locator('#modal-root').evaluate(node=>node.childElementCount),0);
    });
    await check('backup-download-and-import-undo',async()=>{
      const before=await persisted();await click('[data-action="export"]');
      const pending=page.waitForEvent('download');await click('[data-action="download-json"]');const download=await pending;
      const source=await download.path();assert.ok(source,'Backup download did not complete');
      assert.deepEqual(decodeWorkspace(await readFile(source,'utf8')),before,'Downloaded backup differs from saved workspace');
      await page.keyboard.press('Escape');
      const incoming={...before,plays:[{...before.plays[0],title:'Acceptance import'}],formations:[],roster:[],depthChart:{groups:[]}};
      await page.locator('#import-input').setInputFiles({name:'acceptance.json',mimeType:'application/json',buffer:Buffer.from(encodeWorkspace(incoming))});
      await page.locator('[data-action="confirm-import"]').click();const after=await persisted();
      assert.equal(after.plays.length,before.plays.length+1);assert.deepEqual(after.plays.slice(0,before.plays.length),before.plays);
      await visibleUndo();assert.deepEqual(await persisted(),before);
    });
    await check('reduced-motion-and-touch-mode',async()=>{
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.motion),entry.reduced?'reduced':'full');
      if(entry.touch){await page.locator('.effects-menu summary').click();assert.equal(await page.locator('[data-effects-mode="digital"]').isEnabled(),false);await page.keyboard.press('Escape');}
    });
    await check('performance-sample',async()=>{
      result.performance=await page.evaluate(async()=>{const{sampleFrames}=await import('/__qa/acceptance-performance.js');return sampleFrames(window).promise;});
      assert.equal(result.performance.validation,'sampled','Insufficient real rAF samples');
      // Sampling success is not a performance pass. These thresholds are review
      // signals under this browser, never device FPS or a before/after benefit.
      result.performance.reviewRequired=result.performance.frameIntervalP95Ms>50||result.performance.longTaskMaxMs>150;
    });
    assert.equal(result.externalRequests.filter(url=>/api\.openai|anthropic|deepseek|board-assistant|matchup/.test(url)).length,0,'AI network request attempted');
  } catch(error) { result.errors.push(error.message);await screenshot('setup-failure').catch(()=>{}); }
  finally { await context.close(); }
  console.log(`${entry.id}: ${result.checks.filter(item=>item.status==='passed').length}/${result.checks.length} checks; ${result.errors.length} setup/page errors`);
}
