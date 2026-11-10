export const MOODS = Object.freeze({ happy: ['😊', '행복해요'], calm: ['🌿', '평온해요'], neutral: ['🙂', '그저 그래요'], sad: ['🌧️', '슬퍼요'], tired: ['🌙', '지쳤어요'] });
const FIELDS = ['date', 'title', 'content', 'mood', 'favorite'];

export function validateEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !FIELDS.includes(key))) throw new Error('일기 형식을 확인해 주세요.');
  if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || value.date.slice(0, 4) === '0000' || Number.isNaN(Date.parse(`${value.date}T12:00:00Z`)) || new Date(`${value.date}T12:00:00Z`).toISOString().slice(0, 10) !== value.date) throw new Error('올바른 날짜를 선택해 주세요.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) throw new Error('제목은 1~120자로 입력해 주세요.');
  if (typeof value.content !== 'string' || !value.content.trim() || value.content.length > 100000) throw new Error('내용은 1~100,000자로 입력해 주세요.');
  if (typeof value.mood !== 'string' || !Object.hasOwn(MOODS, value.mood) || typeof value.favorite !== 'boolean') throw new Error('기분과 즐겨찾기 설정을 확인해 주세요.');
  return { date: value.date, title: value.title, content: value.content, mood: value.mood, favorite: value.favorite };
}

export function entryFields(entry) {
  return Object.fromEntries(FIELDS.map(key => [key, entry[key]]));
}

// Every identity transition invalidates in-flight reads/writes and every draft.
export function createIdentityScope() {
  let uid = null, generation = 0;
  const drafts = new Map();
  return {
    switchTo(nextUid) { uid = nextUid || null; generation += 1; drafts.clear(); },
    get uid() { return uid; },
    capture() {
      if (!uid) throw new Error('Google 로그인 후 이용해 주세요.');
      return Object.freeze({ uid, generation });
    },
    isCurrent(token) { return !!token && !!uid && token.uid === uid && token.generation === generation; },
    assert(token) { if (!this.isCurrent(token)) throw new Error('로그인 계정이 변경되었습니다. 다시 시도해 주세요.'); },
    getDraft(key) { return uid ? drafts.get(key) : undefined; },
    setDraft(key, value) { if (uid) drafts.set(key, structuredClone(value)); },
    removeDraft(key) { drafts.delete(key); }
  };
}

export function mergeEntries(current, incoming) {
  const byId = new Map(current.map(entry => [entry.id, entry]));
  for (const entry of incoming) byId.set(entry.id, entry);
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export function publicError(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'auth/popup-blocked') return '로그인 팝업이 차단되었습니다. 이 사이트의 팝업을 허용하고 다시 눌러 주세요.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '로그인 창이 닫혔습니다. 준비되면 다시 로그인해 주세요.';
  if (code === 'auth/unauthorized-domain') return '이 주소의 Google 로그인이 아직 설정되지 않았습니다. 운영자에게 알려 주세요.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') return 'Google 로그인이 아직 준비되지 않았습니다. 운영자에게 알려 주세요.';
  if (code.includes('permission-denied') || code.includes('unauthenticated')) return '접근 권한을 확인하지 못했습니다. 다시 로그인해 주세요.';
  if (code.includes('unavailable') || code.includes('network-request-failed') || code.includes('deadline-exceeded')) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
  return '요청을 완료하지 못했습니다. 입력 내용은 그대로 두었으니 잠시 후 다시 시도해 주세요.';
}
