import test from 'node:test';
import assert from 'node:assert/strict';
import { curriculum } from '../site/apps/japanese/curriculum.js';
import { emptyProgress, validateProgress, getUnlockedStage, getXP, recordAnswer } from '../site/apps/japanese/progress.js';
import { catalog, filterCatalog, validateFavorites } from '../site/assets/catalog.js';

test('curriculum has six stages with four valid, explained questions and readable phrases', () => {
  assert.equal(curriculum.length, 6);
  const phrases = curriculum.flatMap(stage => stage.phrases);
  for (const stage of curriculum) {
    assert.equal(stage.questions.length, 4);
    assert.equal(stage.phrases.length, 4);
    for (const phrase of stage.phrases) { assert.ok(phrase.ja); assert.ok(phrase.reading); assert.ok(phrase.ko); }
    for (const question of stage.questions) {
      assert.equal(question.options.length, 4);
      assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < 4);
      assert.ok(question.explanation.length > 10);
      assert.ok(phrases.some(phrase => phrase.ja === question.options[question.correct]));
    }
  }
});

test('malformed progress produces a safe empty state', () => {
  for (const value of [null, undefined, true, 4, 'bad', [], {}, {version:2,mastered:[]}, {version:1,mastered:'bad'}]) {
    assert.deepEqual(validateProgress(value), emptyProgress());
  }
});

test('progress sanitizes types, bounds, duplicate answers, unknown stages, and forged XP', () => {
  const value = {version:1,mastered:[[0,0,1,-1,4,1.5,'2',null],[0,1,2,3],[],[],[],[],[0]],xp:999999};
  const clean = validateProgress(value);
  assert.deepEqual(clean.mastered, [[0,1],[],[],[],[],[]]);
  assert.equal(getXP(clean), 20);
  assert.equal(getUnlockedStage(clean), 0);
  assert.equal(value.mastered[0].length, 8);
});

test('wrong answers do not award XP and locked stages cannot be credited', () => {
  const state = emptyProgress();
  assert.equal(getXP(recordAnswer(state, 0, 0, 1)), 0);
  assert.equal(getXP(recordAnswer(state, 1, 0, curriculum[1].questions[0].correct)), 0);
  for (const args of [[-1,0,0],[6,0,0],[0,-1,0],[0,'0',0],[0,0,'0'],[0,99,0],[NaN,0,0]]) {
    assert.deepEqual(recordAnswer(state,...args), state);
  }
});

test('correct answers award XP once, preserve inputs, and survive JSON reload', () => {
  const initial = emptyProgress();
  const first = recordAnswer(initial, 0, 0, curriculum[0].questions[0].correct);
  assert.equal(getXP(first), 10);
  assert.equal(getXP(initial), 0);
  assert.equal(getXP(recordAnswer(first, 0, 0, curriculum[0].questions[0].correct)), 10);
  assert.deepEqual(validateProgress(JSON.parse(JSON.stringify(first))), first);
});

test('all questions unlock stages sequentially; a full course gives exactly 240 XP', () => {
  let state = emptyProgress();
  for (let stage = 0; stage < 6; stage++) {
    assert.equal(getUnlockedStage(state), stage);
    for (let question = 0; question < 4; question++) state = recordAnswer(state,stage,question,curriculum[stage].questions[question].correct);
    assert.equal(getXP(state), (stage + 1) * 40);
  }
  assert.equal(getUnlockedStage(state), 5);
  assert.equal(getXP(state), 240);
});

test('catalog supports category, query and favorites without exposing unknown IDs', () => {
  assert.equal(filterCatalog('일본어').length, 1);
  assert.equal(filterCatalog('', 'reflection')[0].id, 'daily-fragments');
  assert.equal(filterCatalog('', 'all', []).length, 0);
  assert.deepEqual(validateFavorites(['travel-japanese','travel-japanese','unknown']), ['travel-japanese']);
  assert.deepEqual(validateFavorites({}), []);
  assert.ok(catalog.every(tool => !/^(?:https?:|\/)/.test(tool.href)));
});
