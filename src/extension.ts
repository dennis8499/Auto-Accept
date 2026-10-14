import * as vscode from 'vscode';
import { AutoAcceptSession } from './autoAcceptSession';
import { identifyCodexCommand } from './codexCommand';

interface WatchedExecution {
  execution: vscode.TerminalShellExecution;
  session: AutoAcceptSession;
}

let cleanup: (() => void) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  cleanup?.();
  const output = vscode.window.createOutputChannel('Codex Auto-Accept');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const armedTerminals = new Set<vscode.Terminal>();
  const executions = new Map<vscode.Terminal, WatchedExecution>();
  const lastExecutions = new WeakMap<vscode.Terminal, vscode.TerminalShellExecution>();
  const integratedTerminals = new WeakSet<vscode.Terminal>();
  const notes = new WeakMap<vscode.Terminal, string>();
  const subscriptions: vscode.Disposable[] = [output, status];
  let disposed = false;
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
    status.tooltip = '終端：' + terminal.name + '\n' + state + '\n' +
      (armed ? watching ? '正在監看，僅送出單次核准；點擊關閉。'
        : '尚未接上 Codex 輸出；請結束目前工作階段，在 Shell Integration 啟用後重新執行 codex。點擊關閉。'
        : '點擊開啟這個終端的單次操作核准。');
    status.backgroundColor = armed ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  function setNote(terminal: vscode.Terminal, reason: string, log = armedTerminals.has(terminal)): void {
    if (notes.get(terminal) === reason) return;
    notes.set(terminal, reason);
    if (log) output.appendLine('[' + terminal.name + '] ' + reason);
  }

  function stopWatching(terminal: vscode.Terminal): void {
    executions.get(terminal)?.session.dispose();
    executions.delete(terminal);
  }

  function failWatching(terminal: vscode.Terminal, reason: string): void {
    stopWatching(terminal);
    armedTerminals.delete(terminal);
    setNote(terminal, reason, true);
    updateStatus();
    void vscode.window.showWarningMessage('Codex Auto-Accept：' + reason + '；已關閉此終端的自動核准。');
  }

  function toggle(): void {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      void vscode.window.showInformationMessage('Codex Auto-Accept：沒有目前使用中的終端。');
      return;
    }
    if (!available) {
      void vscode.window.showWarningMessage('Codex Auto-Accept：此 VS Code 不支援 Terminal Shell Integration API。');
      return;
    }
    if (armedTerminals.has(terminal)) {
      armedTerminals.delete(terminal);
    } else {
      armedTerminals.add(terminal);
      if (!terminal.shellIntegration) {
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
    if (executions.has(terminal)) setNote(terminal, 'Codex 監看已被另一個指令取代，已取消待送出的核准。', true);
    stopWatching(terminal);
    const command = identifyCodexCommand(execution.commandLine.value);
    if (!command) {
      setNote(terminal, execution.commandLine.value
        ? '目前指令不是可辨識的 Codex 互動指令；等待下一個 Codex 工作階段，請重新執行 codex。'
        : 'Shell Integration 尚未提供指令名稱；等待下一個 Codex 工作階段，請重新執行 codex。');
      updateStatus();
      return;
    }

    // read() must be called synchronously in the start event, before any await.
    let stream: AsyncIterable<string>;
    try {
      stream = execution.read();
    } catch (error) {
      failWatching(terminal, '終端輸出讀取失敗，請重新執行 codex：' + String(error));
      return;
    }
    let record: WatchedExecution;
    const session = new AutoAcceptSession(
      () => {
        if (disposed || executions.get(terminal) !== record || !armedTerminals.has(terminal)) return;
        terminal.sendText('y', false);
      },
      event => {
        if (disposed || executions.get(terminal) !== record) return;
        if (event.type === 'accepted') {
          const labels = { command: '指令執行', edit: '檔案修改', network: '網路存取', input: '終端輸入', permissions: '本回合權限' };
          output.appendLine('[' + terminal.name + '] 已送出單次核准：' + labels[event.kind]);
          setNote(terminal, '已送出單次核准，等待下一個操作。', false);
        } else {
          if (event.type === 'error') {
            failWatching(terminal, event.reason);
            return;
          }
          // The session deduplicates per prompt, including later identical reasons.
          notes.set(terminal, event.reason);
          output.appendLine('[' + terminal.name + '] ' + event.reason);
        }
        updateStatus();
      },
    );
    record = { execution, session };
    executions.set(terminal, record);
    setNote(terminal, '正在觀察 Codex ' + command.mode + ' 工作階段。', false);
    output.appendLine('[' + terminal.name + '] Codex 互動指令開始（' + command.launcher + ' / ' + command.mode + '）');
    session.setArmed(armedTerminals.has(terminal));
    updateStatus();

    void (async () => {
      try {
        for await (const chunk of stream) {
          if (disposed || executions.get(terminal) !== record) break;
          session.write(chunk);
        }
        if (!disposed && executions.get(terminal) === record) {
          stopWatching(terminal);
          setNote(terminal, 'Codex 終端輸出串流已結束，等待下一個工作階段；請重新執行 codex。', true);
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
  subscriptions.push(vscode.window.onDidChangeActiveTerminal(updateStatus));
  subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
    stopWatching(terminal);
    armedTerminals.delete(terminal);
    notes.delete(terminal);
    lastExecutions.delete(terminal);
    integratedTerminals.delete(terminal);
    updateStatus();
  }));
  if (available) {
    subscriptions.push(vscode.window.onDidStartTerminalShellExecution(event => watch(event.terminal, event.execution)));
    subscriptions.push(vscode.window.onDidEndTerminalShellExecution(event => {
      if (executions.get(event.terminal)?.execution !== event.execution) return;
      stopWatching(event.terminal);
      setNote(event.terminal, event.exitCode === undefined
        ? 'Codex 監看已中斷，已取消待送出的核准；請重新執行 codex。'
        : 'Codex 指令已結束，等待下一個可監看的工作階段；請重新執行 codex。', true);
      updateStatus();
    }));
  } else {
    output.appendLine('此 VS Code 不支援 Terminal Shell Integration API。');
    void vscode.window.showWarningMessage('Codex Auto-Accept：請使用支援 Terminal Shell Integration API 的 VS Code。');
  }
  subscriptions.push(vscode.window.onDidChangeTerminalShellIntegration(event => {
    if (!integratedTerminals.has(event.terminal)) {
      integratedTerminals.add(event.terminal);
      if (!executions.has(event.terminal)) setNote(event.terminal, 'Shell Integration 已啟用，等待 Codex 工作階段；請重新執行 codex。', true);
    }
    updateStatus();
  }));

  cleanup = () => {
    if (disposed) return;
    disposed = true;
    for (const record of executions.values()) record.session.dispose();
    executions.clear();
    armedTerminals.clear();
    for (const subscription of subscriptions) subscription.dispose();
  };
  context.subscriptions.push({ dispose: cleanup });
  output.appendLine('Codex Auto-Accept 已啟動；各終端預設 OFF。');
  updateStatus();
}

export function deactivate(): void {
  cleanup?.();
  cleanup = undefined;
}
