/** @fileoverview Interactive CLI prompts. */

const CTRL_C = String.fromCharCode(3);
const DEL = String.fromCharCode(127);

export function promptLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf-8');
      stdin.on('data', (chunk) => {
        data += chunk;
      });
      stdin.on('end', () => resolve(data.trim()));
      return;
    }
    stdin.setEncoding('utf-8');
    stdin.resume();
    let value = '';
    const onData = (chunk: string) => {
      if (chunk.includes(CTRL_C)) {
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        process.exit(130);
      }
      const nl = chunk.search(/[\r\n]/);
      if (nl === -1) {
        value += chunk;
        return;
      }
      value += chunk.slice(0, nl);
      stdin.removeListener('data', onData);
      stdin.pause();
      resolve(value.trim());
    };
    stdin.on('data', onData);
  });
}

export function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf-8');
      stdin.on('data', (chunk) => {
        data += chunk;
      });
      stdin.on('end', () => resolve(data.trim()));
      return;
    }
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    let value = '';
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stderr.write('\n');
        resolve(value);
      } else if (ch === CTRL_C) {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        process.stderr.write('\n');
        process.exit(130);
      } else if (ch === DEL || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
