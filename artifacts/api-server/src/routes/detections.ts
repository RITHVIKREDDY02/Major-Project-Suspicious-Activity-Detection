import { Router, type IRouter } from "express";
import { db, detectionsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  CreateDetectionBody,
  GetDetectionParams,
  DeleteDetectionParams,
  ListDetectionsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getSessionUserId(req: Parameters<Parameters<typeof router.get>[1]>[0]): number | null {
  return ((req.session as Record<string, unknown>)?.userId as number) ?? null;
}

router.get("/detections", async (req, res): Promise<void> => {
  const params = ListDetectionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const sessionUserId = getSessionUserId(req);

  const results = await db
    .select()
    .from(detectionsTable)
    .where(sessionUserId !== null ? eq(detectionsTable.userId, sessionUserId) : undefined)
    .orderBy(desc(detectionsTable.createdAt));

  let filtered = results;
  if (params.data.activityType) {
    filtered = filtered.filter((d) => d.activityType === params.data.activityType);
  }
  if (params.data.limit) {
    filtered = filtered.slice(0, params.data.limit);
  }

  res.json(filtered.map(formatDetection));
});

router.post("/detections", async (req, res): Promise<void> => {
  const parsed = CreateDetectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const sessionUserId = getSessionUserId(req);

  const [detection] = await db.insert(detectionsTable).values({
    userId: sessionUserId ?? parsed.data.userId ?? null,
    inputType: parsed.data.inputType,
    inputUrl: parsed.data.inputUrl ?? null,
    inputFilename: parsed.data.inputFilename ?? null,
    activityType: parsed.data.activityType ?? null,
    confidence: parsed.data.confidence ?? null,
    status: parsed.data.status,
    boundingBoxes: parsed.data.boundingBoxes ?? null,
    processedImageUrl: parsed.data.processedImageUrl ?? null,
    notes: parsed.data.notes ?? null,
  }).returning();

  res.status(201).json(formatDetection(detection));
});

router.get("/detections/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetDetectionParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const sessionUserId = getSessionUserId(req);

  const whereClause = sessionUserId !== null
    ? and(eq(detectionsTable.id, params.data.id), eq(detectionsTable.userId, sessionUserId))
    : eq(detectionsTable.id, params.data.id);

  const [detection] = await db
    .select()
    .from(detectionsTable)
    .where(whereClause);

  if (!detection) {
    res.status(404).json({ error: "Detection not found" });
    return;
  }

  res.json(formatDetection(detection));
});

router.delete("/detections/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteDetectionParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const sessionUserId = getSessionUserId(req);

  const whereClause = sessionUserId !== null
    ? and(eq(detectionsTable.id, params.data.id), eq(detectionsTable.userId, sessionUserId))
    : eq(detectionsTable.id, params.data.id);

  const [detection] = await db
    .delete(detectionsTable)
    .where(whereClause)
    .returning();

  if (!detection) {
    res.status(404).json({ error: "Detection not found" });
    return;
  }

  res.sendStatus(204);
});

function formatDetection(d: typeof detectionsTable.$inferSelect) {
  return {
    id: d.id,
    userId: d.userId,
    inputType: d.inputType,
    inputUrl: d.inputUrl,
    inputFilename: d.inputFilename,
    activityType: d.activityType,
    confidence: d.confidence,
    status: d.status,
    boundingBoxes: d.boundingBoxes,
    processedImageUrl: d.processedImageUrl,
    notes: d.notes,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export default router;
