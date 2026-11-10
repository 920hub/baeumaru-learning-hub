import { firebaseConfig, firestoreDatabaseId } from './firebase-config.js';
import { createIdentityScope, validateEntry } from './diary-model.js';

export const PAGE_SIZE = 100;
export const DISPLAY_LIMIT = 500;
export const EXPORT_LIMIT = 10000;
export const isConfigured = ['apiKey', 'authDomain', 'projectId', 'appId'].every(key => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].trim());

export async function initializeDiaryFirebase() {
  if (!isConfigured) throw new Error('Firebase 설정이 준비되지 않았습니다. 운영자에게 알려 주세요.');
  const [appSdk, authSdk, storeSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js')
  ]);
  const app = appSdk.initializeApp(firebaseConfig, 'personal-diary');
  const auth = authSdk.initializeAuth(app, {
    persistence: authSdk.browserSessionPersistence,
    popupRedirectResolver: authSdk.browserPopupRedirectResolver
  });
  const db = storeSdk.initializeFirestore(app, { localCache: storeSdk.memoryLocalCache() }, firestoreDatabaseId);
  return createDiaryAdapter({ auth, db, authSdk, storeSdk });
}

// SDK dependencies are injected here so account races can be tested without real records.
export function createDiaryAdapter({ auth, db, authSdk, storeSdk }) {
  const scope = createIdentityScope();
  let notify = () => {};
  const { collection, doc, query, orderBy, documentId, startAfter, limit, getDocsFromServer, getDocFromServer, runTransaction, serverTimestamp, deleteDoc } = storeSdk;
  const check = token => {
    scope.assert(token);
    if (auth.currentUser?.uid !== token.uid) throw new Error('로그인 계정이 변경되었습니다.');
  };
  const entryRef = (token, id) => {
    check(token);
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('잘못된 일기 ID입니다.');
    return doc(db, 'users', token.uid, 'entries', id);
  };
  const decode = snapshot => {
    if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) throw new Error('서버의 저장 확인을 기다리고 있습니다.');
    const data = snapshot.data();
    const fields = validateEntry({ date: data.date, title: data.title, content: data.content, mood: data.mood, favorite: data.favorite });
    if (typeof data.createdAt?.toDate !== 'function' || typeof data.updatedAt?.toDate !== 'function') throw new Error('저장 시각을 확인하지 못했습니다.');
    return { id: snapshot.id, ...fields, createdAt: data.createdAt.toDate().toISOString(), updatedAt: data.updatedAt.toDate().toISOString() };
  };
  async function pageFor(token, cursor = null, pageSize = PAGE_SIZE) {
    check(token);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) throw new Error('잘못된 조회 크기입니다.');
    // Date + document ID makes pagination stable when several entries share a date.
    const clauses = [orderBy('date', 'desc'), orderBy(documentId(), 'desc')];
    if (cursor) clauses.push(startAfter(cursor));
    clauses.push(limit(pageSize));
    const snapshot = await getDocsFromServer(query(collection(db, 'users', token.uid, 'entries'), ...clauses));
    check(token);
    if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) throw new Error('서버에서 일기를 확인하지 못했습니다.');
    return { entries: snapshot.docs.map(decode), cursor: snapshot.docs.at(-1) || cursor, hasMore: snapshot.size === pageSize };
  }
  async function write(id, fields, mustExist) {
    const token = scope.capture();
    const data = validateEntry(fields);
    const ref = entryRef(token, id);
    await runTransaction(db, async transaction => {
      check(token);
      const existing = await transaction.get(ref);
      check(token);
      if (mustExist && !existing.exists()) throw new Error('이 일기는 이미 삭제되었습니다.');
      if (existing.exists()) transaction.update(ref, { ...data, updatedAt: serverTimestamp() });
      else transaction.set(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    check(token);
    // Never report cached or locally pending data as a successful save.
    const saved = await getDocFromServer(ref);
    check(token);
    if (!saved.exists()) throw new Error('서버에서 저장 결과를 확인하지 못했습니다.');
    return decode(saved);
  }
  return {
    observeIdentity(listener, onError) {
      notify = listener;
      return authSdk.onAuthStateChanged(auth, user => {
        scope.switchTo(user?.uid);
        notify(user ? { uid: user.uid } : null);
      }, onError);
    },
    async login() {
      const provider = new authSdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await authSdk.signInWithPopup(auth, provider);
    },
    async logout() {
      scope.switchTo(null);
      notify(null);
      try { await authSdk.signOut(auth); }
      catch (error) {
        scope.switchTo(auth.currentUser?.uid);
        notify(auth.currentUser ? { uid: auth.currentUser.uid } : null);
        throw error;
      }
    },
    listPage(cursor = null, pageSize = PAGE_SIZE) { return pageFor(scope.capture(), cursor, pageSize); },
    async read(id) {
      const token = scope.capture();
      const snapshot = await getDocFromServer(entryRef(token, id));
      check(token);
      return snapshot.exists() ? decode(snapshot) : null;
    },
    create(id, fields) { return write(id, fields, false); },
    update(id, fields) { return write(id, fields, true); },
    async toggleFavorite(id) {
      const token = scope.capture(), ref = entryRef(token, id);
      await runTransaction(db, async transaction => {
        check(token);
        const existing = await transaction.get(ref);
        check(token);
        if (!existing.exists()) throw new Error('이 일기는 이미 삭제되었습니다.');
        // A stale tab must never replace newer diary text while changing a favorite.
        transaction.update(ref, { favorite: !existing.data().favorite, updatedAt: serverTimestamp() });
      });
      check(token);
      const saved = await getDocFromServer(ref);
      check(token);
      if (!saved.exists()) throw new Error('서버에서 저장 결과를 확인하지 못했습니다.');
      return decode(saved);
    },
    async remove(id) {
      const token = scope.capture();
      await deleteDoc(entryRef(token, id));
      check(token);
    },
    async exportAll() {
      const token = scope.capture();
      const byId = new Map();
      let cursor = null;
      for (let page = 0; page <= EXPORT_LIMIT / PAGE_SIZE; page += 1) {
        const result = await pageFor(token, cursor);
        for (const entry of result.entries) byId.set(entry.id, entry);
        if (byId.size > EXPORT_LIMIT) throw Object.assign(new Error('백업 상한 초과'), { code: 'diary/export-limit' });
        if (!result.hasMore) {
          check(token);
          return { format: 'haru-diary-v1', exportedAt: new Date().toISOString(), entries: [...byId.values()] };
        }
        cursor = result.cursor;
      }
      throw Object.assign(new Error('백업 상한 초과'), { code: 'diary/export-limit' });
    }
  };
}
