const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoAcceptSession } = require('../out/autoAcceptSession');
const { ESC, approval, frame, session, Clock } = require('./helpers.cjs');

test('OFF never sends; arming later accepts an already waiting card', () => {
  const { value, clock, sends } = session();
  value.write(frame(approval()));
  clock.advance(1000);
  assert.equal(sends.length, 0);
  value.setArmed(true);
  clock.advance(119);
  assert.equal(sends.length, 0);
  clock.advance(1);
  assert.equal(sends.length, 1);
});
test('repeated repaints never send a second y even after the old debounce period', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(120);
  for (let index = 0; index < 10; index++) {
    value.write(frame(approval()));
    clock.advance(3000);
  }
  assert.equal(sends.length, 1);
});

test('command title spacing changes preserve pending confirmation, deduplication and later approvals', () => {
  const variants = ['command?', 'command ?', 'command   ?', 'command\r\n  ?'];
  for (const initial of variants) {
    const { value, clock, sends, events } = session();
    const card = title => frame(approval().replace('command?', title));
    value.setArmed(true);
    value.write(card(initial));
    clock.advance(60);
    value.write(card('command\r\n  ?'));
    clock.advance(59);
    assert.equal(sends.length, 0);
    clock.advance(1);
    assert.deepEqual(sends, [{ at: 120 }]);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'accepted');
    assert.ok(events[0].content.startsWith('  Would you like to run the following command\n  ?'));

    for (const title of variants) {
      value.write(card(title));
      clock.advance(200);
    }
    assert.equal(sends.length, 1);
    assert.equal(events.length, 1);

    value.write(frame('Working...'));
    clock.advance(180);
    value.write(card('command ?'));
    clock.advance(120);
    assert.equal(sends.length, 2);
    assert.equal(events.length, 2);
    assert.ok(events[1].content.startsWith('  Would you like to run the following command ?'));
  }
});

test('blank and partial redraws do not reset the approval latch', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval(), false));
  clock.advance(120);
  value.write(ESC + '[2J' + ESC + '[H');
  clock.advance(500);
  value.write(approval().split('›')[0]);
  clock.advance(500);
  value.write('›' + approval().split('›')[1]);
  clock.advance(500);
  assert.equal(sends.length, 1);
});
test('identical content in a later resolved request is accepted again', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(120);
  value.write(frame('Working...'));
  clock.advance(180);
  value.write(frame(approval()));
  clock.advance(120);
  assert.equal(sends.length, 2);
});
test('a different next request is not lost within two seconds', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval('command', 'echo first')));
  clock.advance(120);
  value.write(frame(approval('command', 'echo second')));
  clock.advance(120);
  assert.equal(sends.length, 2);
});
test('a completed frame resolves an approval before an immediately identical next request', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(120);
  value.write(frame('You approved this command'));
  clock.advance(1);
  value.write(frame(approval()));
  clock.advance(120);
  assert.equal(sends.length, 2);
});
test('coalesced terminal output preserves resolution before an identical next approval', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(120);
  value.write(frame('Working...') + frame(approval()));
  clock.advance(120);
  assert.equal(sends.length, 2);
});
test('an authoritative resolution also closes a pending raw-output grace period', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(120);
  value.write(frame('Working...', false));
  clock.advance(1);
  value.write(frame('You approved this command'));
  value.write(frame(approval()));
  clock.advance(120);
  assert.equal(sends.length, 2);
});
test('disarming cancels scheduled input without losing a waiting card', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  value.setArmed(false);
  clock.advance(1000);
  assert.equal(sends.length, 0);
  value.setArmed(true);
  clock.advance(120);
  assert.equal(sends.length, 1);
  value.setArmed(false);
  value.setArmed(true);
  clock.advance(1000);
  assert.equal(sends.length, 1);
});
test('disposing a terminal or execution cancels input', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  value.dispose();
  clock.advance(1000);
  value.setArmed(true);
  value.write(frame(approval()));
  assert.equal(sends.length, 0);
  assert.equal(clock.tasks.size, 0);
});
test('prompt replacement before confirmation does not send stale input', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(60);
  value.write(frame('Question 1/1\r\n› 1. An option\r\nenter to submit answer'));
  clock.advance(1000);
  assert.equal(sends.length, 0);
});
test('an unfinished synchronized frame cannot receive input', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame(approval()));
  value.write(ESC + '[?2026h');
  clock.advance(120);
  assert.equal(sends.length, 0);
  value.write(ESC + '[?2026l');
  clock.advance(120);
  assert.equal(sends.length, 1);
});
test('animations outside the approval card do not starve pending confirmation', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  value.write(frame('spinner\r\n' + approval()));
  for (let index = 0; index < 5; index++) {
    clock.advance(30);
    value.write(ESC + '[1;1H' + ESC + '[2K' + 'spinner ' + index);
  }
  assert.equal(sends.length, 1);
});
test('a failed send blocks retries', () => {
  const { value, clock, sends, events } = session({ throwOnSend: true });
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(120);
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(1000);
  assert.equal(sends.length, 0);
  assert.ok(value.blockedReason);
  assert.equal(events.filter(event => event.type === 'error').length, 1);
  assert.equal(events.filter(event => event.type === 'accepted').length, 0);
  assert.equal(events[0].kind, 'command');
  assert.ok(events[0].content.includes('$ echo hello'));
});

test('accepted content comes from the confirmed snapshot even if formatting changes while pending', () => {
  const { value, clock, sends, events } = session();
  value.setArmed(true);
  value.write(frame(approval('command', 'echo hello')));
  clock.advance(60);
  value.write(frame(approval('command', 'echo  hello')));
  clock.advance(60);
  assert.equal(sends.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'accepted');
  assert.ok(events[0].content.includes('$ echo  hello'));
});

test('a stale sender that declines input cannot produce an accepted event', () => {
  const clock = new Clock();
  const events = [];
  let attempts = 0;
  const value = new AutoAcceptSession(() => { attempts++; return false; }, event => events.push(event), clock.scheduler);
  value.setArmed(true);
  value.write(frame(approval()));
  clock.advance(120);
  value.write(frame(approval()));
  clock.advance(1000);
  assert.equal(attempts, 1);
  assert.equal(events.length, 0);
});
test('independent terminals retain independent arming state', () => {
  const a = session();
  const b = session();
  a.value.setArmed(true);
  a.value.write(frame(approval()));
  b.value.write(frame(approval()));
  a.clock.advance(500);
  b.clock.advance(500);
  assert.equal(a.sends.length, 1);
  assert.equal(b.sends.length, 0);
});

test('command, program and Git approvals with question-like descriptions each send once', () => {
  const { value, clock, sends } = session();
  value.setArmed(true);
  for (const command of ['Write-Output "needs your approval"', 'node -e "console.log(\'```\')"', 'git commit -m "Question 1/1"']) {
    const prompt = frame(approval('command', command));
    value.write(prompt);
    clock.advance(120);
    value.write(prompt);
    clock.advance(1000);
    value.write(frame('Working...'));
    clock.advance(180);
  }
  assert.equal(sends.length, 3);
});

test('diagnostics are stable, deduplicated per card and repeat for a later request', () => {
  const { value, clock, events } = session();
  value.setArmed(true);
  const unsupported = action => frame(approval('command', action).replace('proceed (y)', 'proceed (q)'));
  value.write(unsupported('git status'));
  clock.advance(119);
  assert.equal(events.length, 0);
  clock.advance(1);
  for (let index = 0; index < 5; index++) {
    value.write(unsupported('git status'));
    clock.advance(200);
  }
  assert.equal(events.filter(event => event.type === 'unsupported').length, 1);
  value.write(unsupported('node --version'));
  clock.advance(120);
  assert.equal(events.filter(event => event.type === 'unsupported').length, 2);
  value.write(frame('Working...'));
  clock.advance(180);
  value.write(unsupported('git status'));
  clock.advance(120);
  assert.equal(events.filter(event => event.type === 'unsupported').length, 3);
});

test('a partial repaint that becomes a supported card does not report a stale diagnostic', () => {
  const { value, clock, events, sends } = session();
  value.setArmed(true);
  value.write(frame('Would you like to run the following command?'));
  clock.advance(60);
  value.write(frame(approval()));
  clock.advance(120);
  assert.equal(sends.length, 1);
  assert.equal(events.filter(event => event.type === 'unsupported').length, 0);
});

test('disarming and disposal cancel pending diagnostics', () => {
  for (const stop of ['disarm', 'dispose']) {
    const { value, clock, events } = session();
    value.setArmed(true);
    value.write(frame('Would you like to run the following command?'));
    if (stop === 'disarm') value.setArmed(false);
    else value.dispose();
    clock.advance(1000);
    assert.equal(events.length, 0);
    assert.equal(clock.tasks.size, 0);
  }
});
