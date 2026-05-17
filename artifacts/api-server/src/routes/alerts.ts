import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import twilio from "twilio";

const router = Router();

async function getAlertConfigs(userId: number | null) {
  if (userId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    return {
      twilio: (user?.twilioAccountSid && user?.twilioAuthToken) ? {
        sid: user.twilioAccountSid,
        token: user.twilioAuthToken,
        whatsappFrom: user.twilioWhatsappFrom ?? process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
        whatsappTo: user.twilioWhatsappTo ?? process.env.TWILIO_WHATSAPP_TO ?? "",
        phoneFrom: user.twilioPhoneFrom ?? process.env.TWILIO_PHONE_FROM ?? "",
        alertTo: user.twilioAlertTo ?? process.env.TWILIO_ALERT_TO ?? "",
      } : null,
      telegram: (user?.telegramBotToken && user?.telegramChatId) ? {
        botToken: user.telegramBotToken,
        chatId: user.telegramChatId,
      } : null,
    };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return {
    twilio: (sid && token) ? {
      sid,
      token,
      whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
      whatsappTo: process.env.TWILIO_WHATSAPP_TO ?? "",
      phoneFrom: process.env.TWILIO_PHONE_FROM ?? "",
      alertTo: process.env.TWILIO_ALERT_TO ?? "",
    } : null,
    telegram: (botToken && chatId) ? { botToken, chatId } : null,
  };
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error((body as { description?: string }).description ?? `Telegram API error ${resp.status}`);
  }
  return resp.json();
}

router.post("/alerts/call", async (req, res) => {
  const { activity = "suspicious activity", confidence = 0, source = "Camera Test" } = req.body ?? {};
  const pct = Math.round(Number(confidence) * 100);
  const activityLabel = String(activity).replace(/_/g, " ");

  const userId = (req.session as Record<string, unknown>)?.userId as number | null ?? null;

  const { twilio: twilioConfig, telegram: telegramConfig } = await getAlertConfigs(userId);

  if (!twilioConfig && !telegramConfig) {
    console.log(`[Alerts] SIMULATED — no alert service configured. Activity: ${activityLabel} (${pct}%) from ${source}`);
    return res.json({ ok: true, simulated: true });
  }

  const message =
    `🚨 *SAR ALERT*\n` +
    `*Activity:* ${activityLabel}\n` +
    `*Confidence:* ${pct}%\n` +
    `*Source:* ${source}\n` +
    `Please check your surveillance system immediately.`;

  const results: { whatsapp?: string; call?: string; telegram?: boolean; errors: string[] } = { errors: [] };

  // ── Telegram ─────────────────────────────────────────────────────────────
  if (telegramConfig) {
    try {
      await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, message);
      console.log(`[Alerts] Telegram message sent to chat ${telegramConfig.chatId}`);
      results.telegram = true;
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      console.error("[Alerts] Telegram failed:", raw);
      results.errors.push(`Telegram: ${raw}`);
    }
  }

  // ── WhatsApp message ─────────────────────────────────────────────────────
  if (twilioConfig) {
    const client = twilio(twilioConfig.sid, twilioConfig.token);
    const waTo   = twilioConfig.whatsappTo;
    const waFrom = twilioConfig.whatsappFrom.startsWith("whatsapp:") ? twilioConfig.whatsappFrom : `whatsapp:${twilioConfig.whatsappFrom}`;

    if (waTo) {
      const toFormatted = waTo.startsWith("whatsapp:") ? waTo : `whatsapp:${waTo}`;
      try {
        const msg = await client.messages.create({ from: waFrom, to: toFormatted, body: message });
        console.log(`[Alerts] WhatsApp sent to ${toFormatted}, SID: ${msg.sid}`);
        results.whatsapp = msg.sid;
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err);
        let friendly = raw;
        if (raw.includes("unverified") || raw.includes("not a valid")) {
          friendly = "WhatsApp recipient not verified. Send 'join <keyword>' to +14155238886 on WhatsApp first.";
        } else if (raw.includes("Channel with the specified From")) {
          friendly = "WhatsApp sender not configured. Make sure the recipient has joined the sandbox.";
        }
        console.error("[Alerts] WhatsApp failed:", raw);
        results.errors.push(friendly);
      }
    }

    // ── Voice call ───────────────────────────────────────────────────────────
    const callFrom = twilioConfig.phoneFrom;
    const callTo   = twilioConfig.alertTo;

    if (callFrom && callTo) {
      const callMessage =
        `Alert from your surveillance system. ` +
        `Source: ${source}. ` +
        `Detected: ${activityLabel}. ` +
        `Confidence: ${pct} percent. ` +
        `Please check your camera immediately.`;
      const twiml = `<Response><Say voice="alice">${callMessage}</Say></Response>`;
      try {
        const call = await client.calls.create({ from: callFrom, to: callTo, twiml });
        console.log(`[Alerts] Voice call sent to ${callTo}, SID: ${call.sid}`);
        results.call = call.sid;
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err);
        let friendly = raw;
        if (raw.includes("unverified") || raw.includes("Trial accounts")) {
          friendly = "Voice call failed: Twilio trial accounts can only call verified numbers.";
        }
        console.error("[Alerts] Voice call failed:", raw);
        results.errors.push(friendly);
      }
    }
  }

  if (!results.whatsapp && !results.call && !results.telegram) {
    if (results.errors.length > 0) {
      return res.status(500).json({ error: results.errors.join(" | ") });
    }
    return res.json({ ok: true, simulated: true });
  }

  return res.json({ ok: true, ...results });
});

export default router;
