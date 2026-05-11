/** @fileoverview Chat subcommand: send a message to the agent and stream the response via the daemon. */

import { logger } from '../core/logger.ts';
import { c } from './style.ts';
import { loadCliToken } from './auth.ts';
import {
  daemonRequest,
  resolveDaemonBaseUrl,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

interface ChatStreamPayload {
  sessionUid: string;
  subtype: 'append' | 'stop' | 'message' | 'status' | 'title' | 'image' | 'error';
  markdownText?: string;
  text?: string;
  status?: string;
  title?: string;
}

async function* parseSSE(
  response: Response,
  signal: AbortSignal,
): AsyncIterableIterator<{ event: string; data: string }> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  signal.addEventListener('abort', () => {
    reader.cancel().catch(() => {});
  });
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      return;
    }
    if (chunk.done) return;
    buffer += decoder.decode(chunk.value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += (data ? '\n' : '') + line.slice(6);
      }
      yield { event, data };
    }
  }
}

export async function runChat(
  message: string,
  options: { session?: string; agent?: string },
): Promise<void> {
  const credential = loadCliToken();
  if (!credential) {
    logger.error(new DaemonAuthError().message);
    process.exitCode = 1;
    return;
  }

  if (options.agent !== undefined) {
    logger.warn('--agent is currently ignored; daemon resolves the agent from channel config');
  }

  const baseUrl = resolveDaemonBaseUrl();
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());

  let sseResponse: Response;
  try {
    sseResponse = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/events`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credential.token}`,
        Accept: 'text/event-stream',
      },
      signal: ac.signal,
    });
  } catch (err) {
    logger.error(new DaemonUnreachableError(baseUrl, err).message);
    process.exitCode = 1;
    return;
  }
  if (sseResponse.status === 401 || sseResponse.status === 403) {
    logger.error(new DaemonAuthError().message);
    process.exitCode = 1;
    return;
  }
  if (!sseResponse.ok) {
    logger.error(`SSE connection failed: ${sseResponse.status} ${sseResponse.statusText}`);
    process.exitCode = 1;
    return;
  }

  let threadId: string;
  try {
    const sendResult = await daemonRequest<{ threadId: string }>({
      method: 'POST',
      path: '/api/chat/send',
      body: {
        message,
        sessionUid: options.session,
      },
    });
    threadId = sendResult.threadId;
  } catch (err) {
    if (err instanceof DaemonAuthError) {
      logger.error(err.message);
    } else if (err instanceof DaemonUnreachableError) {
      logger.error(err.message);
    } else if (err instanceof DaemonError) {
      logger.error(err.message);
    } else {
      throw err;
    }
    process.exitCode = 1;
    ac.abort();
    return;
  }

  const stopOnSignal = async (): Promise<void> => {
    try {
      await daemonRequest({
        method: 'POST',
        path: '/api/chat/stop',
        body: { channelId: 'web', threadId },
      });
    } catch {
      /* best effort */
    }
  };

  process.on('SIGINT', () => {
    void stopOnSignal();
  });

  let firstAppend = true;
  let exitCode = 0;
  try {
    for await (const evt of parseSSE(sseResponse, ac.signal)) {
      if (evt.event !== 'chat_stream') continue;
      let payload: ChatStreamPayload;
      try {
        payload = JSON.parse(evt.data) as ChatStreamPayload;
      } catch {
        continue;
      }
      if (payload.sessionUid !== threadId) continue;

      switch (payload.subtype) {
        case 'append': {
          if (firstAppend) firstAppend = false;
          if (payload.markdownText) process.stdout.write(payload.markdownText);
          break;
        }
        case 'message': {
          if (payload.text) process.stdout.write(payload.text);
          break;
        }
        case 'status': {
          if (payload.status) process.stderr.write(c('dim', `[${payload.status}]\n`));
          break;
        }
        case 'title': {
          if (payload.title) process.stderr.write(c('dim', `title: ${payload.title}\n`));
          break;
        }
        case 'error': {
          process.stderr.write(c('red', `\nerror: ${payload.text ?? 'unknown'}`) + '\n');
          exitCode = 1;
          ac.abort();
          break;
        }
        case 'stop': {
          ac.abort();
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    if (!ac.signal.aborted) {
      logger.error(`stream error: ${err instanceof Error ? err.message : String(err)}`);
      exitCode = 1;
    }
  }

  process.stdout.write('\n');
  if (exitCode !== 0) process.exitCode = exitCode;
}
