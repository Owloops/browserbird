/** @fileoverview Tests for the Claude CLI stream parser. */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { parseStreamLine } from './claude.ts';

describe('claude parseStreamLine', () => {
  it('parses system event into init', () => {
    const events = parseStreamLine(
      '{"type":"system","session_id":"abc-123","model":"claude-sonnet-4-20250514","apiKeySource":"oauth"}',
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], {
      type: 'init',
      sessionId: 'abc-123',
      model: 'claude-sonnet-4-20250514',
      apiKeySource: 'oauth',
    });
  });

  it('parses assistant text content', () => {
    const events = parseStreamLine(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"4"}]}}',
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'text_delta', delta: '4' });
  });

  it('parses result into completion with full metrics', () => {
    const events = parseStreamLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: '4',
        session_id: 'abc-123',
        is_error: false,
        usage: {
          input_tokens: 100,
          output_tokens: 5,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 10,
        },
        total_cost_usd: 0.001,
        duration_ms: 1500,
        num_turns: 3,
      }),
    );
    strictEqual(events.length, 1);
    const c = events[0]!;
    strictEqual(c.type, 'completion');
    if (c.type === 'completion') {
      strictEqual(c.subtype, 'success');
      strictEqual(c.tokensIn, 100);
      strictEqual(c.tokensOut, 5);
      strictEqual(c.cacheCreationTokens, 50);
      strictEqual(c.cacheReadTokens, 10);
      strictEqual(c.costUsd, 0.001);
      strictEqual(c.durationMs, 1500);
      strictEqual(c.numTurns, 3);
    }
  });

  it('parses error event', () => {
    const events = parseStreamLine('{"type":"error","error":"something broke"}');
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'error', error: 'something broke' });
  });

  it('returns empty for blank lines', () => {
    strictEqual(parseStreamLine('').length, 0);
    strictEqual(parseStreamLine('   ').length, 0);
  });

  it('returns empty for non-json', () => {
    strictEqual(parseStreamLine('not json at all').length, 0);
  });

  it('emits tool_use event with toolCallId and details from content blocks', () => {
    const events = parseStreamLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'ls', description: 'List files' },
            },
          ],
        },
      }),
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], {
      type: 'tool_use',
      toolName: 'Bash',
      toolCallId: 'toolu_1',
      details: 'List files',
    });
  });

  it('emits tool_result event with output from user content blocks', () => {
    const events = parseStreamLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file1\nfile2\nfile3' },
          ],
        },
      }),
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], {
      type: 'tool_result',
      toolCallId: 'toolu_1',
      isError: false,
      output: '3 lines of output',
    });
  });

  it('emits tool_result with isError when tool fails', () => {
    const events = parseStreamLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'failed' },
          ],
        },
      }),
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], {
      type: 'tool_result',
      toolCallId: 'toolu_2',
      isError: true,
      output: 'failed',
    });
  });

  it('parses rate_limit_event', () => {
    const events = parseStreamLine(
      '{"type":"rate_limit_event","rate_limit_info":{"status":"rate_limited","resetsAt":1700000000}}',
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], {
      type: 'rate_limit',
      status: 'rate_limited',
      resetsAt: 1700000000,
    });
  });
});
