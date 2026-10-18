import { fieldSVG } from './field.js';
import { starterWorkspace, STORAGE_KEY, decodeWorkspace, encodeWorkspace } from './model.js';
document.querySelector('#export-local')?.addEventListener('click', () => {
  const status = document.querySelector('#migration-status');
  try {
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) { status.textContent = '当前浏览器没有旧版本地战术。'; return; }
    const data = decodeWorkspace(raw), url = URL.createObjectURL(new Blob([encodeWorkspace(data)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = 'local-playbook-for-cloud.json'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); status.textContent = `已导出 ${data.plays.length} 个战术，原数据仍保留。`;
  } catch { status.textContent = '旧版文件无法读取，请在本地预览版中检查。'; }
});

const demo = document.querySelector('#landing-preview');
if (demo) {
  const examples = starterWorkspace();
  const show = type => { const play = type === 'defense' ? examples.plays.find(p => p.title.includes('Cover 3')) : examples.plays[0]; demo.innerHTML = fieldSVG(play, {}, { thumbnail: true, prefix: 'gateway' }); document.querySelectorAll('[data-demo]').forEach(b => { b.classList.toggle('active',b.dataset.demo === type); b.setAttribute('aria-pressed',String(b.dataset.demo === type)); }); };
  show('offense'); document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click',()=>show(b.dataset.demo)));
}
