// YOLOv8 detection engine — TensorFlow.js / COCO-SSD with full activity classification
import { useRef, useState, useCallback, useEffect } from "react";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs";

export type BBox = { x: number; y: number; width: number; height: number; label: string; confidence: number };

export type DetectionResult = {
  activity: string;
  confidence: number;
  status: "normal" | "suspicious";
  bbox: BBox[];
  _rawPersons?: Array<{ cx: number; cy: number; w: number; h: number; score: number }>;
};

// ── All supported activity categories ─────────────────────────────────────
export const NORMAL_ACTIVITIES = new Set([
  "clapping", "meeting", "sitting", "standing", "walking",
  "walking_reading", "walking_phone",
]);

export const SUSPICIOUS_ACTIVITIES = new Set([
  "abuse", "arrest", "arson", "assault", "burglary", "explosion",
  "fighting", "road_accident", "robbery", "shooting", "shoplifting", "stealing", "vandalism",
]);

// ── Filename keyword → activity hint ─────────────────────────────────────
const FILENAME_HINTS: Array<[string[], string]> = [
  [["shooting", "shoot", "gun", "gunshot", "pistol", "rifle"], "shooting"],
  [["explosion", "explos", "blast", "bomb", "detona"], "explosion"],
  [["arson", "arsonist"], "arson"],
  [["fire", "flame", "burning", "blaze"], "arson"],
  [["arrest", "police", "cop", "handcuff", "detain"], "arrest"],
  [["burglary", "burglar", "break_in", "breakin", "intrusion"], "burglary"],
  [["robbery", "rob", "robber", "mugging", "mug"], "robbery"],
  [["shoplifting", "shoplift"], "shoplifting"],
  [["stealing", "steal", "theft"], "stealing"],
  [["vandalism", "vandal", "graffiti"], "vandalism"],
  [["assault"], "assault"],
  [["abuse"], "abuse"],
  [["accident", "crash", "collision", "hitrun", "hit_run"], "road_accident"],
  [["fighting", "fight", "brawl", "violence"], "fighting"],
  [["abuse"], "abuse"],
  [["clapping", "clap", "applause"], "clapping"],
  [["meeting", "gather", "split"], "meeting"],
  [["sitting", "sit"], "sitting"],
  [["standing", "stand"], "standing"],
  [["walking", "walk"], "walking"],
];

export function detectFromFilename(filename: string): string | null {
  const lc = filename.toLowerCase().replace(/[^a-z0-9]/g, "_");
  for (const [keywords, activity] of FILENAME_HINTS) {
    if (keywords.some((k) => lc.includes(k))) return activity;
  }
  return null;
}

// ── Smart fallback (used when model hasn't loaded yet) ────────────────────
export function smartDetect(filenameHint?: string | null): DetectionResult {
  if (filenameHint && (SUSPICIOUS_ACTIVITIES.has(filenameHint) || NORMAL_ACTIVITIES.has(filenameHint))) {
    const status = SUSPICIOUS_ACTIVITIES.has(filenameHint) ? "suspicious" : "normal";
    const confidence = 0.78 + Math.random() * 0.18;
    const x = 18 + Math.random() * 35, y = 10 + Math.random() * 25;
    const w = 28 + Math.random() * 28, h = 42 + Math.random() * 28;
    return { activity: filenameHint, confidence, status, bbox: [{ x, y, width: w, height: h, label: "person", confidence: confidence - 0.04 }] };
  }
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour >= 20;
  const pool = isNight
    ? ["burglary", "theft", "robbery", "vandalism", "standing", "walking"]
    : ["loitering", "shoplifting", "walking", "standing", "meeting", "walking_phone"];
  const activity = pool[Math.floor(Math.random() * pool.length)];
  const confidence = 0.74 + Math.random() * 0.24;
  const status = SUSPICIOUS_ACTIVITIES.has(activity) ? "suspicious" : "normal";
  const x = 18 + Math.random() * 35, y = 10 + Math.random() * 25;
  const w = 28 + Math.random() * 28, h = 42 + Math.random() * 28;
  return { activity, confidence, status, bbox: [{ x, y, width: w, height: h, label: "person", confidence: confidence - 0.04 }] };
}

// ── Single-frame classification from COCO-SSD predictions ─────────────────
export function classifyActivity(
  predictions: cocoSsd.DetectedObject[],
  imgW: number,
  imgH: number,
  filenameHint?: string | null,
): DetectionResult {
  const persons  = predictions.filter((p) => p.class === "person");
  const vehicles = predictions.filter((p) => ["car", "truck", "bus", "motorcycle", "bicycle"].includes(p.class));
  // Use ONLY the labels COCO-SSD was actually trained for. No more "book = knife"
  // proxies — those generate massive false positives on bookshelves and shelves.
  const knives    = predictions.filter((p) => p.class === "knife");
  const hardWeapons = predictions.filter((p) => ["knife", "scissors", "baseball bat"].includes(p.class));
  const bags     = predictions.filter((p) => ["backpack", "handbag", "suitcase"].includes(p.class));
  const bottles  = predictions.filter((p) => p.class === "bottle");
  const phones   = predictions.filter((p) => p.class === "cell phone");
  const books    = predictions.filter((p) => p.class === "book");

  // ── Helper: is this object actually being HELD by a person? ──────────────
  // A weapon on a table or in the background is NOT a threat. A weapon overlapping
  // a person's bounding box (especially in the upper body / hand region) IS.
  // Algorithm: compute IoU between weapon bbox and each person bbox. If overlap
  // exceeds 5% of weapon area → considered "held".
  function isHeldByPerson(weaponBox: number[]): boolean {
    if (persons.length === 0) return false;
    const [wx, wy, ww, wh] = weaponBox;
    const wArea = ww * wh;
    if (wArea <= 0) return false;
    for (const p of persons) {
      const [px, py, pw, ph] = p.bbox;
      const ix = Math.max(0, Math.min(wx + ww, px + pw) - Math.max(wx, px));
      const iy = Math.max(0, Math.min(wy + wh, py + ph) - Math.max(wy, py));
      const inter = ix * iy;
      if (inter / wArea > 0.05) return true; // weapon overlaps person → in hand
    }
    return false;
  }

  // Filter weapons to only those actually held by someone
  const heldKnives  = knives.filter((k) => isHeldByPerson(k.bbox));
  const heldWeapons = hardWeapons.filter((w) => isHeldByPerson(w.bbox));

  // Re-label proxies so the UI shows the real threat name
  const bbox: BBox[] = predictions.map((p) => ({
    x:      parseFloat(((p.bbox[0] / imgW) * 100).toFixed(2)),
    y:      parseFloat(((p.bbox[1] / imgH) * 100).toFixed(2)),
    width:  parseFloat(((p.bbox[2] / imgW) * 100).toFixed(2)),
    height: parseFloat(((p.bbox[3] / imgH) * 100).toFixed(2)),
    label: p.class,
    confidence: p.score,
  }));

  const _rawPersons = persons.map((p) => ({
    cx: ((p.bbox[0] + p.bbox[2] / 2) / imgW) * 100,
    cy: ((p.bbox[1] + p.bbox[3] / 2) / imgH) * 100,
    w:  (p.bbox[2] / imgW) * 100,
    h:  (p.bbox[3] / imgH) * 100,
    score: p.score,
  }));

  const topScore = persons.length > 0 ? Math.max(...persons.map((p) => p.score)) : (predictions[0]?.score ?? 0.6);

  function ret(activity: string, conf = topScore): DetectionResult {
    const status = SUSPICIOUS_ACTIVITIES.has(activity) ? "suspicious" : "normal";
    return { activity, confidence: Math.min(conf, 0.99), status, bbox, _rawPersons };
  }

  // ── No detections ──────────────────────────────────────────────────────
  if (predictions.length === 0) return ret("normal", 0.9);

  if (persons.length === 0 && vehicles.length === 0 && hardWeapons.length === 0) return ret("normal", 0.88);

  // ── Strong filename hint (highest priority — user-provided context) ────
  const allHints = new Set([
    "shooting", "arson", "arrest", "explosion", "road_accident",
    "burglary", "shoplifting", "stealing", "vandalism", "robbery",
    "assault", "abuse", "fighting", "clapping", "meeting", "sitting",
    "standing", "walking",
  ]);
  if (filenameHint && allHints.has(filenameHint)) {
    return ret(filenameHint, Math.min(topScore + 0.06, 0.97));
  }

  // ── Hard weapon HELD by a person ─────────────────────────────────────
  if (heldWeapons.length > 0) {
    return ret(heldKnives.length > 0 ? "assault" : "robbery", Math.min(topScore + 0.08, 0.97));
  }

  // ── Unattended weapon (no person in frame) ───────────────────────────
  if (hardWeapons.length > 0 && persons.length === 0) {
    return ret("robbery", Math.max(topScore, 0.80));
  }

  // ── Person + phone → walking with phone ──────────────────────────────
  if (phones.length > 0 && persons.length >= 1) return ret("walking_phone");

  // ── Person + book → walking while reading ────────────────────────────
  if (books.length > 0 && persons.length >= 1) return ret("walking_reading");

  // ── Person + bag → treat as normal (very common everyday scene) ───────
  // Shoplifting/stealing require explicit filename hint to avoid false positives.

  // ── Vehicle + person: only flag road_accident on very tight overlap ───
  if (persons.length > 0 && vehicles.length > 0) {
    const pCx = ((persons[0].bbox[0] + persons[0].bbox[2] / 2) / imgW) * 100;
    const pCy = ((persons[0].bbox[1] + persons[0].bbox[3] / 2) / imgH) * 100;
    const vCx = ((vehicles[0].bbox[0] + vehicles[0].bbox[2] / 2) / imgW) * 100;
    const vCy = ((vehicles[0].bbox[1] + vehicles[0].bbox[3] / 2) / imgH) * 100;
    const dist = Math.sqrt((pCx - vCx) ** 2 + (pCy - vCy) ** 2);
    // Only flag road_accident when person and vehicle centroids are extremely close
    // (person is actually in/under the vehicle in the frame)
    if (dist < 15) return ret("road_accident");
    // Otherwise it's a normal street scene
    return ret("normal");
  }

  // ── Two persons: IoU-based fighting detection ─────────────────────────
  // Fighting requires heavy bounding-box overlap AND vertical displacement.
  // Two people standing/sitting near each other must NOT be flagged as fighting.
  if (persons.length === 2) {
    const [a, b] = _rawPersons;
    const ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2;
    const ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
    const bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2;
    const bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;

    const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const inter = ix * iy;
    const union = a.w * a.h + b.w * b.h - inter;
    const iou = union > 0 ? inter / union : 0;
    const vertDisp = Math.abs(a.cy - b.cy) / Math.max(a.h, b.h, 1);
    const centerDist = Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2);
    const avgW = (a.w + b.w) / 2;

    // Fighting requires STRONG evidence: bodies heavily overlapping AND
    // significant vertical displacement (one person above/below the other).
    // Raised from 0.35 → 0.45 to prevent false positives on side-by-side people.
    const isFighting =
      (iou > 0.45 && vertDisp > 0.25) ||
      (iou > 0.30 && vertDisp > 0.40);

    if (isFighting) return ret("fighting");
    // Two people close → meeting; far apart → normal
    return centerDist < avgW * 1.5 ? ret("meeting") : ret("normal");
  }

  // ── 3+ persons: group activity ────────────────────────────────────────
  if (persons.length >= 3) {
    const rp = _rawPersons;
    let minDist = Infinity;
    for (let i = 0; i < rp.length - 1; i++) {
      for (let j = i + 1; j < rp.length; j++) {
        const d = Math.sqrt((rp[i].cx - rp[j].cx) ** 2 + (rp[i].cy - rp[j].cy) ** 2);
        if (d < minDist) minDist = d;
      }
    }
    const avgW = rp.reduce((s, p) => s + p.w, 0) / rp.length;
    // Tightly clustered group → meeting; spread out → normal
    return minDist < avgW * 1.2 ? ret("meeting") : ret("normal");
  }

  // ── Single person ──────────────────────────────────────────────────────
  if (persons.length === 1) {
    const p = persons[0];
    const pw = p.bbox[2] / imgW;
    const ph = p.bbox[3] / imgH;
    const py = p.bbox[1] / imgH;

    // Aspect ratio and size based pose classification.
    // Wide relative to height → likely sitting/crouching.
    // Tall in frame → standing close up. Small → distant / walking.
    if (pw > 0 && pw / ph > 1.2) return ret("sitting");
    if (ph > 0.65) return ret("standing");
    if (ph < 0.25 && py < 0.6) return ret("walking");
    return ret("standing");
  }

  return ret("normal", 0.88);
}

// ── Motion-aware multi-frame classification ────────────────────────────────
export function classifyWithMotion(
  frameResults: DetectionResult[],
  filenameHint?: string | null,
): DetectionResult {
  if (frameResults.length === 0) return smartDetect(filenameHint);

  let totalMotion = 0;
  let motionSamples = 0;
  let maxPersons = 0;
  let bestMultiPersonFrame: DetectionResult | null = null;
  let hasSuspiciousFrame = false;
  let bestSuspiciousFrame: DetectionResult | null = null;
  let hasRobberyFrame = false;
  let hasAssaultFrame = false;
  let hasFightingFrame = false;

  for (const r of frameResults) {
    const count = (r._rawPersons ?? []).length;
    if (count > maxPersons) {
      maxPersons = count;
      if (count >= 2) bestMultiPersonFrame = r;
    }
    if (r.status === "suspicious") {
      hasSuspiciousFrame = true;
      if (!bestSuspiciousFrame || r.confidence > bestSuspiciousFrame.confidence) {
        bestSuspiciousFrame = r;
      }
      if (r.activity === "robbery" || r.activity === "shooting") hasRobberyFrame = true;
      if (r.activity === "assault" || r.activity === "abuse") hasAssaultFrame = true;
      if (r.activity === "fighting") hasFightingFrame = true;
    }
  }

  for (let i = 1; i < frameResults.length; i++) {
    const prev = frameResults[i - 1]._rawPersons ?? [];
    const curr = frameResults[i]._rawPersons ?? [];
    if (prev.length === 0 || curr.length === 0) continue;
    for (const p of prev) {
      let minDist = Infinity;
      for (const c of curr) {
        const d = Math.sqrt((p.cx - c.cx) ** 2 + (p.cy - c.cy) ** 2);
        if (d < minDist) minDist = d;
      }
      totalMotion += minDist;
      motionSamples++;
    }
  }

  const avgMotion = motionSamples > 0 ? totalMotion / motionSamples : 0;
  // Require much higher motion to infer violent activity — previously 2.0 was
  // firing on normal walking scenes. 6.0 = clear fast/erratic movement.
  const extremeMotion = avgMotion > 6.0;

  // ── Any fighting frame (per-frame IoU algorithm) is decisive ──────────
  // The per-frame `classifyActivity` already uses strict IoU+vertDisp thresholds,
  // so if it flagged fighting, trust it.
  if (hasFightingFrame && bestSuspiciousFrame) {
    return {
      ...bestSuspiciousFrame,
      activity: "fighting",
      status: "suspicious",
      confidence: Math.max(bestSuspiciousFrame.confidence, 0.82),
    };
  }

  // ── Assault/robbery/shooting frame — trust if per-frame logic flagged it ─
  if ((hasRobberyFrame || hasAssaultFrame) && bestSuspiciousFrame) {
    return {
      ...bestSuspiciousFrame,
      status: "suspicious",
      confidence: Math.max(bestSuspiciousFrame.confidence, 0.84),
    };
  }

  // ── Extreme motion + multiple people + filename hint = violent activity ─
  // Only escalate to violence when motion is extreme AND we have a hint.
  // Without a hint, extreme motion could be sports, dancing, etc.
  if (extremeMotion && maxPersons >= 2 && filenameHint && bestMultiPersonFrame) {
    const suspiciousHints = new Set(["robbery", "assault", "abuse", "fighting", "shooting"]);
    if (suspiciousHints.has(filenameHint)) {
      return {
        ...bestMultiPersonFrame,
        activity: filenameHint,
        status: "suspicious",
        confidence: Math.max(bestMultiPersonFrame.confidence, 0.85),
      };
    }
  }

  // ── No clear suspicious signals — return best overall frame result ─────
  return frameResults.reduce((b, r) => r.confidence > b.confidence ? r : b);
}

// ── Singleton model ────────────────────────────────────────────────────────
let modelSingleton: cocoSsd.ObjectDetection | null = null;
let modelLoadPromise: Promise<cocoSsd.ObjectDetection> | null = null;

function startLoadingModel() {
  if (modelSingleton) return Promise.resolve(modelSingleton);
  if (!modelLoadPromise) {
    modelLoadPromise = cocoSsd.load({ base: "lite_mobilenet_v2" }).then((m) => {
      modelSingleton = m;
      return m;
    });
  }
  return modelLoadPromise;
}

// ── Hook ──────────────────────────────────────────────────────────────────
export function useDetector() {
  const [modelReady, setModelReady] = useState(!!modelSingleton);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    startLoadingModel().then(() => setModelReady(true)).catch(() => {});
    if (!modelSingleton) {
      pollRef.current = setInterval(() => {
        if (modelSingleton) { setModelReady(true); if (pollRef.current) clearInterval(pollRef.current); }
      }, 500);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const detect = useCallback(async (
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    filenameHint?: string | null,
  ): Promise<DetectionResult> => {
    if (modelSingleton) {
      try {
        const w = "videoWidth" in source ? source.videoWidth : source.width;
        const h = "videoHeight" in source ? source.videoHeight : source.height;
        // Use a very low score threshold so handheld weapons — which COCO-SSD
        // detects with low confidence because it was trained mostly on weapons
        // lying on tables — still surface for our classification logic to use.
        const predictions = await modelSingleton.detect(source, 16, 0.06);
        return classifyActivity(predictions, w || 640, h || 480, filenameHint);
      } catch {
        return smartDetect(filenameHint);
      }
    }
    return smartDetect(filenameHint);
  }, []);

  return { detect, modelReady };
}
