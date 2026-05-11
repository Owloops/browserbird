/** @fileoverview Shared event channel for bird config changes. */

import { EventEmitter } from 'node:events';

export const scheduleEvents = new EventEmitter();

export const SCHEDULE_UPDATED = 'schedule-updated';

export interface ScheduleUpdatedPayload {
  uid: string;
}
