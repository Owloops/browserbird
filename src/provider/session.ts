/** @fileoverview Session router: maps Slack threads to CLI sessions. */

import type { AgentConfig, Config } from '../core/types.ts';
import type { SessionRow } from '../db/index.ts';
import { logger } from '../core/logger.ts';
import * as db from '../db/index.ts';

/**
 * Matches an incoming message to the correct agent based on channel config.
 * Agents are checked in order; first match wins.
 * A wildcard `"*"` in the agent's channels array matches everything.
 * The optional `nameToId` map resolves human-readable channel names to Slack IDs.
 */
export function matchAgent(
  channelId: string,
  agents: AgentConfig[],
  nameToId?: Map<string, string>,
): AgentConfig | undefined {
  for (const agent of agents) {
    for (const pattern of agent.channels) {
      if (pattern === '*' || pattern === channelId) {
        return agent;
      }
      if (nameToId?.get(pattern) === channelId) {
        return agent;
      }
    }
  }
  return undefined;
}

/**
 * Looks up or creates a session for the given Slack thread.
 * Returns the session row and whether it was newly created.
 */
export function resolveSession(
  channelId: string,
  threadTs: string | null,
  config: Config,
  nameToId?: Map<string, string>,
): { session: SessionRow; agent: AgentConfig; isNew: boolean } | null {
  const agent = matchAgent(channelId, config.agents, nameToId);
  if (!agent) {
    logger.warn(`no agent matched for channel ${channelId}`);
    return null;
  }

  const existing = db.findSession(channelId, threadTs);
  if (existing) {
    const ageHours =
      (Date.now() - new Date(existing.last_active + 'Z').getTime()) / (1000 * 60 * 60);

    if (ageHours > config.sessions.ttlHours) {
      logger.info(`session ${existing.uid} expired (${ageHours.toFixed(1)}h old), starting fresh`);
      return { session: existing, agent, isNew: true };
    }

    return { session: existing, agent, isNew: false };
  }

  const session = db.createSession(channelId, threadTs, agent.id, '');
  logger.info(
    `created session ${session.uid} for channel=${channelId} thread=${threadTs ?? 'none'} agent=${agent.id}`,
  );
  return { session, agent, isNew: true };
}

export function deleteExpiredSessions(retentionDays: number): number {
  const deleted = db.deleteOldSessions(retentionDays);
  if (deleted > 0) {
    logger.info(`deleted ${deleted} expired session(s)`);
  }
  return deleted;
}
