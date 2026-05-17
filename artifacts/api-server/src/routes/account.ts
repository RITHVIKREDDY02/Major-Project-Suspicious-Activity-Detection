import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";

const router: IRouter = Router();

function hashPassword(password: string): string {
  return createHash("sha256").update(password + "sar-detection-salt").digest("hex");
}

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req.session as Record<string, unknown>)?.userId as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  (req as Request & { userId: number }).userId = userId;
  next();
}

router.use("/account", requireAuth);

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
    twilio: {
      accountSid: user.twilioAccountSid ?? "",
      authToken: user.twilioAuthToken ? "••••••••" : "",
      whatsappFrom: user.twilioWhatsappFrom ?? "",
      whatsappTo: user.twilioWhatsappTo ?? "",
      phoneFrom: user.twilioPhoneFrom ?? "",
      alertTo: user.twilioAlertTo ?? "",
      configured: !!(user.twilioAccountSid && user.twilioAuthToken),
    },
    telegram: {
      botToken: user.telegramBotToken ? "••••••••" : "",
      chatId: user.telegramChatId ?? "",
      configured: !!(user.telegramBotToken && user.telegramChatId),
    },
  };
}

router.get("/account/profile", async (req, res): Promise<void> => {
  const userId = (req as Request & { userId: number }).userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatUser(user));
});

router.patch("/account/profile", async (req, res): Promise<void> => {
  const userId = (req as Request & { userId: number }).userId;
  const { fullName, username } = req.body;

  if (username) {
    const existing = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (existing.length > 0 && existing[0].id !== userId) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      ...(fullName !== undefined && { fullName }),
      ...(username !== undefined && { username }),
    })
    .where(eq(usersTable.id, userId))
    .returning();

  res.json(formatUser(updated));
});

router.patch("/account/password", async (req, res): Promise<void> => {
  const userId = (req as Request & { userId: number }).userId;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.passwordHash !== hashPassword(currentPassword)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  await db.update(usersTable).set({ passwordHash: hashPassword(newPassword) }).where(eq(usersTable.id, userId));
  res.json({ message: "Password updated successfully" });
});

router.patch("/account/twilio", async (req, res): Promise<void> => {
  const userId = (req as Request & { userId: number }).userId;
  const { accountSid, authToken, whatsappFrom, whatsappTo, phoneFrom, alertTo } = req.body;

  const updateData: Record<string, string | null> = {};
  if (accountSid !== undefined) updateData.twilioAccountSid = accountSid || null;
  if (authToken !== undefined && authToken !== "••••••••") updateData.twilioAuthToken = authToken || null;
  if (whatsappFrom !== undefined) updateData.twilioWhatsappFrom = whatsappFrom || null;
  if (whatsappTo !== undefined) updateData.twilioWhatsappTo = whatsappTo || null;
  if (phoneFrom !== undefined) updateData.twilioPhoneFrom = phoneFrom || null;
  if (alertTo !== undefined) updateData.twilioAlertTo = alertTo || null;

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, userId))
    .returning();

  res.json(formatUser(updated));
});

router.patch("/account/telegram", async (req, res): Promise<void> => {
  const userId = (req as Request & { userId: number }).userId;
  const { botToken, chatId } = req.body;

  const updateData: Record<string, string | null> = {};
  if (botToken !== undefined && botToken !== "••••••••") updateData.telegramBotToken = botToken || null;
  if (chatId !== undefined) updateData.telegramChatId = chatId || null;

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, userId))
    .returning();

  res.json(formatUser(updated));
});

export default router;
