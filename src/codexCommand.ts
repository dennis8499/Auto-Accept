export interface CodexCommand {
  launcher: 'direct' | 'npx';
  mode: 'interactive' | 'resume' | 'fork';
}

// Only inspect a single invocation, never a shell pipeline or an arbitrary script.
function tokenize(commandLine: string): string[] | undefined {
  if (/[\r\n]/.test(commandLine)) return undefined;
  const words: string[] = [];
  let word = '';
  let started = false;
  let quote: string | undefined;
  const input = commandLine.trim().replace(/^&(?=\s|["'])\s*/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && input[index + 1] === "'") {
          word += "'";
          index++;
        } else {
          quote = undefined;
        }
      } else if (char === '`' && quote === '"') {
        if (++index >= input.length) return undefined;
        word += input[index];
      } else {
        word += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else if (/[;|&<>\r\n]/.test(char)) {
      return undefined;
    } else if (char === '`' || (char === '\\' && /\s/.test(input[index + 1] ?? ''))) {
      if (++index >= input.length) return undefined;
      word += input[index];
      started = true;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) words.push(word);
  return words;
}

const VALUE_FLAGS = new Set([
  '-c', '--config', '-C', '--cd', '-a', '--ask-for-approval', '-m', '--model',
  '-p', '--profile', '-i', '--image', '-s', '--sandbox', '--local-provider',
  '--remote', '--remote-auth-token-env', '--add-dir', '--enable', '--disable',
]);
const NON_INTERACTIVE = new Set([
  'agents', 'exec', 'e', 'review', 'login', 'logout', 'mcp', 'plugin', 'app-server',
  'remote-control', 'app', 'completion', 'update', 'doctor', 'sandbox', 'debug',
  'apply', 'a', 'queue', 'archive', 'delete', 'migrate-rollouts', 'unarchive',
  'cloud', 'exec-server', 'features', 'help',
]);

export function identifyCodexCommand(commandLine: string): CodexCommand | undefined {
  const words = tokenize(commandLine);
  if (!words?.length) return undefined;
  const basename = words[0].split(/[\\/]/).pop()?.toLowerCase() ?? '';
  let launcher: CodexCommand['launcher'];
  let args: string[];
  if (/^codex(?:\.exe|\.cmd|\.ps1)?$/.test(basename)) {
    launcher = 'direct';
    args = words.slice(1);
  } else if (/^npx(?:\.exe|\.cmd|\.ps1)?$/.test(basename)) {
    let packageIndex = 1;
    while (['-y', '--yes', '-q', '--quiet'].includes(words[packageIndex])) packageIndex++;
    if (!/^@openai\/codex(?:@[a-zA-Z0-9._~^*-]+)?$/.test(words[packageIndex] ?? '')) return undefined;
    launcher = 'npx';
    args = words.slice(packageIndex + 1);
  } else {
    return undefined;
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') return { launcher, mode: 'interactive' };
    if (['-h', '--help', '-V', '--version'].includes(arg)) return undefined;
    if (VALUE_FLAGS.has(arg)) {
      if (++index >= args.length) return undefined;
      continue;
    }
    if (arg.startsWith('-')) continue;
    if (NON_INTERACTIVE.has(arg)) return undefined;
    return { launcher, mode: arg === 'resume' || arg === 'fork' ? arg : 'interactive' };
  }
  return { launcher, mode: 'interactive' };
}
