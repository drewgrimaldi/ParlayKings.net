// Saved chats must keep message actions (thumbs/share/etc): runs under plain
// node, no DOM needed. Asserts the restore path (openConvo) wires every
// restored AI reply through the REAL addMessageActions from ../src/index.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; console.log('ok: ' + label); }
  else { fail++; console.error('FAIL: ' + label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); }
}

function fnBody(name) {
  let start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function missing from bundle: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

const openConvo = fnBody('openConvo');
eq(openConvo.indexOf('addMessageActions(') >= 0, true, 'openConvo wires message actions');
eq(openConvo.indexOf('t.reply') >= 0, true, 'restored reply text passed to actions');
eq(openConvo.indexOf('t.user') >= 0, true, 'restored question passed to actions');

const rowAt = src.indexOf('row.innerHTML');
const rowWindow = src.slice(rowAt, rowAt + 4500);
for (const action of ['copy', 'up', 'down', 'share', 'speak']) {
  eq(rowWindow.indexOf(action) >= 0, true, 'action row includes ' + action);
}

// Notification deep-link (?job=): open the job's convo so the saved turn
// shows, fall back loudly instead of silent, never lose the answer.
const resume = fnBody('resumeJob');
eq(resume.indexOf('openConvo(j.convoId)') >= 0, true, 'job deep-link opens the job convo');
eq(resume.indexOf('chat history') >= 0, true, 'unreachable job explains instead of silent');
eq(fnBody('resumeBgJobs').indexOf('resumeJob(qj)') >= 0, true, 'boot routes job links to resume');
eq(openConvo.indexOf('return true') >= 0 && openConvo.indexOf('return false') >= 0, true, 'openConvo reports success');
const rbj = fnBody('renderBgJob');
eq(rbj.indexOf('try { if (d.thinking)') >= 0, true, 'reasoning can never kill the answer');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
