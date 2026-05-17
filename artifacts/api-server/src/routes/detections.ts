import { Router, type IRouter } from "express";
import { db, detectionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  CreateDetectionBody,
  GetDetectionParams,
  DeleteDetectionParams,
  ListDetectionsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/detections", async (req, res): Promise<void> => {
  const params = ListDetectionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  let query = db.select().from(detectionsTable);
  const results = await query.orderBy(desc(detectionsTable.createdAt));

  let filtered = results;
  if (params.data.userId) {
    filtered = filtered.filter((d) => d.userId === params.data.userId);
  }
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

  const [detection] = await db.insert(detectionsTable).values({
    userId: parsed.data.userId ?? null,
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

  const [detection] = await db
    .select()
    .from(detectionsTable)
    .where(eq(detectionsTable.id, params.data.id));

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

  const [detection] = await db
    .delete(detectionsTable)
    .where(eq(detectionsTable.id, params.data.id))
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
