/** @fileoverview Tests for the OpenCode CLI stream parser. */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { opencode } from './opencode.ts';

describe('opencode parseStreamLine', () => {
  it('parses step_start into init', () => {
    const events = opencode.parseStreamLine(
      '{"type":"step_start","timestamp":1000000,"sessionID":"ses_abc","part":{"sessionID":"ses_abc","type":"step-start"}}',
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'init', sessionId: 'ses_abc', model: '' });
  });

  it('parses text event', () => {
    const events = opencode.parseStreamLine(
      '{"type":"text","timestamp":1001000,"sessionID":"ses_abc","part":{"sessionID":"ses_abc","type":"text","text":"hello"}}',
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'text_delta', delta: 'hello' });
  });

  it('ignores intermediate step_finish (tool-calls)', () => {
    opencode.parseStreamLine(
      '{"type":"step_start","timestamp":1000000,"sessionID":"ses_x","part":{"sessionID":"ses_x","type":"step-start"}}',
    );
    const events = opencode.parseStreamLine(
      '{"type":"step_finish","timestamp":1002000,"sessionID":"ses_x","part":{"sessionID":"ses_x","type":"step-finish","reason":"tool-calls","cost":0.01,"tokens":{"total":500,"input":400,"output":100,"reasoning":0,"cache":{"read":50,"write":200}}}}',
    );
    strictEqual(events.length, 0);
  });

  it('accumulates metrics across multi-step sessions', () => {
    // Step 1: start
    opencode.parseStreamLine(
      '{"type":"step_start","timestamp":1000000,"sessionID":"ses_multi","part":{"sessionID":"ses_multi","type":"step-start"}}',
    );
    // Step 1: finish (tool-calls, not final)
    opencode.parseStreamLine(
      JSON.stringify({
        type: 'step_finish',
        timestamp: 1002000,
        sessionID: 'ses_multi',
        part: {
          sessionID: 'ses_multi',
          type: 'step-finish',
          reason: 'tool-calls',
          cost: 0.003,
          tokens: {
            total: 500,
            input: 400,
            output: 100,
            reasoning: 0,
            cache: { read: 50, write: 200 },
          },
        },
      }),
    );
    // Step 2: start
    opencode.parseStreamLine(
      '{"type":"step_start","timestamp":1003000,"sessionID":"ses_multi","part":{"sessionID":"ses_multi","type":"step-start"}}',
    );
    // Step 2: finish (stop, final)
    const events = opencode.parseStreamLine(
      JSON.stringify({
        type: 'step_finish',
        timestamp: 1005000,
        sessionID: 'ses_multi',
        part: {
          sessionID: 'ses_multi',
          type: 'step-finish',
          reason: 'stop',
          cost: 0.001,
          tokens: {
            total: 200,
            input: 150,
            output: 50,
            reasoning: 0,
            cache: { read: 30, write: 100 },
          },
        },
      }),
    );

    strictEqual(events.length, 1);
    const c = events[0]!;
    strictEqual(c.type, 'completion');
    if (c.type === 'completion') {
      strictEqual(c.tokensIn, 550);
      strictEqual(c.tokensOut, 150);
      strictEqual(c.cacheCreationTokens, 300);
      strictEqual(c.cacheReadTokens, 80);
      strictEqual(c.costUsd, 0.004);
      strictEqual(c.durationMs, 5000);
      strictEqual(c.numTurns, 2);
      strictEqual(c.sessionId, 'ses_multi');
    }
  });

  it('handles single-step sessions', () => {
    opencode.parseStreamLine(
      '{"type":"step_start","timestamp":2000000,"sessionID":"ses_single","part":{"sessionID":"ses_single","type":"step-start"}}',
    );
    const events = opencode.parseStreamLine(
      JSON.stringify({
        type: 'step_finish',
        timestamp: 2001000,
        sessionID: 'ses_single',
        part: {
          sessionID: 'ses_single',
          type: 'step-finish',
          reason: 'stop',
          cost: 0.002,
          tokens: {
            total: 100,
            input: 80,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 50 },
          },
        },
      }),
    );

    strictEqual(events.length, 1);
    const c = events[0]!;
    strictEqual(c.type, 'completion');
    if (c.type === 'completion') {
      strictEqual(c.durationMs, 1000);
      strictEqual(c.numTurns, 1);
      strictEqual(c.tokensIn, 80);
      strictEqual(c.tokensOut, 20);
    }
  });

  it('parses simple error event', () => {
    const events = opencode.parseStreamLine('{"type":"error","message":"auth failed"}');
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'error', error: 'auth failed' });
  });

  it('extracts message from nested API error', () => {
    const events = opencode.parseStreamLine(
      JSON.stringify({
        type: 'error',
        error: {
          name: 'APIError',
          data: { message: 'Your credit balance is too low', statusCode: 400 },
        },
      }),
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'error', error: 'Your credit balance is too low' });
  });

  it('falls back to error name when no message', () => {
    const events = opencode.parseStreamLine(
      JSON.stringify({ type: 'error', error: { name: 'UnknownError', data: {} } }),
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'error', error: 'UnknownError' });
  });

  it('emits tool_use event', () => {
    const events = opencode.parseStreamLine(
      JSON.stringify({
        type: 'tool_use',
        timestamp: 1772778840600,
        sessionID: 'ses_abc',
        part: {
          sessionID: 'ses_abc',
          type: 'tool',
          callID: 'toolu_012',
          tool: 'mcp__playwright__navigate',
          state: { status: 'completed' },
        },
      }),
    );
    strictEqual(events.length, 1);
    deepStrictEqual(events[0], { type: 'tool_use', toolName: 'mcp__playwright__navigate' });
  });

  it('returns empty for blank lines and non-json', () => {
    strictEqual(opencode.parseStreamLine('').length, 0);
    strictEqual(opencode.parseStreamLine('garbage').length, 0);
  });
});
