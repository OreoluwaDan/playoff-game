// game/questions.js
// Builds the maths questions. Only the SERVER uses this file, so players never
// see the answers. We send them just the question text.
//
// Every question is ONE direct operation between TWO numbers: a + b, a − b, a × b or a ÷ b.

const { randomInt } = require('crypto');

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const QUESTION_COUNTS = [5, 10, 15, 20];

// rand(3, 9) gives a whole number from 3 to 9, INCLUDING both ends.
const rand = (min, max) => randomInt(min, max + 1);

// Small helpers so each recipe below stays short and easy to read.
const add = (a, b) => ({ text: `${a} + ${b}`, answer: a + b });
const sub = (a, b) => ({ text: `${a} − ${b}`, answer: a - b }); // callers keep a > b
const mul = (a, b) => ({ text: `${a} × ${b}`, answer: a * b });
// Division is built backwards: we choose the answer (q) first, then multiply to get
// the big number, so the division always comes out whole.
const div = (b, q) => ({ text: `${b * q} ÷ ${b}`, answer: q });

// ---------- EASY: quick, but never trivial ----------
const easy = [
  () => add(rand(11, 49), rand(11, 49)),        // 2-digit + 2-digit (smaller)
  () => {
    const a = rand(30, 99);
    return sub(a, rand(11, a - 10));            // 2-digit − 2-digit
  },
  () => mul(rand(4, 9), rand(6, 9)),            // 1-digit × 1-digit (skips the tiny tables)
];

// ---------- MEDIUM: the middle ground ----------
const medium = [
  () => add(rand(35, 99), rand(35, 99)),        // 2-digit + 2-digit (bigger)
  () => {
    const a = rand(50, 99);
    return sub(a, rand(21, a - 10));            // 2-digit − 2-digit
  },
  () => mul(rand(12, 39), rand(3, 9)),          // 2-digit × 1-digit
  () => div(rand(4, 12), rand(8, 20)),          // for example 156 ÷ 12
];

// ---------- HARD: bigger numbers, still one direct operation ----------
const hard = [
  () => add(rand(120, 899), rand(35, 99)),      // 3-digit + 2-digit
  () => {
    const a = rand(150, 899);
    return sub(a, rand(25, 99));                // 3-digit − 2-digit
  },
  () => mul(rand(11, 25), rand(11, 19)),        // 2-digit × 2-digit
  () => div(rand(11, 25), rand(10, 29)),        // 3-digit ÷ 2-digit, for example 391 ÷ 17
];

const TYPES = { easy, medium, hard };

// Makes the full list of questions for one game, the same list for every player.
function generateQuestions(difficulty, count) {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('Unknown difficulty');
  if (!QUESTION_COUNTS.includes(count)) throw new Error('Unsupported question count');

  const generators = TYPES[difficulty];
  const questions = [];
  const seen = new Set(); // question texts we have used, so none repeat
  let lastIndex = -1;
  let attempts = 0;

  while (questions.length < count && attempts < 1000) {
    attempts++;
    // Avoid two questions of the same kind in a row, so it feels varied.
    const index = randomInt(generators.length);
    if (index === lastIndex) continue;

    const q = generators[index]();
    if (seen.has(q.text)) continue;

    seen.add(q.text);
    lastIndex = index;
    questions.push({ id: questions.length, text: q.text, answer: q.answer });
  }
  return questions;
}

// The version of a question that is safe to send to a browser: NO answer.
function publicQuestion(q) {
  return { id: q.id, text: q.text };
}

module.exports = { generateQuestions, publicQuestion, DIFFICULTIES, QUESTION_COUNTS };