// Reminders.
//
// Version 1 ships one reminder channel: the on-screen "Expiring soon" panel.
// Future channels (an .ics calendar download, browser notifications) plug in here
// without touching calculations or the rest of the UI:
//
//   1. buildReminderEvents() turns the report into a normalized list of events.
//      Every channel consumes this same list.
//   2. A channel implements the ReminderProvider interface below and calls
//      registerReminderProvider(). The UI renders one button per supported
//      provider inside the Expiring-soon panel (#reminder-actions).
//
// ReminderProvider interface:
//   {
//     id: string,                       // 'ics', 'notifications', ...
//     label: string,                    // button text, e.g. "Download calendar reminders"
//     isSupported(): boolean,           // feature detection (e.g. 'Notification' in window)
//     deliver(events, context): Promise<void>   // do the work; context = { state, report }
//   }

import { addDays, parseISODate } from './dates.js';
import { categoryLabel } from './defaults.js';

/**
 * @typedef {object} ReminderEvent
 * @property {string} itemId
 * @property {string} title       e.g. "Black beans expires"
 * @property {string} description
 * @property {string} category    human-readable category label
 * @property {string} expiresOn   ISO date
 * @property {string} remindOn    ISO date, one warning window before expiration (never before today)
 * @property {number} daysLeft
 */

/**
 * Build the normalized reminder events for everything expiring within the warning window.
 * @param {object} report  Result of computeReport()
 * @returns {ReminderEvent[]}
 */
export function buildReminderEvents(report) {
  return report.expiring.map((item) => {
    const remindOn = addDays(item.expires, -report.warningDays) || item.expires;
    return {
      itemId: item.id,
      title: `${item.name} expires`,
      description: `${item.quantity} × ${item.name} (${categoryLabel(item.category)}) expires on ${item.expires}. Use it soon and replace with fresh stock.`,
      category: categoryLabel(item.category),
      expiresOn: item.expires,
      remindOn: remindOn < report.today ? report.today : remindOn,
      daysLeft: item.daysLeft,
    };
  });
}

/**
 * Build reminder events for every non-expired item regardless of the warning window.
 * Useful for calendar export, where the user wants all future reminders at once.
 */
export function buildAllReminderEvents(state, today) {
  return state.items
    .filter((item) => item.expires >= today && parseISODate(item.expires))
    .map((item) => {
      const remindOn = addDays(item.expires, -state.settings.warningDays) || item.expires;
      return {
        itemId: item.id,
        title: `${item.name} expires`,
        description: `${item.quantity} × ${item.name} (${categoryLabel(item.category)}) expires on ${item.expires}. Use it soon and replace with fresh stock.`,
        category: categoryLabel(item.category),
        expiresOn: item.expires,
        remindOn: remindOn < today ? today : remindOn,
        daysLeft: null,
      };
    });
}

const providers = [];

export function registerReminderProvider(provider) {
  if (!provider || typeof provider.id !== 'string') {
    throw new Error('Reminder provider needs an id.');
  }
  const existing = providers.findIndex((p) => p.id === provider.id);
  if (existing >= 0) providers.splice(existing, 1);
  providers.push(provider);
}

/** Providers whose feature detection passes in this browser. */
export function getSupportedProviders() {
  return providers.filter((p) => {
    try {
      return typeof p.isSupported !== 'function' || p.isSupported();
    } catch {
      return false;
    }
  });
}

export function getProvider(id) {
  return providers.find((p) => p.id === id) || null;
}
