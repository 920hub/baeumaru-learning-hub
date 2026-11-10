import { curriculum } from './curriculum.js';
import { emptyProgress, validateProgress, getUnlockedStage, getXP, recordAnswer } from './progress.js';

const KEY = 'baeummaru:japanese:v1';
const $ = selector => document.querySelector(selector);
const stageNames = ['인사와 도움', '교통과 길 찾기', '식당에서', '쇼핑과 결제', '숙소에서', '분실과 도움'];
const shortNames = ['인사', '교통', '식당', '쇼핑', '숙소', '도움'];
let progress = emptyProgress();
let storageAvailable = true;
try {
  const raw = localStorage.getItem(KEY);
  progress = validateProgress(raw ? JSON.parse(raw) : null);
} catch {
  storageAvailable = false;
  $('#save-status').textContent = '저장된 진도를 읽지 못했어요. 지금은 이 화면에서만 연습할 수 있어요.';
}
let stage = getUnlockedStage(progress);
let queue = [];
let questionPosition = 0;
let selected = null;
let answered = false;
let localVoices = [];
const speech = 'speechSynthesis' in window ? window.speechSynthesis : null;

function refreshVoices() {
  try { localVoices = speech ? speech.getVoices().filter(voice => voice.localService === true && /^ja(?:-|$)/i.test(voice.lang)) : []; }
  catch { localVoices = []; }
  for (const button of document.querySelectorAll('.speak')) {
    button.disabled = !localVoices.length;
    button.title = localVoices.length ? '이 기기의 일본어 음성으로 듣기' : '이 기기에 설치된 일본어 음성이 없어요';
  }
  const note = $('#voice-note');
  if (note) note.textContent = localVoices.length
    ? '듣기를 누를 때만 기기에 설치된 일본어 음성으로 읽어요. 읽기는 기기에 따라 다를 수 있어요.'
    : '설치된 일본어 음성이 없어 듣기를 사용할 수 없어요. 읽기와 뜻으로 모든 연습을 계속할 수 있어요.';
}
if (speech) speech.addEventListener('voiceschanged', refreshVoices);
refreshVoices();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
    storageAvailable = true;
    $('#save-status').textContent = '';
  } catch {
    storageAvailable = false;
    $('#save-status').textContent = '진도를 저장하지 못했어요. 현재 연습은 계속되지만 창을 닫으면 이번 진도가 사라질 수 있어요.';
  }
}

function updateJourney() {
  const completed = progress.mastered.filter((values, index) => values.length === curriculum[index].questions.length).length;
  const mastered = getXP(progress) / 10;
  $('#xp').textContent = getXP(progress) + ' XP';
  $('#xp').setAttribute('aria-label', '누적 경험치 ' + getXP(progress) + ' XP');
  $('#summary').textContent = '6개의 정거장 중 ' + completed + '개 완료';
  $('#total-progress').value = mastered;
  $('#total-progress').setAttribute('aria-valuetext', '24문항 중 ' + mastered + '문항 완료');
  $('.local-badge').textContent = storageAvailable ? '이 기기에 저장' : '현재 화면에서 연습 중';
  $('#stage-list').replaceChildren();
  const unlocked = getUnlockedStage(progress);
  for (let index = 0; index < curriculum.length; index++) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const done = progress.mastered[index].length === curriculum[index].questions.length;
    const locked = index > unlocked;
    button.type = 'button';
    button.className = 'stage-button' + (index === stage ? ' current' : '') + (done ? ' completed' : '');
    button.disabled = locked;
    button.setAttribute('aria-label', (index + 1) + '단계 ' + stageNames[index] + (locked ? ', 앞 단계를 완료하면 열려요' : done ? ', 완료, 다시 연습 가능' : ', ' + progress.mastered[index].length + '/4문항 완료'));
    if (index === stage) button.setAttribute('aria-current', 'step');
    button.innerHTML = '<span class="stage-number" aria-hidden="true"></span><span><span class="stage-name"></span><span class="stage-state"></span></span>';
    button.querySelector('.stage-number').textContent = done ? '✓' : locked ? '·' : String(index + 1).padStart(2, '0');
    button.querySelector('.stage-name').textContent = window.matchMedia?.('(max-width:600px)').matches ? shortNames[index] : stageNames[index];
    button.querySelector('.stage-state').textContent = locked ? '아직 열리지 않았어요' : done ? '연습 완료 · 다시 듣기' : progress.mastered[index].length + '/4문항 완료';
    button.addEventListener('click', () => { stage = index; renderPhrases(); focusLesson(); });
    item.append(button); $('#stage-list').append(item);
  }
}

function focusLesson() {
  $('#lesson').focus({ preventScroll: true });
  if (window.matchMedia?.('(max-width:600px)').matches) $('#lesson').scrollIntoView({ block: 'start', behavior: 'instant' });
}

function phraseCard(phrase, canSpeak = true) {
  const card = document.createElement('div'); card.className = 'phrase-card';
  card.innerHTML = '<p class="phrase-ja" lang="ja"></p><p class="phrase-reading"></p><p class="phrase-ko"></p>';
  card.querySelector('.phrase-ja').textContent = phrase.ja;
  card.querySelector('.phrase-reading').textContent = phrase.reading;
  card.querySelector('.phrase-ko').textContent = phrase.ko;
  if (canSpeak) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'speak'; button.textContent = '듣기';
    button.setAttribute('aria-label', phrase.ko + ' 일본어 듣기');
    button.disabled = !localVoices.length;
    button.addEventListener('click', () => {
      refreshVoices();
      if (!localVoices.length || !speech) return;
      try {
        speech.cancel();
        const utterance = new SpeechSynthesisUtterance(phrase.ja);
        utterance.voice = localVoices[0]; utterance.lang = localVoices[0].lang; utterance.rate = 0.85;
        utterance.onerror = () => { const note = $('#voice-note'); if (note) note.textContent = '기기의 음성을 재생하지 못했어요. 읽기와 뜻으로 계속 연습해 주세요.'; };
        speech.speak(utterance);
      } catch { const note = $('#voice-note'); if (note) note.textContent = '음성을 재생할 수 없어요. 텍스트로 계속 연습할 수 있어요.'; }
    });
    card.append(button);
  }
  return card;
}

function renderPhrases() {
  if (speech) speech.cancel();
  updateJourney();
  const item = curriculum[stage];
  const done = progress.mastered[stage].length === item.questions.length;
  $('#lesson').innerHTML = '<div class="lesson-top"><p class="step-label"></p><span class="small-text">먼저 읽어 보기</span></div><h2 id="lesson-title"></h2><p class="lesson-intro">짧은 표현을 눈으로 읽고 뜻을 떠올려 보세요.<br>준비가 되면 네 가지 여행 상황에 도전해요.</p><div class="phrase-list"></div><p class="voice-note" id="voice-note"></p><div class="lesson-actions"><span class="small-text">처음 맞힌 문항마다 +10 XP</span><button class="primary-button" id="start" type="button"></button></div>';
  $('.step-label').textContent = 'STOP ' + String(stage + 1).padStart(2, '0') + ' / 06';
  $('#lesson-title').textContent = stageNames[stage];
  for (const phrase of item.phrases) $('.phrase-list').append(phraseCard(phrase));
  $('#start').textContent = done ? '다시 연습하기 →' : progress.mastered[stage].length ? '이어서 연습하기 →' : '연습 시작하기 →';
  $('#start').addEventListener('click', () => {
    queue = item.questions.map((_, index) => index).filter(index => done || !progress.mastered[stage].includes(index));
    questionPosition = 0;
    renderQuestion(); focusLesson();
  });
  refreshVoices();
}

function findPhrase(ja) {
  return curriculum.flatMap(item => item.phrases).find(phrase => phrase.ja === ja);
}

function renderQuestion() {
  if (speech) speech.cancel();
  selected = null; answered = false;
  const item = curriculum[stage].questions[queue[questionPosition]];
  $('#lesson').innerHTML = '<div class="lesson-top"><p class="step-label"></p><button type="button" class="text-button" id="back-phrases">표현 다시 보기</button></div><div class="question-progress"><progress value="0" max="4" aria-label="이번 연습 진도"></progress><span></span></div><h2 id="lesson-title" class="question-prompt"></h2><div class="options" role="group" aria-labelledby="lesson-title"></div><div id="feedback-region" aria-live="polite" aria-atomic="true"></div><div class="lesson-actions"><span class="small-text">틀려도 괜찮아요. 다시 해 봐요.</span><button class="primary-button" id="check" type="button" disabled>정답 확인</button></div>';
  $('.step-label').textContent = 'STOP ' + String(stage + 1).padStart(2, '0') + ' · 상황 연습';
  $('.question-progress progress').max = queue.length;
  $('.question-progress progress').value = questionPosition;
  $('.question-progress span').textContent = (questionPosition + 1) + ' / ' + queue.length;
  $('#lesson-title').textContent = item.prompt;
  $('#back-phrases').addEventListener('click', () => { renderPhrases(); focusLesson(); });
  item.options.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'option'; button.setAttribute('aria-pressed', 'false');
    button.innerHTML = '<span class="option-index" aria-hidden="true"></span><span lang="ja"></span>';
    button.querySelector('.option-index').textContent = String(index + 1);
    button.querySelector('[lang=ja]').textContent = option;
    button.addEventListener('click', () => {
      if (answered) return;
      selected = index;
      for (const [i, other] of [...document.querySelectorAll('.option')].entries()) {
        other.classList.toggle('selected', index === i); other.setAttribute('aria-pressed', String(index === i));
      }
      $('#check').disabled = false;
    });
    $('.options').append(button);
  });
  $('#check').addEventListener('click', () => checkAnswer(item));
}

function checkAnswer(item) {
  if (selected === null || answered) return;
  answered = true;
  const correct = selected === item.correct;
  const before = getXP(progress);
  progress = recordAnswer(progress, stage, queue[questionPosition], selected);
  if (getXP(progress) > before) persist();
  updateJourney();
  for (const [index, button] of [...document.querySelectorAll('.option')].entries()) {
    button.disabled = true;
    button.classList.toggle('correct', index === item.correct);
    button.classList.toggle('wrong', index === selected && !correct);
  }
  const feedback = document.createElement('div'); feedback.className = 'feedback' + (correct ? ' correct-feedback' : '');
  feedback.innerHTML = '<h3></h3><p></p><div class="answer-detail"></div>';
  feedback.querySelector('h3').textContent = correct ? (getXP(progress) > before ? '맞았어요! +10 XP' : '맞았어요! 잘 기억하고 있네요.') : '한 번 더 연습해 볼까요?';
  feedback.querySelector('p').textContent = item.explanation;
  const phrase = findPhrase(item.options[item.correct]);
  if (phrase) {
    const detail = phraseCard(phrase, false);
    detail.className = '';
    feedback.querySelector('.answer-detail').append(detail);
  } else feedback.querySelector('.answer-detail').textContent = '정답: ' + item.options[item.correct];
  $('#feedback-region').replaceChildren(feedback);
  const next = document.createElement('button'); next.type = 'button'; next.className = 'primary-button'; next.id = 'next';
  next.textContent = correct ? questionPosition + 1 === queue.length ? '연습 마치기 →' : '다음 상황 →' : '다시 도전하기';
  next.addEventListener('click', () => {
    if (!correct) { renderQuestion(); focusLesson(); return; }
    questionPosition++;
    if (questionPosition < queue.length) renderQuestion(); else renderCompletion();
    focusLesson();
  });
  $('#check').replaceWith(next);
  next.focus({ preventScroll: true });
}

function renderCompletion() {
  updateJourney();
  const last = stage === curriculum.length - 1;
  $('#lesson').innerHTML = '<div class="completion"><div class="complete-art" aria-hidden="true">✓</div><p class="step-label"></p><h2 id="lesson-title"></h2><p class="completion-description"></p><div class="completion-xp"></div><div class="lesson-actions"><button class="secondary-button" id="review" type="button">표현 다시 보기</button><a class="primary-button" id="continue"></a></div></div>';
  $('.completion .step-label').textContent = 'STOP ' + String(stage + 1).padStart(2, '0') + ' · COMPLETE';
  $('#lesson-title').textContent = last ? '여섯 번의 연습, 한 걸음 더 가까이.' : stageNames[stage] + ', 연습 완료!';
  $('.completion-description').textContent = last ? '여행에 필요한 24개의 상황을 모두 연습했어요. 필요할 때 언제든 돌아와 다시 읽고 연습해요.' : '이번 정거장의 네 문장을 익혔어요. 다음 여행지에서도 나만의 한마디를 이어 가요.';
  $('.completion-xp').textContent = '지금까지 모은 경험치 ' + getXP(progress) + ' XP';
  $('#review').addEventListener('click', () => { renderPhrases(); focusLesson(); });
  if (last) { $('#continue').href = '../../'; $('#continue').textContent = '배움마루로 돌아가기'; }
  else {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'primary-button'; button.textContent = '다음 정거장으로 →';
    button.addEventListener('click', () => { stage++; renderPhrases(); focusLesson(); });
    $('#continue').replaceWith(button);
  }
}

$('#reset').addEventListener('click', () => $('#reset-dialog').showModal());
$('#cancel-reset').addEventListener('click', () => $('#reset-dialog').close());
$('#confirm-reset').addEventListener('click', () => {
  try { localStorage.removeItem(KEY); }
  catch {
    $('#reset-dialog').close();
    $('#save-status').textContent = '저장된 진도를 지우지 못했어요. 브라우저의 사이트 데이터 설정을 확인해 주세요. 진도는 그대로 유지돼요.';
    return;
  }
  progress = emptyProgress(); storageAvailable = true; stage = 0;
  $('#reset-dialog').close(); renderPhrases(); focusLesson();
  $('#save-status').textContent = '이 브라우저의 학습 진도와 XP를 초기화했어요.';
});
window.addEventListener('pagehide', () => { if (speech) speech.cancel(); });
window.matchMedia?.('(max-width:600px)').addEventListener('change', updateJourney);
renderPhrases();
