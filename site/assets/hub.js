import { catalog, categories, filterCatalog, validateFavorites } from './catalog.js';

const KEY = 'baeummaru:favorites:v1';
const $ = selector => document.querySelector(selector);
let favorites = [];
let category = 'all';
let view = 'all';
try { favorites = validateFavorites(JSON.parse(localStorage.getItem(KEY))); }
catch { $('#storage-message').textContent = '즐겨찾기를 읽지 못했어요. 이 화면에서는 계속 사용할 수 있어요.'; }

const star = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg>';
for (const item of categories) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'filter'; button.textContent = item.label;
  button.addEventListener('click', () => { category = item.id; render(); });
  button.dataset.category = item.id;
  $('#categories').append(button);
}

function render() {
  const tools = filterCatalog($('#search').value, category, view === 'favorites' ? favorites : null);
  $('#tool-grid').replaceChildren();
  for (const tool of tools) {
    const article = document.createElement('article'); article.className = 'tool';
    // Markup is fixed. All catalog data is inserted through safe DOM properties.
    article.innerHTML = '<div class="cover-wrap"><a class="cover-link"><img width="600" height="600" loading="lazy" alt=""></a><button class="favorite" type="button">'+star+'</button></div><p class="tool-tag"></p><h3><a></a></h3><p class="tool-description"></p><p class="tool-meta"></p>';
    for (const link of article.querySelectorAll('a')) link.href = tool.href;
    article.querySelector('.cover-link').setAttribute('aria-label', tool.title + ' 열기');
    article.querySelector('img').src = tool.cover;
    article.querySelector('.tool-tag').textContent = tool.tag;
    article.querySelector('h3 a').textContent = tool.title;
    article.querySelector('.tool-description').textContent = tool.description;
    article.querySelector('.tool-meta').textContent = tool.meta;
    const favorite = article.querySelector('.favorite');
    favorite.setAttribute('aria-label', tool.title + ' 즐겨찾기');
    favorite.setAttribute('aria-pressed', String(favorites.includes(tool.id)));
    favorite.addEventListener('click', () => {
      const next = favorites.includes(tool.id) ? favorites.filter(id => id !== tool.id) : [...favorites, tool.id];
      favorites = validateFavorites(next);
      try { localStorage.setItem(KEY, JSON.stringify(favorites)); $('#storage-message').textContent = ''; }
      catch { $('#storage-message').textContent = '브라우저에 즐겨찾기를 저장하지 못했어요. 현재 화면에만 반영돼요.'; }
      if (view === 'favorites') render();
      else favorite.setAttribute('aria-pressed', String(favorites.includes(tool.id)));
    });
    $('#tool-grid').append(article);
  }
  for (const filter of document.querySelectorAll('.filter')) {
    const active = filter.dataset.category === category;
    filter.classList.toggle('active', active); filter.setAttribute('aria-pressed', String(active));
  }
  $('#tool-count').textContent = tools.length + '개의 도구';
  $('#result-status').textContent = tools.length + '개의 도구가 표시돼요.';
  $('#empty').hidden = tools.length > 0;
  $('#empty').textContent = view === 'favorites' && !favorites.length ? '카드의 별 버튼을 눌러 좋아하는 도구를 모아 보세요.' : '검색 결과가 없어요. 다른 검색어나 분류를 선택해 보세요.';
}
$('#search-form').addEventListener('submit', event => event.preventDefault());
$('#search').addEventListener('input', render);
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  view = button.dataset.view;
  $('#view-title').textContent = view === 'all' ? '오늘의 발견' : '즐겨찾기';
  $('#hero').hidden = view === 'favorites';
  for (const item of document.querySelectorAll('[data-view]')) {
    item.classList.toggle('active', item === button);
    if (item === button) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
  render();
});
render();
