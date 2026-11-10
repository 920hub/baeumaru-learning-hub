import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityScope, validateEntry, mergeEntries, publicError } from '../site/apps/diary/diary-model.js';
import { createDiaryAdapter } from '../site/apps/diary/firebase.js';

const valid = () => ({ date: '2026-11-10', title: 'Synthetic title', content: 'Synthetic diary content', mood: 'calm', favorite: false });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function mockFirebase() {
  const auth = { currentUser: { uid: 'alpha' } };
  const records = new Map(); let observer, readDelay, cached = false, tick = 0;
  const writes = [], reads = [];
  const timestamp = () => { const value = Date.UTC(2026, 10, 10, 0, 0, tick++); return { toDate: () => new Date(value) }; };
  const snap = (id, data) => ({ id, exists: () => !!data, data: () => data, metadata: { fromCache: cached, hasPendingWrites: false } });
  const storeSdk = {
    collection: (_db, ...parts) => parts.join('/'), doc: (_db, ...parts) => parts.join('/'),
    orderBy: (...args) => ({ order: args }), documentId: () => '__name__', startAfter: cursor => ({ after: cursor.id }), limit: size => ({ size }),
    query: (path, ...clauses) => ({ path, clauses }),
    async getDocsFromServer(query) {
      reads.push(query.path);
      const docs = [...records].filter(([path]) => path.startsWith(`${query.path}/`)).map(([path, data]) => snap(path.split('/').at(-1), data)).sort((a, b) => b.data().date.localeCompare(a.data().date) || b.id.localeCompare(a.id));
      const cursor = query.clauses.find(clause => clause.after)?.after;
      const start = cursor ? docs.findIndex(doc => doc.id === cursor) + 1 : 0;
      const result = docs.slice(start, start + query.clauses.find(clause => clause.size)?.size);
      if (readDelay) await readDelay.promise;
      return { docs: result, size: result.length, metadata: { fromCache: cached, hasPendingWrites: false } };
    },
    async getDocFromServer(path) { reads.push(path); return snap(path.split('/').at(-1), records.get(path)); },
    serverTimestamp: timestamp,
    async runTransaction(_db, update) {
      const pending = [];
      await update({ get: async path => snap(path.split('/').at(-1), records.get(path)), set: (path, fields) => pending.push({ path, fields, create: true }), update: (path, fields) => pending.push({ path, fields }) });
      for (const write of pending) { writes.push(write); records.set(write.path, { ...records.get(write.path), ...write.fields }); }
    },
    async deleteDoc(path) { records.delete(path); }
  };
  class GoogleAuthProvider { setCustomParameters(value) { this.parameters = value; } }
  const authSdk = {
    GoogleAuthProvider,
    onAuthStateChanged(_auth, listener) { observer = listener; listener(auth.currentUser); return () => {}; },
    async signOut() { auth.currentUser = null; observer(null); },
    async signInWithPopup(_auth, provider) { assert.deepEqual(provider.parameters, { prompt: 'select_account' }); }
  };
  const adapter = createDiaryAdapter({ auth, db: {}, authSdk, storeSdk });
  adapter.observeIdentity(() => {});
  return {
    adapter, records, writes, reads,
    seed(uid, id, fields = valid()) { records.set(`users/${uid}/entries/${id}`, { ...fields, createdAt: timestamp(), updatedAt: timestamp() }); },
    switchTo(uid) { auth.currentUser = uid ? { uid } : null; observer(auth.currentUser); },
    delayRead(value) { readDelay = value; },
    setCached(value) { cached = value; }
  };
}

test('payload validation rejects malformed, excessive, and ownership-spoofing fields', () => {
  assert.deepEqual(validateEntry(valid()), valid());
  for (const invalid of [null, [], { ...valid(), date: '2026-02-30' }, { ...valid(), date: '0000-01-01' }, { ...valid(), title: ' ' }, { ...valid(), title: 'a'.repeat(121) }, { ...valid(), content: 'a'.repeat(100001) }, { ...valid(), mood: '__proto__' }, { ...valid(), mood: 'toString' }, { ...valid(), mood: ['happy'] }, { ...valid(), favorite: 'true' }, { ...valid(), ownerId: 'other' }, { ...valid(), createdAt: 'spoof' }]) assert.throws(() => validateEntry(invalid));
});

test('identity transitions clear drafts and invalidate prior promises, even after same-account re-login', () => {
  const scope = createIdentityScope(); scope.switchTo('alpha');
  const old = scope.capture(); scope.setDraft('new', { content: 'Only alpha may read this' });
  scope.switchTo('beta'); assert.equal(scope.getDraft('new'), undefined); assert.equal(scope.isCurrent(old), false);
  scope.switchTo('alpha'); assert.equal(scope.isCurrent(old), false);
  scope.switchTo(null); assert.throws(() => scope.capture());
});

test('all reads use current UID and late results from a former account are rejected', async () => {
  const fake = mockFirebase(); fake.seed('alpha', 'a'); fake.seed('beta', 'b');
  const waiting = deferred(); fake.delayRead(waiting);
  const oldList = fake.adapter.listPage(); fake.switchTo('beta'); waiting.resolve();
  await assert.rejects(oldList, /변경/);
  fake.delayRead(null); const result = await fake.adapter.listPage();
  assert.deepEqual(result.entries.map(entry => entry.id), ['b']);
  assert.deepEqual(fake.reads, ['users/alpha/entries', 'users/beta/entries']);
});

test('logged-out CRUD and export are refused before any Firestore operation', async () => {
  const fake = mockFirebase(); fake.switchTo(null);
  assert.throws(() => fake.adapter.listPage());
  await assert.rejects(fake.adapter.read('a'));
  await assert.rejects(fake.adapter.create('a', valid()));
  await assert.rejects(fake.adapter.update('a', valid()));
  await assert.rejects(fake.adapter.remove('a'));
  await assert.rejects(fake.adapter.exportAll());
  assert.equal(fake.reads.length, 0); assert.equal(fake.writes.length, 0);
});

test('retrying a creation ID keeps one document and preserves its server creation time', async () => {
  const fake = mockFirebase();
  const first = await fake.adapter.create('stable-uuid', valid());
  const second = await fake.adapter.create('stable-uuid', { ...valid(), title: 'Retry same operation' });
  assert.equal(fake.records.size, 1); assert.equal(first.createdAt, second.createdAt);
  assert.equal(second.title, 'Retry same operation');
  assert.equal(Object.hasOwn(fake.writes[1].fields, 'createdAt'), false);
  assert.equal(Object.hasOwn(fake.writes[0].fields, 'ownerId'), false);
});

test('editing a deleted document never silently recreates it', async () => {
  const fake = mockFirebase();
  await assert.rejects(fake.adapter.update('missing', valid()), /삭제/);
  assert.equal(fake.writes.length, 0);
});

test('favorite toggle preserves a newer server edit and toggles the latest favorite value', async () => {
  const fake = mockFirebase(); fake.seed('alpha', 'a');
  await fake.adapter.listPage(); // The open tab has the original, stale listing.
  const latest = { ...valid(), title: 'New title from another tab', content: 'New content from another tab', favorite: true };
  await fake.adapter.update('a', latest);
  const before = fake.records.get('users/alpha/entries/a');
  const result = await fake.adapter.toggleFavorite('a');
  assert.equal(result.title, latest.title); assert.equal(result.content, latest.content);
  assert.equal(result.favorite, false); assert.equal(result.createdAt, before.createdAt.toDate().toISOString());
  assert.deepEqual(Object.keys(fake.writes.at(-1).fields).sort(), ['favorite', 'updatedAt']);
  await assert.rejects(fake.adapter.toggleFavorite('missing'), /삭제/);
  fake.switchTo(null); await assert.rejects(fake.adapter.toggleFavorite('a'));
});

test('cached or pending data is never announced as server-confirmed saved content', async () => {
  const fake = mockFirebase(); fake.seed('alpha', 'a'); fake.setCached(true);
  await assert.rejects(fake.adapter.listPage());
  await assert.rejects(fake.adapter.read('a'));
  await assert.rejects(fake.adapter.create('a', valid()));
});

test('cursor pages and export remain UID isolated and do not duplicate equal-date records', async () => {
  const fake = mockFirebase();
  for (let n = 0; n < 135; n++) fake.seed('alpha', `entry-${String(n).padStart(3, '0')}`);
  fake.seed('beta', 'private-beta');
  const first = await fake.adapter.listPage(), next = await fake.adapter.listPage(first.cursor);
  assert.equal(first.entries.length, 100); assert.equal(first.hasMore, true);
  assert.equal(next.entries.length, 35); assert.equal(next.hasMore, false);
  assert.equal(mergeEntries(first.entries, [...first.entries.slice(0, 2), ...next.entries]).length, 135);
  const backup = await fake.adapter.exportAll();
  assert.equal(backup.entries.length, 135); assert.equal(backup.entries.some(entry => entry.id === 'private-beta'), false);
  assert.equal('uid' in backup, false);
});

test('SDK error output is mapped without exposing original messages or account details', () => {
  assert.match(publicError({ code: 'auth/popup-blocked', message: 'sensitive@example.invalid' }), /팝업/);
  assert.equal(publicError({ message: 'sensitive@example.invalid' }).includes('@'), false);
});
