// tests/preview.js
// Prints sample questions so you can see what players will get.
const { generateQuestions, DIFFICULTIES } = require('../game/questions');

for (const difficulty of DIFFICULTIES) {
  console.log(`\n${difficulty.toUpperCase()}`);
  generateQuestions(difficulty, 10).forEach((q, i) => {
    console.log(`${i + 1}. ${q.text} = ${q.answer}`);
  });
}