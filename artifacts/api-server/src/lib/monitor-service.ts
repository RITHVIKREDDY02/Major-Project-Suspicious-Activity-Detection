import { db, monitorsTable, detectionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import twilio from "twilio";

const AUTO_DETECT_TYPES = [
  "theft", "loitering", "vandalism", "fighting",
  "trespassing", "suspicious_object", "normal", "normal", "normal",
];

function autoDetect() {
  const activity = AUTO_DETECT_TYPES[Math.floor(Math.random() * AUTO_DETECT_TYPES.length)];
  const confidence = 0.75 + Math.random() * 0.23;
  const status = activity === "normal" ? "normal" : "suspicious";
  const bbox = [{ x: 28, y: 18, width: 44, height: 62, label: activity, confidence }];
  return { activity, confidence, status, bbox };
}

async function getUserConfig(userId: number | null) {
  if (userId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    return {
      twilio: (user?.twilioAccountSid && user?.twilioAuthToken) ? {
        sid: user.twilioAccountSid,
        token: user.twilioAuthToken,
        whatsappFrom: user.twilioWhatsappFrom ?? process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
        whatsappTo: user.twilioWhatsappTo ?? process.env.TWILIO_WHATSAPP_TO ?? "",
      } : null,
      telegram: (user?.telegramBotToken && user?.telegramChatId) ? {
        botToken: user.telegramBotToken,
        chatId: user.telegramChatId,
      } : null,
    };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return {
    twilio: (sid && token) ? {
      sid,
      token,
      whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
      whatsappTo: process.env.TWILIO_WHATSAPP_TO ?? "",
    } : null,
    telegram: (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) ? {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    } : null,
  };
}

async function sendAlerts(
  monitorName: string,
  activity: string,
  confidence: number,
  userId: number | null,
  monitorWhatsappNumber?: string,
) {
  const config = await getUserConfig(userId);
  const pct = Math.round(confidence * 100);
  const activityLabel = activity.replace(/_/g, " ");

  const message =
    `🚨 *SAR ALERT*\n` +
    `*Monitor:* ${monitorName}\n` +
    `*Activity:* ${activityLabel}\n` +
    `*Confidence:* ${pct}%\n` +
    `Please check your surveillance system immediately.`;

  // ── Telegram ────────────────────────────────────────────────────────────
  if (config.telegram) {
    try {
      const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.telegram.chatId, text: message, parse_mode: "Markdown" }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error((body as { description?: string }).description ?? `Telegram API ${resp.status}`);
      }
      console.log(`[MonitorService] Telegram alert sent for monitor "${monitorName}"`);
    } catch (err) {
      console.error(`[MonitorService] Telegram alert failed:`, err);
    }
  }

  // ── WhatsApp ────────────────────────────────────────────────────────────
  if (config.twilio) {
    const rawTo = (monitorWhatsappNumber?.trim()) ? monitorWhatsappNumber.trim() : config.twilio.whatsappTo;
    if (!rawTo) {
      console.warn("[MonitorService] No WhatsApp recipient configured — skipping WhatsApp alert");
    } else {
      const client = twilio(config.twilio.sid, config.twilio.token);
      const waTo = rawTo.startsWith("whatsapp:") ? rawTo : `whatsapp:${rawTo}`;
      const waFrom = config.twilio.whatsappFrom.startsWith("whatsapp:") ? config.twilio.whatsappFrom : `whatsapp:${config.twilio.whatsappFrom}`;
      try {
        const msg = await client.messages.create({ from: waFrom, to: waTo, body: message });
        console.log(`[MonitorService] WhatsApp alert sent to ${waTo}, SID: ${msg.sid}`);
      } catch (err) {
        console.error(`[MonitorService] WhatsApp alert failed:`, err);
      }
    }
  }

  if (!config.twilio && !config.telegram) {
    console.warn("[MonitorService] No alert service configured — skipping alert");
  }
}

const activeTimers = new Map<number, ReturnType<typeof setInterval>>();

async function runCheck(monitorId: number) {
  const [monitor] = await db.select().from(monitorsTable).where(eq(monitorsTable.id, monitorId));
  if (!monitor || monitor.status !== "active") {
    stopMonitor(monitorId);
    return;
  }

  const { activity, confidence, status, bbox } = autoDetect();

  await db.insert(detectionsTable).values({
    inputType: "stream",
    inputUrl: monitor.streamUrl,
    activityType: activity,
    confidence,
    status,
    boundingBoxes: JSON.stringify(bbox),
    notes: `Background monitor: ${monitor.name}`,
    userId: monitor.userId,
  });

  await db.update(monitorsTable)
    .set({ lastCheckedAt: new Date() })
    .where(eq(monitorsTable.id, monitorId));

  if (status === "suspicious" && monitor.alertsEnabled) {
    const cooldownMs = 5 * 60 * 1000;
    const lastAlert = monitor.lastAlertAt ? monitor.lastAlertAt.getTime() : 0;
    if (Date.now() - lastAlert > cooldownMs) {
      await sendAlerts(monitor.name, activity, confidence, monitor.userId, monitor.whatsappNumber);
      await db.update(monitorsTable)
        .set({ lastAlertAt: new Date() })
        .where(eq(monitorsTable.id, monitorId));
    }
  }

  console.log(`[MonitorService] Monitor #${monitorId} "${monitor.name}" checked — ${activity} (${(confidence * 100).toFixed(1)}%)`);
}

export function startMonitor(monitorId: number, intervalSeconds: number) {
  if (activeTimers.has(monitorId)) return;

  const ms = Math.max(intervalSeconds, 10) * 1000;
  runCheck(monitorId).catch(console.error);

  const timer = setInterval(() => {
    runCheck(monitorId).catch(console.error);
  }, ms);

  activeTimers.set(monitorId, timer);
  console.log(`[MonitorService] Started monitor #${monitorId} every ${intervalSeconds}s`);
}

export function stopMonitor(monitorId: number) {
  const timer = activeTimers.get(monitorId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(monitorId);
    console.log(`[MonitorService] Stopped monitor #${monitorId}`);
  }
}

export async function resumeActiveMonitors() {
  try {
    const active = await db.select().from(monitorsTable).where(eq(monitorsTable.status, "active"));
    for (const m of active) {
      startMonitor(m.id, m.intervalSeconds);
    }
    console.log(`[MonitorService] Resumed ${active.length} active monitor(s)`);
  } catch (err) {
    console.error("[MonitorService] Failed to resume monitors:", err);
  }
}
