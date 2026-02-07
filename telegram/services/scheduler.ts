// =============================================================================
// SCHEDULER - Invio periodico di messaggi promozionali
// SCHEDULER - Periodic promotional message broadcasting
// =============================================================================
//
// Invia un messaggio promozionale con GIF Pokemon a tutti gli utenti attivi
// ogni 3 ore. Gli utenti possono disabilitare le notifiche.
//
// Sends a promotional message with Pokemon GIF to all active users
// every 3 hours. Users can disable notifications.
// =============================================================================

import { bot } from "../bot/setup.js";
import { sessionStore } from "../storage/index.js";
import { buildBroadcastMessage } from "./promo.js";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Invia il messaggio promozionale a tutti gli utenti attivi con notifiche abilitate.
 * Broadcasts the promotional message to all active users with notifications enabled.
 */
async function broadcastPromo(): Promise<void> {
  const now = Date.now();
  const allSessions = sessionStore.getAll();

  const targets = allSessions.filter(
    (s) => s.notificationsEnabled && (now - s.lastActivity) < THIRTY_DAYS_MS
  );

  if (targets.length === 0) {
    console.log("[Scheduler] No active users to broadcast to");
    return;
  }

  console.log(`[Scheduler] Broadcasting to ${targets.length} users...`);
  const { caption, gif, keyboard } = buildBroadcastMessage();

  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (const session of targets) {
    try {
      await bot.api.sendAnimation(session.telegramUserId, gif, {
        caption,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
      sent++;
    } catch (error: any) {
      if (error?.error_code === 403) {
        // L'utente ha bloccato il bot
        // User blocked the bot
        blocked++;
        session.notificationsEnabled = false;
        sessionStore.save(session);
      } else {
        failed++;
      }
    }

    // Rispetta il rate limit di Telegram (~30 msg/sec)
    // Respect Telegram's rate limit (~30 msg/sec)
    if ((sent + failed + blocked) % 25 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(
    `[Scheduler] Broadcast done: ${sent} sent, ${failed} failed, ${blocked} blocked`
  );
}

/**
 * Avvia lo scheduler che invia messaggi promozionali ogni 3 ore.
 * Starts the scheduler that sends promotional messages every 3 hours.
 */
export function startScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  schedulerInterval = setInterval(() => {
    broadcastPromo().catch((err) =>
      console.error("[Scheduler] Broadcast error:", err)
    );
  }, THREE_HOURS_MS);

  console.log("[Scheduler] ✅ Promotional messages every 3 hours");
}

/**
 * Ferma lo scheduler.
 * Stops the scheduler.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Stopped");
  }
}
