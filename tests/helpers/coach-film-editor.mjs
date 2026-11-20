import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
import {Window} from 'happy-dom';
import {encodeWorkspace,starterWorkspace,STORAGE_KEY} from '../../web/model.js';

register(new URL('./window-modules.mjs', import.meta.url));
const index = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
let windowId = 0;

export async function editor(t, {seed = starterWorkspace(), locale, reduced = false, device = 'desktop', digital = false, cloud, fetchImpl, pilot} = {}) {
  const url = new URL(cloud ? 'https://playbook.test/editor/index.html' : 'http://localhost:3000/local.html#editor');
  if (pilot) url.searchParams.set('filmPilot',pilot);
  const width = {desktop:1366, iphone:390, ipad:1024}[device];
  const win = new Window({url:url.href,width,height:768});
  const doc = win.document;
  doc.body.innerHTML = index.split('<body>')[1].split('</body>')[0];
  win.localStorage.setItem(STORAGE_KEY,encodeWorkspace(seed));
  win.localStorage.setItem('playbook-studio:onboarding:v1',JSON.stringify({dismissed:true,completed:[]}));
  if (locale) win.localStorage.setItem('playbook-studio.locale',locale);
  if (digital) win.localStorage.setItem('playbook-visual-mode','digital');
  if (device === 'iphone') Object.defineProperty(win.navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari'});
  if (device === 'ipad') Object.defineProperties(win.navigator,{
    userAgent:{value:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'},
    platform:{value:'MacIntel'},maxTouchPoints:{value:5},
  });
  if (reduced) {
    const match = win.matchMedia.bind(win);
    win.matchMedia = query => {
      const media = match(query);
      if (query === '(prefers-reduced-motion: reduce)') Object.defineProperty(media,'matches',{value:true});
      return media;
    };
  }
  const globals = ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  if (cloud || fetchImpl) {
    globals.push('fetch');
    win.fetch = (url,options) => {
      if (cloud && String(url).startsWith('/api/')) return cloud.fetch(url,options);
      if (fetchImpl) return fetchImpl(url,options);
      throw Error('Unexpected URL '+url);
    };
  }
  if (cloud) {
    const original=win.setInterval.bind(win);
    win.setInterval=(callback,ms,...args)=>{
      if (ms!==6000) return original(callback,ms,...args);
      cloud.poll=callback;
      return 1;
    };
  }
  const prior = new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  for (const name of globals) Object.defineProperty(globalThis,name,{configurable:true,
    value:['requestAnimationFrame','cancelAnimationFrame'].includes(name)?win[name].bind(win):win[name]});
  t.after(async()=>{
    win.dispatchEvent(new win.Event('pagehide'));
    await win.happyDOM.abort();
    for (const [name,descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis,name,descriptor);
      else delete globalThis[name];
    }
  });
  await import('../../web/app.js?test-window=coach-film-'+(++windowId));
  const q = selector => doc.querySelector(selector);
  const node = selector => {
    const element = q(selector);
    assert.ok(element,selector);
    return element;
  };
  const click = selector => node(selector).click();
  const action = name => click('[data-action="'+name+'"]');
  const key = (element,key,extra={}) => element.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
  const emit = (element,name) => element.dispatchEvent(new win.Event(name,{bubbles:true}));
  const change = (selector,value) => {
    const target = node(selector);
    target.value = String(value); emit(target,'change');
  };
  const waitFor = selector => {
    if (q(selector)) return Promise.resolve(q(selector));
    return new Promise((resolve,reject)=>{
      const timer = setTimeout(()=>{observer.disconnect();reject(Error('Did not open '+selector));},3500);
      const observer = new win.MutationObserver(()=>{
        const target = q(selector);
        if (target) {clearTimeout(timer);observer.disconnect();resolve(target);}
      });
      observer.observe(doc.body,{subtree:true,childList:true,attributes:true});
    });
  };
  const openFilm = () => {
    const opener = node('[data-action="coach-film"]');
    assert.equal(opener.disabled,false,'available to a desktop viewer');
    opener.focus(); opener.click();
    return waitFor('#coach-film-room[open]');
  };
  const closeFilm = () => click('#coach-film-room [data-film-action="exit"]');
  const raw = () => win.localStorage.getItem(STORAGE_KEY);
  return {win,doc,q,node,click,action,key,emit,change,waitFor,openFilm,closeFilm,raw};
}

export function actorId(play,label) {
  return play.players.find(p=>p.label===label).id;
}
