const fs = require('fs');
const s = fs.readFileSync('src/index.js', 'latin1');
const i = s.indexOf('const watching = pending > 0');
console.log(JSON.stringify(s.slice(Math.max(0, i - 1200), i + 400)));
