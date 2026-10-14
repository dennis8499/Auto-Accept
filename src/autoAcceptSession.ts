import { ApprovalDetection, ApprovalPrompt, detectApproval } from './approvalPrompt';
import { TerminalScreen } from './terminalScreen';

export interface Scheduler {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}
export type SessionEvent =
  | { type: 'accepted'; kind: ApprovalPrompt['kind'] }
  | { type: 'unsupported' | 'error'; reason: string };
const defaultScheduler: Scheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const CONFIRM_DELAY_MS = 120;
const RESOLVED_DELAY_MS = 180;

export class AutoAcceptSession {
  private readonly screen = new TerminalScreen();
  private armed = false;
  private disposed = false;
  private handled?: string;
  private pending?: { fingerprint: string; handle: unknown };
  private diagnostic?: { key: string; handle: unknown };
  private absence?: unknown;
  private lastDiagnostic?: string;
  private failure?: string;
  private lastFrame = 0;

  constructor(
    private readonly send: () => void,
    private readonly report: (event: SessionEvent) => void = () => {},
    private readonly scheduler: Scheduler = defaultScheduler,
  ) {}

  get blockedReason(): string | undefined { return this.failure; }

  write(chunk: string): void {
    if (this.disposed || this.failure) return;
    // Several completed frames may arrive in one chunk; retain their resolutions.
    this.screen.write(chunk, () => this.evaluate());
    this.evaluate();
  }

  setArmed(armed: boolean): void {
    if (this.disposed) return;
    this.armed = armed;
    if (!armed) {
      this.cancelPending();
      this.cancelDiagnostic();
    }
    this.evaluate();
  }

  dispose(): void {
    this.disposed = true;
    this.armed = false;
    this.cancelPending();
    this.cancelDiagnostic();
    this.cancelAbsence();
  }

  private evaluate(): void {
    if (this.disposed || this.failure) return;
    const snapshot = this.screen.snapshot();
    if (snapshot.issue) {
      this.fail(snapshot.issue);
      return;
    }
    if (!snapshot.complete) return;
    const completedFrame = snapshot.frame !== this.lastFrame;
    this.lastFrame = snapshot.frame;
    const detection = detectApproval(snapshot);
    if (detection.prompt) {
      this.cancelDiagnostic();
      this.lastDiagnostic = undefined;
      this.cancelAbsence();
      const prompt = detection.prompt;
      if (this.pending && this.pending.fingerprint !== prompt.fingerprint) this.cancelPending();
      if (!this.armed || this.handled === prompt.fingerprint || this.pending) return;
      const handle = this.scheduler.set(() => this.confirm(prompt), CONFIRM_DELAY_MS);
      this.pending = { fingerprint: prompt.fingerprint, handle };
    } else {
      this.cancelPending();
      // A blank or partially rebuilt frame cannot resolve an existing approval.
      if (detection.state === 'other' && snapshot.lines.some(line => line.trim())) {
        // Codex's completed synchronized frame is authoritative, even when the
        // next identical approval arrives before the unsynchronized grace period.
        if (completedFrame) {
          this.handled = undefined;
          if (!detection.reason) this.lastDiagnostic = undefined;
        }
        if (this.absence === undefined) this.absence = this.scheduler.set(() => {
          this.absence = undefined;
          const current = this.screen.snapshot();
          const resolved = detectApproval(current);
          if (current.complete && resolved.state === 'other') {
            this.handled = undefined;
            if (!resolved.reason) this.lastDiagnostic = undefined;
          }
        }, RESOLVED_DELAY_MS);
      } else if (detection.state === 'partial') this.cancelAbsence();
      this.reportDiagnostic(detection);
    }
  }

  private reportDiagnostic(detection: ApprovalDetection): void {
    if (!this.armed || !detection.reason) { this.cancelDiagnostic(); return; }
    const key = `${detection.reason}:${detection.fingerprint ?? ''}`;
    if (key === this.lastDiagnostic) { this.cancelDiagnostic(); return; }
    if (this.diagnostic?.key === key) return;
    this.cancelDiagnostic();
    const handle = this.scheduler.set(() => {
      this.diagnostic = undefined;
      if (this.disposed || this.failure || !this.armed) return;
      const snapshot = this.screen.snapshot();
      if (!snapshot.complete) return;
      const current = detectApproval(snapshot);
      if (!current.reason || `${current.reason}:${current.fingerprint ?? ''}` !== key) { this.evaluate(); return; }
      this.lastDiagnostic = key;
      this.report({ type: 'unsupported', reason: current.reason });
    }, CONFIRM_DELAY_MS);
    this.diagnostic = { key, handle };
  }

  private confirm(expected: ApprovalPrompt): void {
    this.pending = undefined;
    if (this.disposed || this.failure || !this.armed || this.handled === expected.fingerprint) return;
    const snapshot = this.screen.snapshot();
    if (!snapshot.complete) return;
    const current = detectApproval(snapshot).prompt;
    if (current?.fingerprint !== expected.fingerprint) { this.evaluate(); return; }
    // Latch before sending; synchronous repaint or send failure must never retry.
    this.handled = expected.fingerprint;
    try {
      this.send();
      this.report({ type: 'accepted', kind: expected.kind });
    } catch (error) {
      this.fail(`送出核准失敗：${String(error)}`);
    }
  }

  private fail(reason: string): void {
    this.failure = reason;
    this.armed = false;
    this.cancelPending();
    this.cancelDiagnostic();
    this.cancelAbsence();
    this.report({ type: 'error', reason });
  }

  private cancelPending(): void {
    if (this.pending) this.scheduler.clear(this.pending.handle);
    this.pending = undefined;
  }

  private cancelAbsence(): void {
    if (this.absence !== undefined) this.scheduler.clear(this.absence);
    this.absence = undefined;
  }

  private cancelDiagnostic(): void {
    if (this.diagnostic) this.scheduler.clear(this.diagnostic.handle);
    this.diagnostic = undefined;
  }
}
