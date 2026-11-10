import { curriculum } from './curriculum.js';

export function emptyProgress() {
  return { version: 1, mastered: curriculum.map(() => []) };
}

/** Treat persisted progress as untrusted. Ignore forged XP, duplicates, and locked stages. */
export function validateProgress(value) {
  const clean = emptyProgress();
  if (!value || typeof value !== 'object' || value.version !== 1 || !Array.isArray(value.mastered)) return clean;
  for (let stage = 0; stage < curriculum.length; stage++) {
    if (stage > 0 && clean.mastered[stage - 1].length !== curriculum[stage - 1].questions.length) break;
    const values = value.mastered[stage];
    clean.mastered[stage] = Array.isArray(values)
      ? [...new Set(values.filter(index => Number.isInteger(index) && index >= 0 && index < curriculum[stage].questions.length))].sort((a,b) => a-b)
      : [];
  }
  return clean;
}

export function getUnlockedStage(progress) {
  const clean = validateProgress(progress);
  const index = clean.mastered.findIndex((values, stage) => values.length < curriculum[stage].questions.length);
  return index === -1 ? curriculum.length - 1 : index;
}

export function getXP(progress) {
  return validateProgress(progress).mastered.reduce((total, values) => total + values.length * 10, 0);
}

export function recordAnswer(progress, stage, question, answer) {
  const clean = validateProgress(progress);
  if (!Number.isInteger(stage) || stage < 0 || stage > getUnlockedStage(clean)) return clean;
  const item = curriculum[stage]?.questions[question];
  if (!Number.isInteger(question) || !item || !Number.isInteger(answer) || answer !== item.correct) return clean;
  if (!clean.mastered[stage].includes(question)) clean.mastered[stage].push(question);
  return validateProgress(clean);
}
