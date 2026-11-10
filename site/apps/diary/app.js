import { MOODS as moods, validateEntry, entryFields, createIdentityScope, mergeEntries, publicError } from './diary-model.js';
import { initializeDiaryFirebase, isConfigured, DISPLAY_LIMIT, PAGE_SIZE } from './firebase.js';

const $ = selector => document.querySelector(selector);
const now = new Date();
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = localDate(now);
const scope = createIdentityScope();
let adapter, entries = [], view = 'all', chosenDate = '', month = new Date(now.getFullYear(), now.getMonth(), 1);
let editingId = null, editingExisting = false, readingId = null, mood = 'calm', saving = false, readerBusy = false;
let loading = false, hasMore = false, cursor = null, accountBusy = false, exportBusy = false, mutationRevision = 0, toastTimer;

function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; $('#toast').textContent = ''; }, 4500);
}
function showError(selector, message) { $(selector).textContent = message; $(selector).hidden = false; }
function formatDate(date) { return new Date(`${date}T12:00:00`).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }); }
function textEl(tag, className, text) { const el = document.createElement(tag); el.className = className; el.textContent = text; return el; }
function setAuthControls() {
  const signedIn = !!scope.uid;
  $('#login').hidden = signedIn;
  $('#login').disabled = !adapter || accountBusy;
  $('#logout').hidden = $('#switch-account').hidden = !signedIn;
  $('#logout').disabled = $('#switch-account').disabled = accountBusy;
  $('#new-entry').disabled = $('#empty-new').disabled = !signedIn;
  $('#export').disabled = $('#mobile-export').disabled = !signedIn || exportBusy;
  $('#export').textContent = exportBusy ? '서버에서 백업 준비 중…' : '↓ 내 일기 JSON 백업';
}
function setSaving(value) {
  saving = value;
  $('#entry-form').querySelectorAll('input, textarea, button').forEach(el => { el.disabled = value; });
  $('#save-entry').textContent = value ? '서버 저장 확인 중…' : '일기 저장하기';
}
function setReaderBusy(value) {
  readerBusy = value;
  for (const id of ['reader-favorite', 'edit-entry', 'delete-entry']) $(`#${id}`).disabled = value;
}
function clearPrivateScreen() {
  entries = []; cursor = null; hasMore = false; loading = false; exportBusy = false; mutationRevision = 0;
  editingId = readingId = null; editingExisting = false; chosenDate = ''; view = 'all';
  $('#editor').close(); $('#reader').close(); $('#entry-form').reset();
  $('#entry-title').value = $('#entry-content').value = $('#entry-date').value = '';
  for (const id of ['reader-title', 'reader-content', 'reader-date', 'reader-mood', 'reader-updated', 'reader-favorite', 'draft-status', 'toast', 'form-error', 'load-error']) $(`#${id}`).textContent = '';
  $('#form-error').hidden = $('#load-error').hidden = $('#toast').hidden = true;
  clearTimeout(toastTimer); $('#search').value = $('#mood-filter').value = '';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === 'all'));
  setSaving(false); setReaderBusy(false); setMood('calm'); render();
}
function onIdentity(user) {
  scope.switchTo(user?.uid);
  clearPrivateScreen();
  $('#auth-status').textContent = user ? '내 Google 계정으로 로그인했어요' : '나만의 기록, 로그인하고 이어 쓰세요';
  $('#auth-description').textContent = user ? 'Firebase에 저장되는 개인 일기입니다. 공용 컴퓨터에서는 사용 후 로그아웃해 주세요.' : 'Google 로그인 후 내 일기만 불러옵니다. 기록과 임시 초안은 로그아웃하면 화면에서 지워집니다.';
  setAuthControls();
  if (user) void loadPage();
}
function render() {
  $('#mobile-date').value = chosenDate;
  $('#nav-count').textContent = $('#total-count').textContent = String(entries.length);
  $('#month-count').textContent = String(entries.filter(entry => entry.date.startsWith(today.slice(0, 7))).length);
  $('#favorite-count').textContent = String(entries.filter(entry => entry.favorite).length);
  const query = $('#search').value.trim().toLocaleLowerCase(), filter = $('#mood-filter').value;
  const filtered = entries.filter(entry => (view !== 'favorite' || entry.favorite) && (!chosenDate || entry.date === chosenDate) && (!filter || entry.mood === filter) && (!query || `${entry.title} ${entry.content}`.toLocaleLowerCase().includes(query)));
  const count = textEl('span', '', String(filtered.length)); count.id = 'list-count';
  $('#list-title').replaceChildren(document.createTextNode(chosenDate ? formatDate(chosenDate) : view === 'favorite' ? '소중한 일기' : '모든 일기'), count);
  const grid = $('#entries'); grid.replaceChildren();
  for (const entry of filtered) {
    const card = textEl('button', 'entry-card', ''); card.type = 'button';
    card.setAttribute('aria-label', `${entry.title}, ${formatDate(entry.date)} 읽기`);
    const top = textEl('div', 'card-top', ''); top.append(textEl('span', '', formatDate(entry.date)), textEl('span', '', entry.favorite ? '♥' : '♡'));
    const bottom = textEl('div', 'card-bottom', ''); bottom.append(textEl('span', 'mood-badge', moods[entry.mood].join(' ')), textEl('span', '', `${entry.content.length.toLocaleString()}자`));
    card.append(top, textEl('h3', '', entry.title), textEl('p', '', entry.content), bottom);
    card.onclick = () => openReader(entry.id); grid.append(card);
  }
  $('#empty').hidden = filtered.length > 0 || loading;
  const loadFailed = scope.uid && !$('#load-error').hidden;
  $('#empty h3').textContent = !scope.uid ? '나만의 이야기를 위한 공간' : loadFailed ? '일기를 아직 불러오지 못했어요' : entries.length ? '아직 이곳에는 기록이 없어요' : '이곳에서 나의 이야기가 시작돼요';
  $('#empty p').textContent = !scope.uid ? '위의 Google 로그인 버튼으로 나만의 일기장을 열어 주세요.' : loadFailed ? '연결을 확인한 뒤 아래의 다시 불러오기 버튼을 눌러 주세요.' : entries.length ? '불러온 일기 안에서 검색합니다. 필터를 바꾸거나 이전 일기를 더 불러와 보세요.' : '오늘의 기분, 스쳐 간 생각, 작은 행복까지. 첫 번째 하루의 조각을 남겨보세요.';
  $('#empty-new').hidden = !scope.uid;
  $('#page-status').textContent = !scope.uid ? '로그인하면 내 일기를 불러옵니다.' : loading ? '서버에서 일기를 불러오고 있어요…' : `${entries.length}편 불러옴 · 검색·달력·통계는 불러온 일기 기준${entries.length >= DISPLAY_LIMIT ? ' · 화면 한도 500편, 전체 기록은 JSON 백업' : ''}`;
  $('#load-more').hidden = !scope.uid || !hasMore || entries.length >= DISPLAY_LIMIT;
  $('#load-more').disabled = loading;
  $('#reload').hidden = !scope.uid;
  $('#reload').disabled = loading;
  renderCalendar();
}
function renderCalendar() {
  const year = month.getFullYear(), m = month.getMonth();
  $('#calendar-title').textContent = `${year}년 ${m + 1}월`;
  const grid = $('#calendar-grid'); grid.replaceChildren();
  for (let i = 0; i < month.getDay(); i++) grid.append(document.createElement('span'));
  for (let n = 1; n <= new Date(year, m + 1, 0).getDate(); n++) {
    const date = localDate(new Date(year, m, n)), button = textEl('button', '', n); button.type = 'button';
    button.classList.toggle('today', date === today); button.classList.toggle('selected', date === chosenDate);
    button.classList.toggle('has-entry', entries.some(entry => entry.date === date));
    button.setAttribute('aria-label', formatDate(date)); button.setAttribute('aria-pressed', String(date === chosenDate));
    button.onclick = () => { chosenDate = date === chosenDate ? '' : date; render(); }; grid.append(button);
  }
  $('#clear-date').hidden = !chosenDate;
}
async function loadPage(reset = false) {
  if (!scope.uid || loading) return;
  const token = scope.capture(), revision = mutationRevision; let retry = false; loading = true;
  if (reset) { entries = []; cursor = null; hasMore = false; }
  $('#load-error').hidden = true; render();
  try {
    const result = await adapter.listPage(cursor, Math.min(PAGE_SIZE, DISPLAY_LIMIT - entries.length));
    if (!scope.isCurrent(token)) return;
    // A query started before a save/delete must not resurrect an old document.
    if (revision !== mutationRevision) { retry = true; return; }
    entries = mergeEntries(entries, result.entries); cursor = result.cursor; hasMore = result.hasMore;
  } catch (error) { if (scope.isCurrent(token)) showError('#load-error', publicError(error)); }
  finally { if (scope.isCurrent(token)) { loading = false; render(); if (retry && entries.length < DISPLAY_LIMIT) void loadPage(); } }
}
function setMood(value) {
  mood = Object.hasOwn(moods, value) ? value : 'calm';
  document.querySelectorAll('[data-mood]').forEach(button => {
    button.classList.toggle('chosen', button.dataset.mood === mood);
    button.setAttribute('aria-pressed', String(button.dataset.mood === mood));
  });
}
function draftKey() { return editingExisting ? `entry:${editingId}` : 'new'; }
function formData() { return { date: $('#entry-date').value, title: $('#entry-title').value, content: $('#entry-content').value, mood, favorite: $('#entry-favorite').checked }; }
function saveDraft() {
  if (!scope.uid || !$('#editor').open || saving) return;
  scope.setDraft(draftKey(), { id: editingId, fields: formData() });
  $('#draft-status').textContent = '이 탭의 메모리에만 임시 보관 중 · 새로고침·로그아웃 시 사라집니다.';
  $('#char-count').textContent = `${$('#entry-content').value.length.toLocaleString()}자`;
}
function openEditor(entry = null) {
  if (!scope.uid || saving) return;
  editingExisting = !!entry;
  const draft = scope.getDraft(entry ? `entry:${entry.id}` : 'new');
  editingId = entry?.id || draft?.id || crypto.randomUUID();
  const data = draft?.fields || (entry ? entryFields(entry) : { date: chosenDate || today, title: '', content: '', mood: 'calm', favorite: false });
  $('#entry-date').value = data.date; $('#entry-title').value = data.title; $('#entry-content').value = data.content;
  $('#entry-favorite').checked = data.favorite; setMood(data.mood);
  $('#editor-title').textContent = entry ? '하루의 조각 다듬기' : '오늘의 조각 남기기';
  $('#form-error').hidden = true; $('#draft-status').textContent = '초안은 이 탭 메모리에만 보관됩니다. 새로고침 전에 저장해 주세요.';
  $('#char-count').textContent = `${data.content.length.toLocaleString()}자`;
  $('#editor').showModal(); saveDraft();
}
function openReader(id) {
  if (!scope.uid) return;
  const entry = entries.find(item => item.id === id); if (!entry) return;
  readingId = id; $('#reader-date').textContent = formatDate(entry.date);
  $('#reader-title').textContent = entry.title; $('#reader-content').textContent = entry.content;
  $('#reader-mood').textContent = moods[entry.mood].join(' ');
  $('#reader-favorite').textContent = entry.favorite ? '♥ 소중한 일기' : '♡ 소중한 일기로 간직하기';
  $('#reader-updated').textContent = `Firebase 마지막 저장 · ${new Date(entry.updatedAt).toLocaleString('ko-KR')}`;
  if (!$('#reader').open) $('#reader').showModal();
}

$('#today-label').textContent = formatDate(today);
$('#new-entry').onclick = $('#empty-new').onclick = () => openEditor();
document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => {
  view = button.dataset.view; chosenDate = '';
  document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button)); render();
}; });
$('#search').oninput = render; $('#mood-filter').onchange = render;
$('#clear-date').onclick = $('#mobile-clear').onclick = () => { chosenDate = ''; render(); };
$('#prev-month').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); renderCalendar(); };
$('#next-month').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); renderCalendar(); };
document.querySelectorAll('[data-mood]').forEach(button => { button.onclick = () => { setMood(button.dataset.mood); saveDraft(); }; });
$('#entry-form').addEventListener('input', saveDraft);
$('#close-editor').onclick = () => { if (!saving) { saveDraft(); $('#editor').close(); } };
$('#editor').addEventListener('cancel', event => { if (saving) event.preventDefault(); else saveDraft(); });
$('#close-reader').onclick = () => $('#reader').close();
$('#load-more').onclick = () => { if (entries.length < DISPLAY_LIMIT) void loadPage(); };
$('#reload').onclick = () => void loadPage(true);
$('#mobile-date').onchange = () => { chosenDate = $('#mobile-date').value; render(); };

$('#entry-form').onsubmit = async event => {
  event.preventDefault(); if (saving || !scope.uid) return;
  let data;
  try { data = validateEntry(formData()); }
  catch (error) { showError('#form-error', error.message); return; }
  const token = scope.capture(), id = editingId, key = draftKey(), existing = editingExisting;
  setSaving(true); $('#form-error').hidden = true;
  try {
    const saved = await adapter[existing ? 'update' : 'create'](id, data);
    if (!scope.isCurrent(token)) return;
    mutationRevision += 1;
    scope.removeDraft(key); entries = mergeEntries(entries, [saved]).slice(0, DISPLAY_LIMIT);
    $('#editor').close(); render(); toast('Firebase에서 저장을 확인했어요.');
  } catch (error) { if (scope.isCurrent(token)) showError('#form-error', publicError(error)); }
  finally { if (scope.isCurrent(token)) setSaving(false); }
};
$('#edit-entry').onclick = () => {
  if (readerBusy) return;
  const entry = entries.find(item => item.id === readingId); if (!entry) return;
  $('#reader').close(); openEditor(entry);
};
$('#reader-favorite').onclick = async () => {
  if (readerBusy || !scope.uid) return;
  const entry = entries.find(item => item.id === readingId); if (!entry) return;
  const token = scope.capture(); setReaderBusy(true);
  try {
    const updated = await adapter.toggleFavorite(entry.id);
    if (!scope.isCurrent(token)) return;
    mutationRevision += 1;
    entries = mergeEntries(entries, [updated]); render();
    if (readingId === entry.id && $('#reader').open) openReader(entry.id);
  } catch (error) { if (scope.isCurrent(token)) toast(publicError(error)); }
  finally { if (scope.isCurrent(token)) setReaderBusy(false); }
};
$('#delete-entry').onclick = async () => {
  if (readerBusy || !scope.uid || !confirm('이 일기를 삭제할까요? 삭제한 일기는 되돌릴 수 없습니다.')) return;
  const token = scope.capture(), id = readingId; setReaderBusy(true);
  try {
    await adapter.remove(id);
    if (!scope.isCurrent(token)) return;
    mutationRevision += 1;
    entries = entries.filter(entry => entry.id !== id); scope.removeDraft(`entry:${id}`);
    $('#reader').close(); render(); toast('Firebase에서 일기를 삭제했어요.');
  } catch (error) { if (scope.isCurrent(token)) toast(publicError(error)); }
  finally { if (scope.isCurrent(token)) setReaderBusy(false); }
};
$('#export').onclick = async () => {
  if (!scope.uid || exportBusy) return;
  const token = scope.capture(); exportBusy = true; setAuthControls();
  try {
    const backup = await adapter.exportAll();
    if (!scope.isCurrent(token)) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `하루의조각-백업-${today}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`내 일기 ${backup.entries.length}편의 JSON 백업 다운로드를 시작했어요.`);
  } catch (error) {
    if (scope.isCurrent(token)) toast(error?.code === 'diary/export-limit' ? '백업은 최대 10,000편까지 가능합니다. 파일을 만들지 않았습니다. 운영자에게 문의해 주세요.' : publicError(error));
  } finally { if (scope.isCurrent(token)) { exportBusy = false; setAuthControls(); } }
};
$('#mobile-export').onclick = () => $('#export').click();
async function accountAction(kind) {
  if (!adapter || accountBusy) return;
  accountBusy = true; $('#auth-error').hidden = true; setAuthControls();
  try {
    if (kind === 'logout' || kind === 'switch') await adapter.logout();
    if (kind === 'login' || kind === 'switch') await adapter.login();
  } catch (error) { showError('#auth-error', publicError(error)); }
  finally { accountBusy = false; setAuthControls(); }
}
$('#login').onclick = () => void accountAction('login');
$('#logout').onclick = () => void accountAction('logout');
$('#switch-account').onclick = () => void accountAction('switch');
render();
async function start() {
  if (!isConfigured) {
    $('#auth-status').textContent = 'Google 로그인 준비 중';
    $('#auth-description').textContent = '일기장의 Firebase 연결 설정이 아직 준비되지 않았습니다. 설정 전에는 로그인하거나 일기를 저장할 수 없습니다.';
    return;
  }
  try {
    adapter = await initializeDiaryFirebase();
    adapter.observeIdentity(onIdentity, error => {
      scope.switchTo(null); clearPrivateScreen(); setAuthControls(); showError('#auth-error', publicError(error));
    });
    setAuthControls();
  } catch (error) {
    $('#auth-status').textContent = '로그인 연결을 준비하지 못했어요';
    showError('#auth-error', '로그인 연결을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 페이지를 새로고침해 주세요.');
  }
}
void start();
