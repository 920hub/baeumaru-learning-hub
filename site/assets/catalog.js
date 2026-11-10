/** Add a tool here to register it in search, filters, and favorites. Paths are relative to the hub. */
export const categories = [
  { id: 'all', label: '모두 보기' },
  { id: 'language', label: '언어 · 여행' },
  { id: 'reflection', label: '기록 · 생각' },
];

export const catalog = [
  {
    id: 'travel-japanese', title: '일본 여행 첫걸음', category: 'language',
    eyebrow: '작은 연습, 더 넓은 여행', description: '인사부터 도움 요청까지. 여섯 정거장을 지나며 여행에 필요한 한마디를 배워요.',
    href: 'apps/japanese/', cover: 'assets/journey.svg', meta: '6단계 · 24문항', tag: '오늘의 추천',
    keywords: ['일본어', '여행', '인사', '교통', '식당', '쇼핑', '숙소', '도움'],
  },
  {
    id: 'daily-fragments', title: '하루의 조각', category: 'reflection',
    eyebrow: '내 하루를 듣는 시간', description: '오늘의 기분과 소소한 순간을 한 페이지에. Google 로그인으로 나만의 기록을 모아요.',
    href: 'apps/diary/', cover: 'assets/fragments.svg', meta: '나만의 일기 · 로그인 필요', tag: '기록의 습관',
    keywords: ['일기', '기록', '하루', '감정', '회고', '달력'],
  },
];

export function filterCatalog(query = '', category = 'all', favorites = null) {
  const needle = String(query).trim().toLocaleLowerCase('ko');
  return catalog.filter(tool => (category === 'all' || tool.category === category)
    && (!favorites || favorites.includes(tool.id))
    && [tool.title, tool.description, ...tool.keywords].join(' ').toLocaleLowerCase('ko').includes(needle));
}

export function validateFavorites(value) {
  return Array.isArray(value) ? [...new Set(value.filter(id => catalog.some(tool => tool.id === id)))] : [];
}
