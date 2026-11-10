import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import * as model from '../site/apps/diary/diary-model.js';
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { ({ JSDOM } = await import('../../.tooling/node_modules/jsdom/lib/api.js')); }

const directory = new URL('../site/apps/diary/', import.meta.url);
const html = await readFile(new URL('index.html', directory), 'utf8');
const source = (await readFile(new URL('app.js', directory), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace('void start();', 'globalThis.startDiaryForTest = start;');
const flush = async () => { await setImmediate(); await setImmediate(); };
const entry = (id, title = 'Synthetic entry') => ({ id, date: '2026-11-10', title, content: 'Synthetic content', mood: 'calm', favorite: false, createdAt: '2026-11-10T01:00:00.000Z', updatedAt: '2026-11-10T01:00:00.000Z' });

async function setup({ configured = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://example.invalid/hub/apps/diary/', runScripts: 'outside-only' });
  const { window } = dom; const document = window.document;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  window.confirm = () => true;
  let listener, uid = null, listResult = async () => ({ entries: [], cursor: null, hasMore: false });
  let createResult = async (id, fields) => ({ ...entry(id), ...fields }); const creates = [], favoriteCalls = [];
  const fake = {
    observeIdentity(callback) { listener = callback; callback(null); return () => {}; },
    async login() { uid = 'alpha'; listener({ uid }); },
    async logout() { uid = null; listener(null); },
    listPage(...args) { return listResult(uid, ...args); },
    create(id, fields) { creates.push({ id, fields }); return createResult(id, fields); },
    async update(id, fields) { return { ...entry(id), ...fields }; },
    async toggleFavorite(...args) { favoriteCalls.push(args); return { ...entry(args[0]), favorite: true }; },
    async remove() {}, async exportAll() { return { entries: [] }; }
  };
  Object.assign(window, {
    moods: model.MOODS, validateEntry: model.validateEntry, entryFields: model.entryFields,
    createIdentityScope: model.createIdentityScope, mergeEntries: model.mergeEntries, publicError: model.publicError,
    initializeDiaryFirebase: async () => fake, isConfigured: configured, DISPLAY_LIMIT: 500, PAGE_SIZE: 100
  });
  window.eval(source); await window.startDiaryForTest(); await flush();
  return {
    window, document, creates, favoriteCalls, close: () => window.close(),
    identity(next) { uid = next; listener(next ? { uid: next } : null); },
    list(fn) { listResult = fn; }, create(fn) { createResult = fn; },
    input(id, value) { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); },
    submit() { document.getElementById('entry-form').dispatchEvent(new window.Event('submit', { cancelable: true })); }
  };
}

test('unconfigured page clearly blocks login and writing without local success fallback', async () => {
  const ui = await setup({ configured: false });
  try {
    assert.equal(ui.document.getElementById('login').disabled, true);
    assert.equal(ui.document.getElementById('new-entry').disabled, true);
    assert.match(ui.document.getElementById('auth-description').textContent, /아직 준비/);
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 0);
  } finally { ui.close(); }
});

test('late account-A list cannot populate account-B screen, and open content/drafts clear on transition', async () => {
  const ui = await setup();
  try {
    let finishA;
    ui.list(uid => uid === 'alpha' ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve({ entries: [entry('b', 'Only beta')], cursor: null, hasMore: false }));
    ui.identity('alpha');
    ui.document.getElementById('new-entry').click(); ui.input('entry-title', 'Alpha unsaved'); ui.input('entry-content', 'Private synthetic draft');
    assert.equal(ui.document.getElementById('editor').open, true);
    ui.identity('beta'); await flush();
    finishA({ entries: [entry('a', 'Only alpha')], cursor: null, hasMore: false }); await flush();
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 1);
    assert.match(ui.document.getElementById('entries').textContent, /Only beta/);
    assert.doesNotMatch(ui.document.body.textContent, /Only alpha|Alpha unsaved|Private synthetic draft/);
    assert.equal(ui.document.getElementById('entry-content').value, '');
    assert.equal(ui.document.getElementById('editor').open, false);
    ui.document.getElementById('entries').querySelector('button').click();
    assert.equal(ui.document.getElementById('reader-content').textContent, 'Synthetic content');
    ui.identity(null);
    assert.equal(ui.document.getElementById('reader-content').textContent, '');
    assert.equal(ui.document.getElementById('reader').open, false);
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 0);
  } finally { ui.close(); }
});

test('failed save keeps the editor and retries the same UUID, then confirms server success', async () => {
  const ui = await setup();
  try {
    ui.identity('alpha'); await flush(); ui.document.getElementById('new-entry').click();
    ui.input('entry-title', 'Synthetic retry'); ui.input('entry-content', 'Keep this failed-save content');
    ui.create(async () => { throw { code: 'unavailable', message: 'Do not expose SDK details' }; });
    ui.submit(); await flush();
    assert.equal(ui.document.getElementById('editor').open, true);
    assert.equal(ui.document.getElementById('entry-content').value, 'Keep this failed-save content');
    assert.equal(ui.document.getElementById('form-error').hidden, false);
    assert.equal(ui.document.getElementById('toast').hidden, true);
    ui.create(async (id, fields) => ({ ...entry(id), ...fields }));
    ui.submit(); await flush();
    assert.equal(ui.creates.length, 2); assert.equal(ui.creates[0].id, ui.creates[1].id);
    assert.equal(ui.document.getElementById('editor').open, false);
    assert.match(ui.document.getElementById('toast').textContent, /Firebase에서 저장을 확인/);
  } finally { ui.close(); }
});

test('a save result arriving after logout never repopulates diary content or success toast', async () => {
  const ui = await setup();
  try {
    ui.identity('alpha'); await flush(); ui.document.getElementById('new-entry').click();
    ui.input('entry-title', 'Late old save'); ui.input('entry-content', 'Synthetic pending content');
    let finishSave;
    ui.create((id, fields) => new Promise(resolve => { finishSave = () => resolve({ ...entry(id), ...fields }); }));
    ui.submit(); ui.identity(null); finishSave(); await flush();
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 0);
    assert.equal(ui.document.getElementById('entry-content').value, '');
    assert.equal(ui.document.getElementById('toast').hidden, true);
    assert.equal(ui.document.getElementById('new-entry').disabled, true);
  } finally { ui.close(); }
});

test('search, mood, favorites and date filter render text safely', async () => {
  const ui = await setup();
  try {
    ui.list(async () => ({ entries: [entry('a', '<img src=x onerror=alert(1)>'), { ...entry('b', 'Favorite happy'), favorite: true, mood: 'happy', date: '2026-11-09' }], cursor: null, hasMore: false }));
    ui.identity('alpha'); await flush();
    assert.equal(ui.document.getElementById('entries').querySelector('img'), null);
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 2);
    ui.document.querySelector('[data-view="favorite"]').click(); assert.equal(ui.document.querySelectorAll('.entry-card').length, 1);
    ui.document.querySelector('[data-view="all"]').click();
    ui.input('search', 'Favorite'); assert.equal(ui.document.querySelectorAll('.entry-card').length, 1);
    ui.input('search', '');
    const mood = ui.document.getElementById('mood-filter'); mood.value = 'calm'; mood.dispatchEvent(new ui.window.Event('change'));
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 1);
    mood.value = ''; mood.dispatchEvent(new ui.window.Event('change'));
    const date = ui.document.getElementById('mobile-date'); date.value = '2026-11-09'; date.dispatchEvent(new ui.window.Event('change'));
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 1); assert.match(ui.document.getElementById('entries').textContent, /Favorite happy/);
  } finally { ui.close(); }
});

test('a query begun before deletion cannot resurrect the deleted entry', async () => {
  const ui = await setup();
  try {
    ui.list(async () => ({ entries: [entry('a', 'Entry to remove')], cursor: null, hasMore: false }));
    ui.identity('alpha'); await flush(); ui.document.querySelector('.entry-card').click();
    let finishQuery, calls = 0;
    ui.list(() => ++calls === 1 ? new Promise(resolve => { finishQuery = resolve; }) : Promise.resolve({ entries: [], cursor: null, hasMore: false }));
    ui.document.getElementById('reload').click();
    ui.document.getElementById('delete-entry').click(); await flush();
    finishQuery({ entries: [entry('a', 'Entry to remove')], cursor: null, hasMore: false }); await flush();
    assert.equal(ui.document.querySelectorAll('.entry-card').length, 0);
    assert.equal(calls, 2);
  } finally { ui.close(); }
});

test('favorite action sends only the entry ID and renders the server result', async () => {
  const ui = await setup();
  try {
    ui.list(async () => ({ entries: [entry('a', 'Stale title')], cursor: null, hasMore: false }));
    ui.identity('alpha'); await flush(); ui.document.querySelector('.entry-card').click();
    ui.document.getElementById('reader-favorite').click(); await flush();
    assert.deepEqual(ui.favoriteCalls, [['a']]);
    assert.equal(ui.document.getElementById('reader-title').textContent, 'Synthetic entry');
    assert.match(ui.document.getElementById('reader-favorite').textContent, /♥/);
  } finally { ui.close(); }
});
