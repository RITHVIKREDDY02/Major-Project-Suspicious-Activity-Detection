import { Router, type IRouter } from "express";
import { db, monitorsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { startMonitor, stopMonitor } from "../lib/monitor-service.js";

const router: IRouter = Router();

function getSessionUserId(req: Parameters<Parameters<typeof router.get>[1]>[0]): number | null {
  return ((req.session as Record<string, unknown>)?.userId as number) ?? null;
}

router.get("/monitors", async (req, res): Promise<void> => {
  const sessionUserId = getSessionUserId(req);
  const monitors = sessionUserId !== null
    ? await db.select().from(monitorsTable).where(eq(monitorsTable.userId, sessionUserId)).orderBy(monitorsTable.createdAt)
    : await db.select().from(monitorsTable).orderBy(monitorsTable.createdAt);
  res.json(monitors);
});

router.post("/monitors", async (req, res): Promise<void> => {
  const { name, streamUrl, whatsappNumber, intervalSeconds, alertsEnabled } = req.body;
  if (!name || !streamUrl || !whatsappNumber) {
    res.status(400).json({ error: "name, streamUrl, and whatsappNumber are required" });
    return;
  }

  const userId = getSessionUserId(req);

  const [monitor] = await db.insert(monitorsTable).values({
    name,
    streamUrl,
    whatsappNumber,
    intervalSeconds: intervalSeconds ?? 30,
    alertsEnabled: alertsEnabled ?? true,
    status: "stopped",
    userId: userId ?? null,
  }).returning();

  res.status(201).json(monitor);
});

router.patch("/monitors/:id/start", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const sessionUserId = getSessionUserId(req);
  const whereClause = sessionUserId !== null
    ? and(eq(monitorsTable.id, id), eq(monitorsTable.userId, sessionUserId))
    : eq(monitorsTable.id, id);

  const [monitor] = await db.select().from(monitorsTable).where(whereClause);
  if (!monitor) { res.status(404).json({ error: "Monitor not found" }); return; }

  await db.update(monitorsTable).set({ status: "active" }).where(eq(monitorsTable.id, id));
  startMonitor(id, monitor.intervalSeconds);

  res.json({ ...monitor, status: "active" });
});

router.patch("/monitors/:id/stop", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const sessionUserId = getSessionUserId(req);
  const whereClause = sessionUserId !== null
    ? and(eq(monitorsTable.id, id), eq(monitorsTable.userId, sessionUserId))
    : eq(monitorsTable.id, id);

  const [monitor] = await db.select().from(monitorsTable).where(whereClause);
  if (!monitor) { res.status(404).json({ error: "Monitor not found" }); return; }

  stopMonitor(id);
  await db.update(monitorsTable).set({ status: "stopped" }).where(eq(monitorsTable.id, id));

  res.json({ ...monitor, status: "stopped" });
});

router.delete("/monitors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const sessionUserId = getSessionUserId(req);
  const whereClause = sessionUserId !== null
    ? and(eq(monitorsTable.id, id), eq(monitorsTable.userId, sessionUserId))
    : eq(monitorsTable.id, id);

  const [monitor] = await db.select().from(monitorsTable).where(whereClause);
  if (!monitor) { res.status(404).json({ error: "Monitor not found" }); return; }

  stopMonitor(id);
  await db.delete(monitorsTable).where(eq(monitorsTable.id, id));
  res.json({ message: "Monitor deleted" });
});

router.patch("/monitors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const sessionUserId = getSessionUserId(req);
  const whereClause = sessionUserId !== null
    ? and(eq(monitorsTable.id, id), eq(monitorsTable.userId, sessionUserId))
    : eq(monitorsTable.id, id);

  const { name, streamUrl, whatsappNumber, intervalSeconds, alertsEnabled } = req.body;

  const [existing] = await db.select().from(monitorsTable).where(whereClause);
  if (!existing) { res.status(404).json({ error: "Monitor not found" }); return; }

  const [updated] = await db.update(monitorsTable).set({
    ...(name !== undefined && { name }),
    ...(streamUrl !== undefined && { streamUrl }),
    ...(whatsappNumber !== undefined && { whatsappNumber }),
    ...(intervalSeconds !== undefined && { intervalSeconds }),
    ...(alertsEnabled !== undefined && { alertsEnabled }),
  }).where(eq(monitorsTable.id, id)).returning();

  res.json(updated);
});

export default router;
