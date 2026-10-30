import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

test('cloud login, home and playbook controls use the selected locale without translating account data', async () => {
  const win = new Window({ url: 'https://playbook.test/editor/', width: 1400, height: 900 });
  win.document.body.innerHTML = '<div id="cloud-root"></div>';
  const names = ['window', 'document', 'location', 'localStorage', 'fetch'];
  const old = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names.filter(name => name !== 'fetch')) Object.defineProperty(globalThis, name, { configurable: true, value: win[name] });
  try {
    const { setLocale } = await import('../web/i18n.js');
    const { SharedWorkspace, request } = await import('../web/cloud.js');
    setLocale('en');
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => new Response(JSON.stringify({ error: '账号或密码不正确，请检查后重试' }), { status: 401 }) });
    await assert.rejects(request('/api/auth/login'), error => error.status === 401 && error.message === 'Incorrect username or password. Please try again.');
    const app = new SharedWorkspace({ onStatus() {}, showEditor() {}, toast() {} });
    app.renderLogin();
    assert.match(win.document.querySelector('.login-form-wrap h2').textContent, /Sign in/);
    assert.match(win.document.querySelector('.login-assistance').textContent, /administrator/);
    app.user = { name: '我的球队', username: 'team', authMode: 'password' };
    app.books = [];
    app.renderHome();
    assert.match(win.document.querySelector('.studio-home-account').textContent, /Hello, 我的球队/);
    assert.match(win.document.querySelector('.studio-choice-editor h2').textContent, /Edit playbook/);
    app.mode = 'editor';
    app.renderBar();
    assert.match(win.document.querySelector('[data-cloud-action="books"]').textContent, /Current playbook/);
    assert.match(win.document.querySelector('[data-cloud-action="home"]').textContent, /Workspace/);
    app.setStatus('网络离线 · 本机草稿已保留');
    assert.match(win.document.querySelector('#cloud-status').textContent, /Offline · Local draft saved/);
    assert.equal(win.document.querySelector('#cloud-status').dataset.state, 'pending');
    setLocale('zh-CN');
    app.renderLogin();
    assert.match(win.document.querySelector('.login-form-wrap h2').textContent, /登录战术工作台/);
  } finally {
    await win.happyDOM.abort();
    for (const name of names) old[name] ? Object.defineProperty(globalThis, name, old[name]) : delete globalThis[name];
  }
});
