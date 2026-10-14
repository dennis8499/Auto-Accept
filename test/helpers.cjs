const { AutoAcceptSession } = require('../out/autoAcceptSession');
const { TerminalScreen } = require('../out/terminalScreen');
const { detectApproval } = require('../out/approvalPrompt');

const ESC = '\x1b';
const FOOTER = '  Press enter to confirm or esc to cancel';
function approval(kind = 'command', action = 'echo hello', extra = '') {
  const headers = {
    command: 'Would you like to run the following command?',
    edit: 'Would you like to make the following edits?',
    network: 'Do you want to approve network access to "example.com"?',
    input: 'Would you like to send input to terminal 123?',
    permissions: 'Would you like to grant these permissions?',
  };
  const labels = {
    command: 'Yes, proceed (y)', edit: 'Yes, proceed (y)', input: 'Yes, proceed (y)',
    network: 'Yes, just this once (y)', permissions: 'Yes, grant these permissions for this turn (y)',
  };
  return [
    '', '  ' + headers[kind], '', '  Reason: requested operation', '',
    '  ' + (kind === 'edit' ? 'Destination: README.md' : kind === 'permissions' ? 'Permission rule: read README.md' : '$ ' + action),
    extra, '', '› 1. ' + labels[kind],
    '  2. Yes, and do not ask again for this session (a)',
    '  3. ' + (kind === 'permissions' ? 'No, continue without permissions (d)' : 'No, and tell Codex what to do differently (esc)'),
    '', FOOTER, '',
  ].join('\r\n');
}
function frame(text, synchronized = true) {
  return (synchronized ? ESC + '[?2026h' : '') + ESC + '[2J' + ESC + '[H' + text +
    (synchronized ? ESC + '[?2026l' : '');
}
function detect(text) {
  const screen = new TerminalScreen();
  screen.write(text);
  return detectApproval(screen.snapshot());
}
class Clock {
  now = 0;
  id = 0;
  tasks = new Map();
  scheduler = {
    set: (callback, delay) => {
      const id = ++this.id;
      this.tasks.set(id, { callback, at: this.now + delay });
      return id;
    },
    clear: id => this.tasks.delete(id),
  };
  advance(amount) {
    const end = this.now + amount;
    for (let guard = 0; guard < 1000; guard++) {
      const next = [...this.tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { this.now = end; return; }
      this.now = next[1].at;
      this.tasks.delete(next[0]);
      next[1].callback();
    }
    throw new Error('Timer loop');
  }
}
function session(options = {}) {
  const clock = new Clock();
  const sends = [];
  const events = [];
  const value = new AutoAcceptSession(() => {
    if (options.throwOnSend) throw new Error('terminal closed');
    sends.push({ at: clock.now });
  }, event => events.push(event), clock.scheduler);
  return { value, clock, sends, events };
}
module.exports = { ESC, FOOTER, approval, frame, detect, Clock, session };
