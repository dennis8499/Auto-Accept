import * as vscode from 'vscode';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { AutoAcceptSession } from './autoAcceptSession';
import { identifyCodexCommand } from './codexCommand';
import { AuditDetails, AuditLog } from './auditLog';

interface WatchedExecution {
  id: number;
  execution: vscode.TerminalShellExecution;
  session: AutoAcceptSession;
}

interface CmdLaunch {
  started: boolean;
  failureReported?: boolean;
  startupTimer?: ReturnType<typeof setTimeout>;
}

const CMD_STARTUP_TIMEOUT_MS = 15000;

let cleanup: (() => void) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  cleanup?.();
  const output = vscode.window.createOutputChannel('Codex Auto-Accept', { log: true });
  const audit = new AuditLog(output);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const armedTerminals = new Set<vscode.Terminal>();
  const executions = new Map<vscode.Terminal, WatchedExecution>();
  const lastExecutions = new WeakMap<vscode.Terminal, vscode.TerminalShellExecution>();
  const integratedTerminals = new WeakSet<vscode.Terminal>();
  const notes = new WeakMap<vscode.Terminal, string>();
  const cmdTerminals = new Map<vscode.Terminal, CmdLaunch>();
  const subscriptions: vscode.Disposable[] = [output, status];
  let disposed = false;
  let nextSessionId = 1;
  const available = typeof vscode.window.onDidStartTerminalShellExecution === 'function';

  function updateStatus(): void {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      status.text = '$(circle-slash) Codex Auto-Accept';
      status.tooltip = '沒有目前使用中的終端。';
      status.backgroundColor = undefined;
      return;
    }
    const armed = armedTerminals.has(terminal);
    const watching = executions.has(terminal);
    status.text = !armed ? '$(circle-large-outline) Codex Auto-Accept: OFF'
      : watching ? '$(zap) Codex Auto-Accept: ON' : '$(clock) Codex Auto-Accept: 等待 Codex';
    const state = notes.get(terminal) ?? (terminal.shellIntegration
      ? '等待可辨識的 Codex 互動指令。'
      : '尚未啟用 Shell Integration，無法讀取提示。');
    const waiting = cmdTerminals.has(terminal)
      ? '等待 CMD 啟動器接上 Codex 輸出；若啟動失敗，請重新執行「以 CMD 啟動 Codex」。點擊關閉。'
      : '尚未接上 Codex 輸出；請結束目前工作階段，在 Shell Integration 啟用後重新執行 codex。點擊關閉。';
    status.tooltip = '終端：' + terminal.name + '\n' + state + '\n' +
      (armed ? watching ? '正在監看，僅送出單次核准；點擊關閉。'
        : waiting
        : '點擊開啟這個終端的單次操作核准。');
    status.backgroundColor = armed ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  function setNote(terminal: vscode.Terminal, reason: string, log = armedTerminals.has(terminal)): void {
    if (notes.get(terminal) === reason) return;
    notes.set(terminal, reason);
    if (log) audit.write('diagnostic', terminal, { sessionId: executions.get(terminal)?.id, reason });
  }

  function stopWatching(terminal: vscode.Terminal, reason: string, exitCode?: number): void {
    const record = executions.get(terminal);
    if (!record) return;
    record.session.dispose();
    executions.delete(terminal);
    audit.write('session.stopped', terminal, { sessionId: record.id, reason, exitCode });
  }

  function disableTerminal(terminal: vscode.Terminal, reason?: string, sessionId = executions.get(terminal)?.id): void {
    if (armedTerminals.delete(terminal)) audit.write('autoAccept.disabled', terminal, { sessionId, reason });
  }

  function clearCmdStartup(terminal: vscode.Terminal): void {
    const launch = cmdTerminals.get(terminal);
    if (launch?.startupTimer !== undefined) {
      clearTimeout(launch.startupTimer);
      launch.startupTimer = undefined;
    }
  }

  function failWatching(terminal: vscode.Terminal, reason: string, details: AuditDetails = {}): void {
    clearCmdStartup(terminal);
    const launch = cmdTerminals.get(terminal);
    if (launch) launch.failureReported = true;
    const sessionId = executions.get(terminal)?.id ?? details.sessionId;
    audit.write('watch.error', terminal, { ...details, sessionId, reason }, 'error');
    stopWatching(terminal, reason);
    disableTerminal(terminal, reason, sessionId);
    setNote(terminal, reason, false);
    updateStatus();
    void vscode.window.showWarningMessage('Codex Auto-Accept：' + reason + '；已關閉此終端的自動核准。');
  }

  function startCmd(): void {
    if (disposed) return;
    if (process.platform !== 'win32') {
      void vscode.window.showInformationMessage('Codex Auto-Accept：以 CMD 啟動 Codex 需要 Windows 擴充套件主機。');
      return;
    }
    if (!available) {
      void vscode.window.showWarningMessage('Codex Auto-Accept：此 VS Code 不支援 Terminal Shell Integration API。');
      return;
    }
    let createdTerminal: vscode.Terminal | undefined;
    try {
      const editor = vscode.window.activeTextEditor;
      const folder = (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri))
        ?? vscode.workspace.workspaceFolders?.[0];
      const terminal = vscode.window.createTerminal({
        name: 'Codex (CMD)',
        shellPath: path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
        shellArgs: '/d /s /v:off /c ""%CODEX_AUTO_ACCEPT_CMD_LAUNCHER%""',
        env: { CODEX_AUTO_ACCEPT_CMD_LAUNCHER: context.asAbsolutePath('resources/cmd-launcher.cmd') },
        cwd: folder?.uri ?? homedir(),
        isTransient: true,
      });
      createdTerminal = terminal;
      const launch: CmdLaunch = { started: false };
      cmdTerminals.set(terminal, launch);
      launch.startupTimer = setTimeout(() => {
        launch.startupTimer = undefined;
        if (!disposed && cmdTerminals.get(terminal) === launch && !launch.started) {
          failWatching(terminal, 'CMD 啟動器未能接上 Codex 輸出，請重新執行「以 CMD 啟動 Codex」。');
        }
      }, CMD_STARTUP_TIMEOUT_MS);
      setNote(terminal, '正在以 CMD 啟動 Codex，自動核准預設 OFF。', false);
      audit.write('diagnostic', terminal, { reason: '已建立專用 CMD 終端，自動核准預設 OFF。' });
      terminal.show();
    } catch (error) {
      const reason = 'CMD 終端啟動失敗：' + String(error);
      if (createdTerminal) {
        clearCmdStartup(createdTerminal);
        cmdTerminals.delete(createdTerminal);
        notes.delete(createdTerminal);
        try { createdTerminal.dispose(); } catch { /* Keep the original startup error. */ }
      }
      audit.write('watch.error', createdTerminal, { reason }, 'error');
      void vscode.window.showWarningMessage('Codex Auto-Accept：' + reason);
    }
  }

  function toggle(): void {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      audit.write('autoAccept.unavailable', undefined, { reason: '沒有目前使用中的終端。' }, 'warn');
      void vscode.window.showInformationMessage('Codex Auto-Accept：沒有目前使用中的終端。');
      return;
    }
    if (!available) {
      audit.write('autoAccept.unavailable', terminal, { reason: '此 VS Code 不支援 Terminal Shell Integration API。' }, 'warn');
      void vscode.window.showWarningMessage('Codex Auto-Accept：此 VS Code 不支援 Terminal Shell Integration API。');
      return;
    }
    if (armedTerminals.has(terminal)) {
      disableTerminal(terminal);
    } else {
      armedTerminals.add(terminal);
      audit.write('autoAccept.enabled', terminal, { sessionId: executions.get(terminal)?.id });
      if (cmdTerminals.has(terminal) && !executions.has(terminal)) {
        setNote(terminal, '等待 CMD 啟動器接上 Codex 輸出。');
      } else if (!terminal.shellIntegration) {
        setNote(terminal, '等待 Shell Integration；在它啟用後重新執行 codex。');
        void vscode.window.showInformationMessage('Codex Auto-Accept：等待 Shell Integration，請在啟用後執行 codex。');
      } else if (!executions.has(terminal)) {
        setNote(terminal, '等待下一個可監看的 Codex 指令；請結束目前工作階段後重新執行 codex。');
      } else {
        setNote(terminal, '正在觀察 Codex 工作階段。', false);
      }
    }
    executions.get(terminal)?.session.setArmed(armedTerminals.has(terminal));
    updateStatus();
  }

  function watch(terminal: vscode.Terminal, execution: vscode.TerminalShellExecution): void {
    if (disposed || lastExecutions.get(terminal) === execution) return;
    lastExecutions.set(terminal, execution);
    if (executions.has(terminal)) {
      const reason = 'Codex 監看已被另一個指令取代，已取消待送出的核准。';
      stopWatching(terminal, reason);
      setNote(terminal, reason, false);
    }
    const command = identifyCodexCommand(execution.commandLine.value);
    if (!command) {
      setNote(terminal, execution.commandLine.value
        ? '目前指令不是可辨識的 Codex 互動指令；等待下一個 Codex 工作階段，請重新執行 codex。'
        : 'Shell Integration 尚未提供指令名稱；等待下一個 Codex 工作階段，請重新執行 codex。');
      updateStatus();
      return;
    }

    const cmdLaunch = cmdTerminals.get(terminal);
    if (cmdLaunch) {
      cmdLaunch.started = true;
      clearCmdStartup(terminal);
    }

    // read() must be called synchronously in the start event, before any await.
    const sessionId = nextSessionId++;
    let stream: AsyncIterable<string>;
    try {
      stream = execution.read();
    } catch (error) {
      failWatching(terminal, '終端輸出讀取失敗，請重新執行 codex：' + String(error), { sessionId });
      return;
    }
    let record: WatchedExecution;
    const session = new AutoAcceptSession(
      () => {
        if (disposed || executions.get(terminal) !== record || !armedTerminals.has(terminal)) return false;
        terminal.sendText('y', false);
      },
      event => {
        if (disposed || executions.get(terminal) !== record) return;
        if (event.type === 'accepted') {
          audit.write('approval.sent', terminal, { sessionId: record.id, kind: event.kind, content: event.content });
          setNote(terminal, '已送出單次核准，等待下一個操作。', false);
        } else {
          if (event.type === 'error') {
            failWatching(terminal, event.reason, { kind: event.kind, content: event.content });
            return;
          }
          // The session deduplicates per prompt, including later identical reasons.
          notes.set(terminal, event.reason);
          audit.write('approval.skipped', terminal, { sessionId: record.id, reason: event.reason }, 'warn');
        }
        updateStatus();
      },
    );
    record = { id: sessionId, execution, session };
    executions.set(terminal, record);
    setNote(terminal, '正在觀察 Codex ' + command.mode + ' 工作階段。', false);
    audit.write('session.started', terminal, { sessionId, launcher: command.launcher, mode: command.mode });
    session.setArmed(armedTerminals.has(terminal));
    updateStatus();

    void (async () => {
      try {
        for await (const chunk of stream) {
          if (disposed || executions.get(terminal) !== record) break;
          session.write(chunk);
        }
        if (!disposed && executions.get(terminal) === record) {
          const reason = 'Codex 終端輸出串流已結束，等待下一個工作階段；請重新執行 codex。';
          stopWatching(terminal, reason);
          setNote(terminal, reason, false);
          updateStatus();
        }
      } catch (error) {
        if (!disposed && executions.get(terminal) === record) {
          failWatching(terminal, '終端輸出讀取失敗，請重新執行 codex：' + String(error));
        }
      }
    })();
  }

  status.command = 'codexAutoAccept.toggle';
  status.show();
  subscriptions.push(vscode.commands.registerCommand('codexAutoAccept.toggle', toggle));
  subscriptions.push(vscode.commands.registerCommand('codexAutoAccept.startCmd', startCmd));
  subscriptions.push(vscode.window.onDidChangeActiveTerminal(updateStatus));
  subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
    const launch = cmdTerminals.get(terminal);
    clearCmdStartup(terminal);
    const exitCode = terminal.exitStatus?.code;
    const exitReason = terminal.exitStatus?.reason;
    if (launch && !launch.started && !launch.failureReported &&
      (exitReason === vscode.TerminalExitReason.Process || exitReason === vscode.TerminalExitReason.Unknown)) {
      const reason = exitCode === 9009
        ? '找不到可執行的 Codex，請確認 codex.exe 或 codex.cmd 已加入 CMD 的 PATH。'
        : 'CMD 啟動器在接上 Codex 輸出前已結束' + (exitCode === undefined ? '。' : '（結束碼 ' + exitCode + '）。');
      failWatching(terminal, reason, { exitCode });
    }
    const sessionId = executions.get(terminal)?.id;
    const reason = '終端已關閉，已取消待送出的核准。';
    stopWatching(terminal, reason, exitCode);
    disableTerminal(terminal, reason, sessionId);
    audit.write('terminal.closed', terminal, { sessionId, reason, exitCode });
    notes.delete(terminal);
    lastExecutions.delete(terminal);
    integratedTerminals.delete(terminal);
    cmdTerminals.delete(terminal);
    updateStatus();
  }));
  if (available) {
    subscriptions.push(vscode.window.onDidStartTerminalShellExecution(event => watch(event.terminal, event.execution)));
    subscriptions.push(vscode.window.onDidEndTerminalShellExecution(event => {
      if (executions.get(event.terminal)?.execution !== event.execution) return;
      const reason = event.exitCode === undefined
        ? 'Codex 監看已中斷，已取消待送出的核准；請重新執行 codex。'
        : 'Codex 指令已結束，等待下一個可監看的工作階段；請重新執行 codex。';
      stopWatching(event.terminal, reason, event.exitCode);
      setNote(event.terminal, reason, false);
      updateStatus();
    }));
  } else {
    audit.write('diagnostic', undefined, { reason: '此 VS Code 不支援 Terminal Shell Integration API。' }, 'warn');
    void vscode.window.showWarningMessage('Codex Auto-Accept：請使用支援 Terminal Shell Integration API 的 VS Code。');
  }
  subscriptions.push(vscode.window.onDidChangeTerminalShellIntegration(event => {
    if (!integratedTerminals.has(event.terminal)) {
      integratedTerminals.add(event.terminal);
      audit.write('shellIntegration.ready', event.terminal, { sessionId: executions.get(event.terminal)?.id });
      if (!executions.has(event.terminal)) setNote(event.terminal, cmdTerminals.has(event.terminal)
        ? 'CMD 啟動器已接上，等待 Codex 工作階段。'
        : 'Shell Integration 已啟用，等待 Codex 工作階段；請重新執行 codex。', false);
    }
    updateStatus();
  }));

  cleanup = () => {
    if (disposed) return;
    disposed = true;
    const reason = '擴充套件已停用，已取消待送出的核准。';
    for (const terminal of executions.keys()) stopWatching(terminal, reason);
    for (const terminal of armedTerminals) disableTerminal(terminal, reason);
    for (const terminal of cmdTerminals.keys()) clearCmdStartup(terminal);
    cmdTerminals.clear();
    audit.write('extension.stopped', undefined, { reason });
    for (const subscription of subscriptions) subscription.dispose();
  };
  context.subscriptions.push({ dispose: cleanup });
  audit.write('extension.started', undefined, { reason: 'Codex Auto-Accept 已啟動；各終端預設 OFF。' });
  updateStatus();
}

export function deactivate(): void {
  cleanup?.();
  cleanup = undefined;
}
