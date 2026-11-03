import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { handleApi } from '../server/api.mjs';
import { decodeWorkspace, encodeWorkspace, starterWorkspace, STORAGE_KEY } from '../web/model.js';
import { trainingDemo } from '../web/training-demo.js';
import { database } from './helpers/db.mjs';

const body = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').split('<body>')[1].split('</body>')[0];
const origin = 'https://playbook.test';
let bootCount = 0;

async function boot(t, { url, localBook, fetch }) {
  const win = new Window({ url, width: 390, height: 844 });
  win.document.body.innerHTML = body;
  if (localBook) win.localStorage.setItem(STORAGE_KEY, encodeWorkspace(localBook));
  win.setInterval = () => 1;
  win.scrollTo = () => {};
  const names = ['window','document','navigator','localStorage','location','history','Image','Blob','requestAnimationFrame','cancelAnimationFrame'];
  const previous = Object.fromEntries(names.map(n => [n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  for (const n of names) {
    const value = n.endsWith('AnimationFrame') ? win[n].bind(win) : win[n];
    Object.defineProperty(globalThis,n,{configurable:true,value});
  }
  t.mock.method(globalThis,'fetch',fetch);
  t.after(async () => {
    await win.happyDOM.abort();
    for (const n of names) {
      if (previous[n]) Object.defineProperty(globalThis,n,previous[n]); else delete globalThis[n];
    }
  });
  await import('../web/app.js?training-workspace=' + ++bootCount);
  const q = selector => win.document.querySelector(selector);
  const click = selector => {
    const el = q(selector);
    assert.ok(el,selector);
    el.dispatchEvent(new win.MouseEvent('click',{bubbles:true}));
  };
  const set = (name,value) => {
    const el = q('#training-author-root [name="' + name + '"]');
    assert.ok(el,name);
    el.value = value;
    el.dispatchEvent(new win.Event(el.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true}));
  };
  return {win,q,click,set};
}

async function until(predicate) {
  const stop = Date.now() + 5000;
  while (!predicate() && Date.now() < stop) await new Promise(resolve => setTimeout(resolve,5));
  assert.ok(predicate(),'Expected the application to finish navigation or saving');
}

test('preview links the hub, a concrete DEPTH CHART position and coach-authored practice without a backend', async t => {
  const data = starterWorkspace(), calls = [];
  data.plays.unshift(trainingDemo().plays[0]);
  const {win,q,click,set} = await boot(t,{
    url:'https://timpickle.github.io/playbook-studio-web/prerelease/',localBook:data,
    fetch:async path => {calls.push(path); throw Error('Unexpected request on the offline preview');}
  });
  click('#cloud-root [data-cloud-action="enter-training"]');
  assert.equal(q('#training-root').hidden,false);
  assert.equal(q('[data-tr-role]').value,'');
  click('[data-tr="home"]');
  click('#cloud-root [data-cloud-action="enter-roster"]');
  click('[data-roster-tab="depth"]');
  const qb = data.depthChart.groups.find(g => g.id === 'spread').slots.find(s => s.label === 'QB');
  click('.df-pitch [data-slot="' + qb.id + '"]');
  click('#depth-formation-detail [data-training-role="QB"]');
  assert.equal(q('#roster-root').hidden,true);
  assert.equal(q('[data-tr-role]').value,'QB');
  assert.ok(q('[data-tr="start"]'));
  click('[data-tr="home"]');
  click('#cloud-root [data-cloud-action="enter-editor"]');
  click('[data-action="author-training"]');
  assert.equal(q('#training-author-root').hidden,false);
  assert.equal(q('#app').hidden,true);
  assert.equal(q('[name="playId"]').value,data.plays[0].id);
  set('title','Demo team read');
  set('question','Which defender is the declared read?');
  set('explanation','This defender is the assigned read in this protection.');
  click('.ta-picks [data-marker="will"]');
  click('[data-ta="preview"]');
  await until(() => q('[data-ta="accept"]')?.disabled === false);
  click('[data-ta="accept"]');click('[data-ta="publish"]');
  await until(() => !q('#training-root').hidden && !!q('.tr-card h3'));
  const { drills } = decodeWorkspace(win.localStorage.getItem(STORAGE_KEY));
  assert.equal(drills.length,1);
  assert.equal(drills[0].status,'published');
  assert.equal(drills[0].title,'Demo team read');
  const card = Array.from(win.document.querySelectorAll('.tr-card')).find(c => c.querySelector('h3').textContent === drills[0].title);
  assert.ok(card,'Published coach item appears in the learner library');
  card.querySelector('[data-tr="start"]').click();
  assert.match(q('#training-root').textContent,/Which defender is the declared read/);
  assert.deepEqual(calls,[]);
});

test('a cloud viewer completes a published team drill while the shared playbook revision stays unchanged',async t => {
  const db = database(t), owner = {userId:'coach',email:'coach@example.org',displayName:'Coach'};
  const viewer = {userId:'qb2',email:'qb2@example.org',displayName:'Backup QB'};
  const api = (user,path,init = {}) => handleApi(new Request(origin + path,{
    ...init,headers:{Origin:origin,'Content-Type':'application/json',...init.headers}
  }),{DB:db},user);
  const post = async (user,path,body) => {
    const response = await api(user,path,{method:'POST',body:JSON.stringify(body)});
    assert.ok(response.ok,'setup ' + path + ': ' + response.status);
    return response.json();
  };
  const bookData = {...starterWorkspace(),...trainingDemo()};
  bookData.drills[0] = {...bookData.drills[0],title:'Team practice'};
  const book = await post(owner,'/api/workspaces',{title:'Team book',data:bookData});
  const invite = await post(owner,'/api/workspaces/' + book.id + '/invites',{email:viewer.email,role:'viewer'});
  const token = new URL(invite.url).searchParams.get('invite');
  await post(viewer,'/api/invites/' + token + '/accept',{});
  const methods = [];
  const {q,click} = await boot(t,{url:origin + '/editor/index.html',fetch:async (path,options = {}) => {
    methods.push(options.method || 'GET');
    return api(viewer,path,options);
  }});
  await until(() => q('#cloud-root [data-cloud-action="enter-training"]'));
  click('#cloud-root [data-cloud-action="enter-training"]');
  await until(() => !q('#training-root').hidden && Array.from(q('#training-root').querySelectorAll('[data-tr="start"]')).some(b => JSON.parse(b.dataset.key)[0] === 'team'));
  assert.equal(q('.tr-coach'),null);
  const first = q('.tr-card');
  assert.equal(JSON.parse(first.querySelector('button[data-tr="start"]').dataset.key)[0],'team');
  first.querySelector('button[data-tr="start"]').click();
  click('[data-tr-mode="field"]');
  await until(() => q('[data-tr-mode="field"]')?.getAttribute('aria-pressed') === 'true' && q('[data-training-marker]'));
  for (const id of bookData.drills[0].targetIds) click('[data-training-marker="' + id + '"]');
  click('[data-tr="submit"]');
  assert.ok(q('.tr-explanation'));
  click('[data-tr="next"]');click('[data-tr="library"]');
  assert.ok(q('.tr-card .tr-record'));
  click('[data-tr="home"]');
  click('#cloud-root [data-cloud-action="enter-editor"]');
  await until(() => !q('#app').hidden);
  assert.equal(q('[data-action="author-training"]'),null);
  assert.ok(methods.length > 0);
  assert.ok(methods.every(method => method === 'GET'));
  const persisted = await (await api(owner,'/api/workspaces/' + book.id)).json();
  assert.equal(persisted.revision,book.revision);
  assert.deepEqual(persisted.data.drills,book.data.drills);
});
