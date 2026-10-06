// tests/questions.test.js
// Automated checks. They run hundreds of random games and verify every answer.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateQuestions, publicQuestion, DIFFICULTIES, QUESTION_COUNTS,
} = require('../game/questions');

// Works out the answer from the question text, completely separately from the
// generator. If the two disagree, a question is broken.
function evaluate(text) {
  const expr = text
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');
  return Function(`"use strict"; return (${expr});`)();
}

test('every answer is correct, whole and not negative', () => {
  for (const difficulty of DIFFICULTIES) {
    for (let round = 0; round < 200; round++) {
      for (const q of generateQuestions(difficulty, 20)) {
        assert.ok(Number.isInteger(q.answer), `${q.text} gave a non-whole answer`);
        assert.ok(q.answer >= 0, `${q.text} gave a negative answer`);
        assert.equal(evaluate(q.text), q.answer, `${q.text} has the wrong answer`);
      }
    }
  }
});

test('returns exactly the number of questions asked for', () => {
  for (const difficulty of DIFFICULTIES) {
    for (const count of QUESTION_COUNTS) {
      assert.equal(generateQuestions(difficulty, count).length, count);
    }
  }
});

test('no question repeats inside one game', () => {
  for (const difficulty of DIFFICULTIES) {
    const texts = generateQuestions(difficulty, 20).map((q) => q.text);
    assert.equal(new Set(texts).size, texts.length);
  }
});

test('questions sent to players never contain the answer', () => {
  const q = generateQuestions('medium', 5)[0];
  assert.deepEqual(Object.keys(publicQuestion(q)).sort(), ['id', 'text']);
});

test('rejects unknown difficulty and unsupported counts', () => {
  assert.throws(() => generateQuestions('impossible', 10));
  assert.throws(() => generateQuestions('easy', 7));
});

test('every question is one direct operation between two whole numbers', () => {
  // This pattern only allows: number, one symbol (+ − × ÷), number.
  const direct = /^\d+ [+−×÷] \d+$/;
  for (const difficulty of DIFFICULTIES) {
    for (let round = 0; round < 100; round++) {
      for (const q of generateQuestions(difficulty, 20)) {
        assert.match(q.text, direct, `"${q.text}" is not a direct question`);
      }
    }
  }
});