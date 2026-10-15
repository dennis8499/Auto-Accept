import { randomUUID } from 'node:crypto';
import type { LogOutputChannel, Terminal } from 'vscode';
import type { ApprovalKind } from './approvalPrompt';

type AuditEvent = 'extension.started' | 'extension.stopped' | 'autoAccept.enabled' | 'autoAccept.disabled'
  | 'autoAccept.unavailable' | 'shellIntegration.ready' | 'session.started' | 'session.stopped'
  | 'terminal.closed' | 'approval.sent' | 'approval.skipped' | 'watch.error' | 'diagnostic';

export interface AuditDetails {
  sessionId?: number;
  reason?: string;
  kind?: ApprovalKind;
  content?: string;
  exitCode?: number;
  launcher?: string;
  mode?: string;
}

/** JSON messages in VS Code's native log channel; logging never changes approval state. */
export class AuditLog {
  private readonly runId = randomUUID();
  private readonly terminalIds = new WeakMap<Terminal, number>();
  private nextTerminalId = 1;

  constructor(private readonly output: Pick<LogOutputChannel, 'info' | 'warn' | 'error'>) {}

  write(event: AuditEvent, terminal?: Terminal, details: AuditDetails = {}, level: 'info' | 'warn' | 'error' = 'info'): void {
    try {
      let terminalId: number | undefined;
      if (terminal) {
        terminalId = this.terminalIds.get(terminal);
        if (terminalId === undefined) {
          terminalId = this.nextTerminalId++;
          this.terminalIds.set(terminal, terminalId);
        }
      }
      const record = {
        timestamp: new Date().toISOString(), event, runId: this.runId,
        terminalId, terminalName: terminal?.name, ...details,
      };
      // Escape Unicode line separators too, so content cannot create extra log lines.
      const message = JSON.stringify(record).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      this.output[level](message);
    } catch {
      // A disposed or failing log channel must not retry or block terminal input.
    }
  }
}
