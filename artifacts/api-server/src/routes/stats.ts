import { Router, type IRouter } from "express";
import { db, detectionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { GetRecentActivityQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats/summary", async (_req, res): Promise<void> => {
  const all = await db.select().from(detectionsTable);

  const totalDetections = all.length;
  const suspiciousCount = all.filter((d) => d.status === "suspicious").length;
  const normalCount = all.filter((d) => d.status === "normal").length;
  const pendingCount = all.filter((d) => d.status === "pending").length;

  const withConfidence = all.filter((d) => d.confidence !== null);
  const avgConfidence =
    withConfidence.length > 0
      ? withConfidence.reduce((sum, d) => sum + (d.confidence ?? 0), 0) / withConfidence.length
      : 0;

  res.json({
    totalDetections,
    suspiciousCount,
    normalCount,
    pendingCount,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
  });
});

router.get("/stats/activity-breakdown", async (_req, res): Promise<void> => {
  const all = await db.select().from(detectionsTable);

  const counts: Record<string, number> = {};
  for (const d of all) {
    const type = d.activityType ?? "unknown";
    counts[type] = (counts[type] ?? 0) + 1;
  }

  const total = all.length || 1;
  const breakdown = Object.entries(counts).map(([activityType, count]) => ({
    activityType,
    count,
    percentage: Math.round((count / total) * 1000) / 10,
  }));

  breakdown.sort((a, b) => b.count - a.count);

  res.json(breakdown);
});

router.get("/stats/recent-activity", async (req, res): Promise<void> => {
  const params = GetRecentActivityQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 10;

  const recent = await db
    .select()
    .from(detectionsTable)
    .orderBy(desc(detectionsTable.createdAt))
    .limit(limit);

  res.json(
    recent.map((d) => ({
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
    }))
  );
});

export default router;
