import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

test('login provides inline validation, prevents duplicate submissions and keeps recovery paths visible', async t => {
  const win = new Window({ url: 'https://playbook.test/editor/', width: 1400, height: 900 });
  win.document.body.innerHTML = '<div id="cloud-root"></div><div id="app"></div><div class="form-feedback" hidden></div>';
  const names = ['window','document','location','localStorage','fetch'], previous = Object.fromEntries(names.map(n => [n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  let pending, loginCount = 0;
  for (const name of names.filter(n=>n!=='fetch')) Object.defineProperty(globalThis,name,{configurable:true,value:win[name]});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async (path)=>{
    if(path==='/api/session') return new Response(JSON.stringify({user:null}),{status:200});
    if(path==='/api/auth/login'){loginCount++; return new Promise(resolve=>{pending=resolve;});}
    throw new Error('Unexpected request');
  }});
  const settle = async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
  const q=s=>win.document.querySelector(s);
  try {
    const { SharedWorkspace } = await import('../web/cloud.js');
    let shown;const app = new SharedWorkspace({showEditor:value=>{shown=value;},toast:()=>{},onStatus:()=>{}}); await app.init();
    await t.test('anonymous visitors see a named login form, no editor, and clear account recovery guidance',()=>{
      assert.equal(shown,false); assert.ok(q('#account-login')); assert.equal(q('#login-username').autocomplete,'username');
      assert.match(q('.login-assistance').textContent,/忘记密码.*管理员/); assert.ok(q('.legacy-signin a')); assert.ok(q('[data-cloud-action="privacy"]'));
    });
    await t.test('empty submission stays in place and explains what the user must enter',async()=>{
      q('[data-cloud-action="login"]').click(); await settle();
      assert.equal(loginCount,0); assert.equal(q('#account-login .form-feedback').hidden,false); assert.match(q('#account-login .form-feedback').textContent,/账号和密码/);
      assert.equal(win.document.activeElement,q('#login-username'));
    });
    await t.test('a pending login is visibly busy, submits once, then shows server errors without losing the account name',async()=>{
      q('#login-username').value='test_user';q('#login-password').value='fake-test-password';
      const button=q('[data-cloud-action="login"]');button.click();button.click();await settle();
      assert.equal(loginCount,1);assert.equal(button.disabled,true);assert.match(button.textContent,/验证/);
      pending(new Response(JSON.stringify({error:'账号或密码不正确，请检查后重试'}),{status:401}));await settle();
      assert.equal(button.disabled,false);assert.match(q('#account-login .form-feedback').textContent,/密码不正确/);assert.equal(q('#login-username').value,'test_user');
      q('[data-cloud-action="toggle-password"]').click();await settle();assert.equal(q('#login-password').type,'text');
      assert.equal(q('[data-cloud-action="toggle-password"]').getAttribute('aria-pressed'),'true');
    });
  } finally {await win.happyDOM.abort();for(const n of names){if(previous[n])Object.defineProperty(globalThis,n,previous[n]);else delete globalThis[n];}}
});
