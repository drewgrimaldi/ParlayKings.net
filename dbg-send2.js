const fs = require('fs');
const s = fs.readFileSync('src/index.js', 'latin1');
let i = s.indexOf('async function send(fromFlush)');
console.log(JSON.stringify(s.slice(i + 700, i + 1450)));
