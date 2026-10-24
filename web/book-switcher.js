import EmblaCarousel from './vendor/embla-carousel-8.6.0/embla-carousel.esm.js';
import { escapeHTML as e } from './model.js';
import { reconcileHTML } from './reconcile.js';

const roleLabel = role => ({ owner:'管理员', editor:'编辑者', viewer:'只读成员' })[role] || '成员';
const bookIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 5h7a3 3 0 0 1 2 1 3 3 0 0 1 2-1h7v15h-7a3 3 0 0 0-2 1 3 3 0 0 0-2-1H3zM12 6v15"/></svg>';
export function currentBookCard(books, current) {
  const selected = books.find(book => book.id === current?.id);
  return `<button type="button" class="workspace-picker workspace-current-card" data-cloud-action="books" aria-haspopup="dialog" aria-label="切换战术本：${e(current?.title || selected?.title || '选择战术本')}"><span class="workspace-current-icon">${bookIcon}</span><span class="workspace-current-copy"><small>当前战术本</small><strong>${e(current?.title || selected?.title || (books.length ? '选择战术本' : '还没有战术本'))}</strong></span><span class="workspace-current-count">${books.length}<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 3 5 5-5 5"/></svg></span></button>`;
}

// Embla provides drag physics; selecting a book is an explicit click or Enter.
// Native horizontal scrolling remains usable when observers/layout are unavailable.
export function createBookSwitcher(root, { onChoose, onError = () => {} }) {
  let api = null, books = [], currentId = '', loadingId = '', blocked = false, signature = '';
  root.innerHTML = `<section class="book-switcher" aria-label="战术本卡片"><div class="book-switcher-heading"><span class="book-count"></span><div class="book-arrows"><button type="button" data-book-scroll="prev" aria-label="上一组战术本">←</button><button type="button" data-book-scroll="next" aria-label="下一组战术本">→</button></div></div><div class="book-viewport"><div class="book-track"></div></div><p class="book-switcher-help">左右滑动浏览，点选卡片打开战术本。</p><p class="book-switcher-message" role="status" aria-live="polite"></p></section>`;
  const viewport = root.querySelector('.book-viewport'), track = root.querySelector('.book-track');
  const reduced = () => document.documentElement.dataset.effects === 'off' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cards = () => [...track.querySelectorAll('[data-book-id]')];
  function arrows() {
    root.querySelector('[data-book-scroll="prev"]').disabled = api ? !api.canScrollPrev() : viewport.scrollLeft <= 1;
    root.querySelector('[data-book-scroll="next"]').disabled = api ? !api.canScrollNext() : viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1;
  }
  function reveal(index) {
    if (index < 0) return;
    if (api) api.scrollTo(index, reduced());
    else viewport.scrollTo?.({ left:cards()[index]?.offsetLeft || 0, behavior:reduced() ? 'auto' : 'smooth' });
  }
  function setup() {
    if (api || !viewport.clientWidth || typeof ResizeObserver !== 'function' || typeof IntersectionObserver !== 'function') return;
    try {
      api = EmblaCarousel(viewport, { align:'start', containScroll:'keepSnaps', loop:false, slidesToScroll:1, watchSlides:false, duration:24 });
      root.classList.add('book-carousel-ready');
      api.on('select', arrows).on('reInit', arrows);
    } catch { api?.destroy(); api = null; }
  }
  function update({ books:nextBooks, currentId:nextId, loadingId:nextLoading = '', blocked:nextBlocked = false }) {
    const nextSignature = nextBooks.map(book => book.id).join('|'), changed = signature !== nextSignature;
    const selectionChanged = nextId !== currentId;
    books = nextBooks; currentId = nextId || ''; loadingId = nextLoading; blocked = nextBlocked; signature = nextSignature;
    root.querySelector('.book-count').textContent = `${books.length} 本战术本`;
    root.querySelector('.book-switcher').setAttribute('aria-busy', String(!!loadingId));
    reconcileHTML(track, books.map(book => `<div class="book-slide" id="book-slide-${e(book.id)}"><button type="button" class="book-card ${book.id === currentId ? 'is-current' : ''}" data-book-id="${e(book.id)}" aria-pressed="${book.id === currentId}" aria-disabled="${blocked}" aria-label="${e(book.title)} · ${roleLabel(book.role)}${book.id === currentId ? ' · 当前使用' : ''}"><span class="book-card-top">${bookIcon}<span>${book.id === loadingId ? '正在打开…' : book.id === currentId ? '当前使用' : '点按切换'}</span></span><strong>${e(book.title)}</strong><span class="book-card-role" data-role="${e(book.role)}">${roleLabel(book.role)}</span></button></div>`).join(''));
    if (!books.length) track.innerHTML = '<p class="book-switcher-empty">还没有战术本，创建一本开始布阵。</p>';
    const hadApi = !!api; setup();
    if (api && hadApi && changed) api.reInit();
    if (selectionChanged || changed) reveal(books.findIndex(book => book.id === currentId));
    if (blocked && !loadingId) message('有未同步更改，请等待保存完成后切换。');
    else if (loadingId) message('正在载入战术，当前内容保持到载入成功。');
    else message('');
    arrows();
  }
  function message(value) { root.querySelector('.book-switcher-message').textContent = value; }
  async function click(event) {
    const step = event.target.closest('[data-book-scroll]');
    if (step) {
      if (api) api[step.dataset.bookScroll === 'prev' ? 'scrollPrev' : 'scrollNext'](reduced());
      else viewport.scrollBy?.({ left:(step.dataset.bookScroll === 'prev' ? -1 : 1) * viewport.clientWidth * .85, behavior:reduced() ? 'auto' : 'smooth' });
      return;
    }
    const card = event.target.closest('[data-book-id]');
    // Embla 8 suppresses clicks after a drag in its viewport capture listener.
    if (!card || blocked) return;
    try { await onChoose(card.dataset.bookId); }
    catch (error) { message(error.message || '未能打开，请重试。'); onError(error); }
  }
  function keydown(event) {
    const index = cards().indexOf(event.target.closest('[data-book-id]'));
    if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? books.length - 1 : Math.max(0, Math.min(books.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
    cards()[next]?.focus({ preventScroll:true }); reveal(next);
  }
  root.addEventListener('click', click); root.addEventListener('keydown', keydown); viewport.addEventListener('scroll', arrows, { passive:true });
  return { update, message, destroy() { api?.destroy(); api = null; root.removeEventListener('click', click); root.removeEventListener('keydown', keydown); viewport.removeEventListener('scroll', arrows); } };
}
