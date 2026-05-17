import { useState, useEffect, useRef, useCallback } from "react";
import { useCreateDetection, getListDetectionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useDetector, type BBox } from "@/hooks/use-detector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Radio, ScanLine, Eye, Activity, AlertTriangle, CheckCircle,
  Link as LinkIcon, RotateCcw, Cpu, Loader2, Flame, Swords, ShieldAlert, UserX, Package,
} from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── User-facing categories ─────────────────────────────────────────────
type Category = "normal" | "fighting" | "fire" | "threat" | "thief" | "theft";

const CATEGORY_META: Record<Category, { label: string; color: string; icon: typeof Flame; suspicious: boolean }> = {
  normal:   { label: "Normal Activity",           color: "#22c55e", icon: CheckCircle,  suspicious: false },
  fighting: { label: "Fighting / Violence",        color: "#f97316", icon: Swords,        suspicious: true  },
  fire:     { label: "Fire / Explosion",           color: "#ea580c", icon: Flame,         suspicious: true  },
  threat:   { label: "Weapon Threat",              color: "#dc2626", icon: ShieldAlert,   suspicious: true  },
  thief:    { label: "Suspicious Person",          color: "#9333ea", icon: UserX,         suspicious: true  },
  theft:    { label: "Possible Theft (Object Missing)", color: "#b45309", icon: Package,  suspicious: true  },
};

type LiveResult = {
  category: Category;
  confidence: number;
  bbox: BBox[];
  reason: string;
  ts: number;
};

// ── LAN IP detector — must be served direct from browser, not via server proxy ──
function isLanUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const a = +m[1], b = +m[2];
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch { return false; }
}

// IP Webcam (Android) and most cameras expose a single JPEG snapshot endpoint.
// Snapshots can be re-fetched with a cache buster to drive a smooth live preview
// AND can be drawn into a canvas with crossOrigin to read pixels for inference.
function buildSnapshotUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  // If user already gave a snapshot/MJPEG path, use it as-is
  if (/\.(jpg|jpeg|png)(\?|$)/i.test(trimmed)) return trimmed;
  if (/\/(shot\.jpg|video|videofeed|mjpg|mjpeg)(\?|$)/i.test(trimmed)) return trimmed;
  // Default: IP Webcam style
  return `${trimmed}/shot.jpg`;
}

// ── Color-based fire / explosion detector ──────────────────────────────
// Real flames have a distinct signature: high R, moderate G, very low B,
// and high luminance. We sample the frame at a coarse grid for speed.
function detectFire(canvas: HTMLCanvasElement): { isFire: boolean; ratio: number; bbox: BBox | null } {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { isFire: false, ratio: 0, bbox: null };
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return { isFire: false, ratio: 0, bbox: null };
  }
  const { data: px, width: W, height: H } = data;
  const step = 2;
  // We track hot-core (almost-white-yellow) and warm (orange/red) separately,
  // and only flag fire when BOTH appear AND the hot core sits inside the warm
  // region — that's the actual signature of flame vs painted walls / sunset.
  let warmPixels = 0, hotCorePixels = 0, total = 0;
  let cMinX = W, cMinY = H, cMaxX = 0, cMaxY = 0; // hot-core bbox
  let wMinX = W, wMinY = H, wMaxX = 0, wMaxY = 0; // warm bbox
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      total++;
      // Hot core: nearly white-yellow, very bright, almost no blue.
      // Painted walls / wood NEVER reach this saturation.
      const isHotCore =
        r > 245 && g > 210 && b < 150 &&
        (r - b) > 110 && (g - b) > 70 && r >= g;
      // Warm halo: saturated orange/red, distinctly brighter than surroundings
      const isWarm =
        r > 200 && r > g + 35 && g > b + 25 && b < 130 &&
        (r + g + b) > 380 && (r - b) > 90;
      if (isWarm) {
        warmPixels++;
        if (x < wMinX) wMinX = x; if (x > wMaxX) wMaxX = x;
        if (y < wMinY) wMinY = y; if (y > wMaxY) wMaxY = y;
      }
      if (isHotCore) {
        hotCorePixels++;
        if (x < cMinX) cMinX = x; if (x > cMaxX) cMaxX = x;
        if (y < cMinY) cMinY = y; if (y > cMaxY) cMaxY = y;
      }
    }
  }
  const ratio = total > 0 ? warmPixels / total : 0;
  const coreRatio = total > 0 ? hotCorePixels / total : 0;
  const coreW = cMaxX - cMinX, coreH = cMaxY - cMinY;
  const warmW = wMaxX - wMinX, warmH = wMaxY - wMinY;

  // Hot core must exist inside (or overlapping) the warm region — flame structure
  const coreInsideWarm =
    hotCorePixels > 0 && warmPixels > 0 &&
    cMinX >= wMinX - 4 && cMaxX <= wMaxX + 4 &&
    cMinY >= wMinY - 4 && cMaxY <= wMaxY + 4;

  // Tight conditions:
  //  • Real fire: ≥0.5% warm AND ≥0.05% hot core, structurally nested
  //  • OR a sizeable blaze: ≥3% of frame is warm AND a hot core exists
  const isFire =
    (coreInsideWarm && ratio > 0.005 && coreRatio > 0.0005 && coreW > 3 && coreH > 3) ||
    (ratio > 0.03 && hotCorePixels > 0 && warmW > 20 && warmH > 20);

  if (!isFire) return { isFire, ratio, bbox: null };
  return {
    isFire,
    ratio,
    bbox: {
      x: (minX / W) * 100,
      y: (minY / H) * 100,
      width: ((maxX - minX) / W) * 100,
      height: ((maxY - minY) / H) * 100,
      label: "fire",
      confidence: Math.min(0.6 + ratio * 6, 0.97),
    },
  };
}

// ── Face-covered detector ──────────────────────────────────────────────
// Look at the head region (top ~22%) of the largest person bbox and count
// pixels that look like skin. If a "person" bbox is large enough that a face
// should be visible but almost no skin tone is found, the face is likely
// covered by a mask / monkey cap / helmet.
function isFaceCovered(canvas: HTMLCanvasElement, personBox: BBox): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const W = canvas.width, H = canvas.height;
  const px0 = Math.max(0, Math.floor((personBox.x / 100) * W));
  const py0 = Math.max(0, Math.floor((personBox.y / 100) * H));
  const pw = Math.min(W - px0, Math.ceil((personBox.width  / 100) * W));
  const ph = Math.min(H - py0, Math.ceil((personBox.height / 100) * H));
  if (pw < 30 || ph < 60) return false; // person too small / far → can't tell
  // Head region: top 22% of person bbox, central 60% horizontally
  const hx = px0 + Math.floor(pw * 0.20);
  const hy = py0 + Math.floor(ph * 0.02);
  const hw = Math.floor(pw * 0.60);
  const hh = Math.floor(ph * 0.22);
  if (hw < 10 || hh < 10) return false;
  let data: ImageData;
  try {
    data = ctx.getImageData(hx, hy, hw, hh);
  } catch {
    return false;
  }
  const px = data.data;
  let skin = 0, total = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    total++;
    // Loose skin-tone test covering all skin colours
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (
      r > 60 && g > 35 && b > 20 &&
      max - min > 12 &&
      r > g && r > b &&
      Math.abs(r - g) > 8
    ) skin++;
  }
  if (total === 0) return false;
  return skin / total < 0.06; // <6% skin pixels in face region → covered
}

// ── Check if two person bboxes are physically close to each other ──────
function personsAreClose(boxes: BBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const aCx = a.x + a.width / 2, aCy = a.y + a.height / 2;
      const bCx = b.x + b.width / 2, bCy = b.y + b.height / 2;
      const dist = Math.sqrt((aCx - bCx) ** 2 + (aCy - bCy) ** 2);
      if (dist < 28) return true; // within 28% of frame → physically close
    }
  }
  return false;
}

// ── Multi-signal scoring detection engine ──────────────────────────────
// Each signal contributes points. Only when multiple signals combine and
// cross a threshold does the system flag an alert — reducing false positives.
function toUserCategory(args: {
  rawActivity: string;
  rawConfidence: number;
  rawBbox: BBox[];
  fire: { isFire: boolean; ratio: number; bbox: BBox | null };
  motionLevel: number;
  weaponPresent: boolean;
  faceCoveredPersonBbox: BBox | null;
  loiteringFrames: number;
  missingValuable: string | null;
}): LiveResult {
  const {
    rawActivity, rawConfidence, rawBbox, fire,
    motionLevel, weaponPresent, faceCoveredPersonBbox,
    loiteringFrames, missingValuable,
  } = args;

  const reliableBoxes = rawBbox.filter(b =>
    b.label === "person" ? b.confidence >= 0.38 : b.confidence >= 0.28
  );
  const personBoxes = reliableBoxes.filter(b => b.label === "person");
  const persons = personBoxes.length;

  // ── 1. Fire — top priority, purely pixel-based ──────────────────────
  if (fire.isFire) {
    return {
      category: "fire",
      confidence: Math.min(0.65 + fire.ratio * 5, 0.97),
      bbox: fire.bbox ? [fire.bbox] : rawBbox,
      reason: `Flame detected on ${(fire.ratio * 100).toFixed(1)}% of frame`,
      ts: Date.now(),
    };
  }

  // ── 2. Theft — object was present, now gone ──────────────────────────
  if (missingValuable) {
    return {
      category: "theft",
      confidence: 0.78,
      bbox: rawBbox,
      reason: `${missingValuable} present then disappeared — possible theft`,
      ts: Date.now(),
    };
  }

  // ── 3. Weapon threat — multi-signal score ───────────────────────────
  // Weapon alone = very high signal (weapon in any public view is concerning)
  // Weapon + person = definitive
  let threatScore = 0;
  if (weaponPresent) threatScore += 80;
  if (weaponPresent && persons >= 1) threatScore += 15;
  if (threatScore >= 80) {
    const signals: string[] = [];
    if (weaponPresent) signals.push("weapon visible");
    if (persons >= 1) signals.push(`${persons} person${persons > 1 ? "s" : ""} in frame`);
    return {
      category: "threat",
      confidence: Math.min(0.75 + threatScore / 500, 0.96),
      bbox: rawBbox,
      reason: signals.join(" + "),
      ts: Date.now(),
    };
  }

  // ── 4. Suspicious person — MUST combine multiple signals ────────────
  // Face covering alone (mask, hood, monkey cap) is NOT suspicious.
  // Running alone is NOT suspicious.
  // Only combinations trigger this.
  let thiefScore = 0;
  const signals: string[] = [];
  if (faceCoveredPersonBbox) { thiefScore += 35; signals.push("face concealed"); }
  if (motionLevel > 7)       { thiefScore += 30; signals.push("erratic/fast movement"); }
  else if (motionLevel > 4)  { thiefScore += 15; signals.push("unusual movement"); }
  if (loiteringFrames > 20)  { thiefScore += 25; signals.push("loitering"); }
  else if (loiteringFrames > 10) { thiefScore += 10; }
  if (persons === 1)         { thiefScore +=  5; }

  // Threshold = 55: requires at least 2 meaningful signals
  // e.g. face covered (35) + erratic movement (30) = 65 ✓
  //      face covered (35) + loitering 20+ frames (25) = 60 ✓
  //      running alone (30) = 30 ✗
  //      mask alone (35) = 35 ✗
  if (thiefScore >= 55 && persons >= 1) {
    return {
      category: "thief",
      confidence: Math.min(0.60 + thiefScore / 250, 0.92),
      bbox: rawBbox,
      reason: signals.join(" + "),
      ts: Date.now(),
    };
  }

  // ── 5. Fighting / violence — multi-signal score ─────────────────────
  // Group standing calmly together is NORMAL.
  // Only physical aggression (high motion + proximity) flags fighting.
  let fightScore = 0;
  const fightSignals: string[] = [];
  if (persons >= 2)                          { fightScore += 20; fightSignals.push(`${persons} people`); }
  if (persons >= 2 && motionLevel > 5)       { fightScore += 30; fightSignals.push("aggressive motion"); }
  if (persons >= 2 && motionLevel > 9)       { fightScore += 20; fightSignals.push("violent motion"); }
  if (persons >= 2 && personsAreClose(personBoxes)) { fightScore += 20; fightSignals.push("physical contact range"); }

  // Threshold = 65: needs people + high motion + proximity
  // 2 people calmly standing (20) ✗
  // 2 people + motion (20+30=50) ✗ — not enough alone
  // 2 people + motion + close (20+30+20=70) ✓
  // 2 people + violent motion + close (20+30+20+20=90) = definite fight
  if (fightScore >= 65) {
    return {
      category: "fighting",
      confidence: Math.min(0.65 + fightScore / 300, 0.94),
      bbox: rawBbox,
      reason: fightSignals.join(" + "),
      ts: Date.now(),
    };
  }

  // ── 6. Normal — default for everything else ─────────────────────────
  const fireClasses = new Set(["arson", "explosion"]);
  const fightingClasses = new Set(["fighting", "assault", "abuse"]);
  if (fireClasses.has(rawActivity)) {
    return { category: "fire", confidence: rawConfidence, bbox: rawBbox, reason: `Detected ${rawActivity}`, ts: Date.now() };
  }
  if (fightingClasses.has(rawActivity) && persons >= 2) {
    return { category: "fighting", confidence: rawConfidence, bbox: rawBbox, reason: `Detected ${rawActivity}`, ts: Date.now() };
  }

  return {
    category: "normal",
    confidence: Math.max(rawConfidence, 0.70),
    bbox: rawBbox,
    reason:
      persons >= 2 ? `${persons} people — calm interaction, no threat`
      : persons === 1 ? "1 person — no threat detected"
      : "Scene clear",
    ts: Date.now(),
  };
}

// ── Bounding-box overlay on top of the live <img> ─────────────────────
function LiveOverlay({ result }: { result: LiveResult | null }) {
  if (!result) return null;
  const meta = CATEGORY_META[result.category];
  return (
    <>
      {result.bbox.map((box, i) => {
        const boxColor = box.label === "person"
          ? meta.color
          : (box.label === "fire" ? "#ea580c" : "#f59e0b");
        return (
          <div
            key={i}
            className="absolute border-2 pointer-events-none"
            style={{
              top: `${box.y}%`, left: `${box.x}%`,
              width: `${box.width}%`, height: `${box.height}%`,
              borderColor: boxColor,
              boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 0 12px ${boxColor}55`,
            }}
          >
            <div
              className="absolute top-0 left-0 -translate-y-full px-1.5 py-0.5 text-[10px] font-mono font-bold whitespace-nowrap"
              style={{ backgroundColor: boxColor, color: "#fff" }}
            >
              {box.label.toUpperCase()} {(box.confidence * 100).toFixed(0)}%
            </div>
          </div>
        );
      })}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md font-mono text-xs font-bold shadow-lg"
        style={{ backgroundColor: meta.color, color: "#fff" }}
      >
        {meta.label.toUpperCase()} · {(result.confidence * 100).toFixed(0)}%
      </div>
    </>
  );
}

export default function CCTVPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateDetection();
  const { detect, modelReady } = useDetector();

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPersonsRef = useRef<Array<{ cx: number; cy: number }>>([]);
  const lastAlertRef = useRef<number>(0);
  const suspiciousStreakRef = useRef<number>(0);
  // Loitering: frames a person has been stationary in the scene
  const loiteringFramesRef = useRef<number>(0);
  // Object tracking: how many consecutive frames each valuable has been seen / absent
  const objectSeenRef = useRef<Map<string, number>>(new Map());
  const objectAbsentRef = useRef<Map<string, number>>(new Map());
  // Track whether a person was recently in the scene (needed for theft)
  const personRecentFramesRef = useRef<number>(0);

  const [url, setUrl] = useState("");
  const [streamActive, setStreamActive] = useState(false);
  const [imgSrc, setImgSrc] = useState("");
  const [streamLoaded, setStreamLoaded] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [tainted, setTainted] = useState(false);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [savedResult, setSavedResult] = useState<{ id: number; result: LiveResult } | null>(null);
  const [isLan, setIsLan] = useState(false);
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  const trimmed = url.trim();

  function handleUrlChange(val: string) {
    setUrl(val);
    if (streamActive) stopStream();
  }

  function startStream() {
    if (!trimmed) return;
    setStreamLoaded(false);
    setStreamError(null);
    setTainted(false);
    setLive(null);
    setSavedResult(null);
    prevPersonsRef.current = [];

    const lan = isLanUrl(trimmed);
    setIsLan(lan);

    const isRtsp = trimmed.toLowerCase().startsWith("rtsp://");

    if (lan) {
      // LAN: connect direct from browser. Hosted proxy can't reach private IPs.
      const snap = buildSnapshotUrl(trimmed);
      setImgSrc(snap + (snap.includes("?") ? "&" : "?") + "_t=" + Date.now());
    } else if (isRtsp) {
      // RTSP: must go through server ffmpeg proxy
      setImgSrc(`${BASE}/api/stream/mjpeg?url=${encodeURIComponent(trimmed)}`);
    } else {
      // Public HTTP/MJPEG: use server proxy for CORS-safe canvas access
      setImgSrc(`${BASE}/api/stream/mjpeg?url=${encodeURIComponent(trimmed)}`);
    }

    setStreamActive(true);
  }

  function stopStream() {
    setStreamActive(false);
    setStreamLoaded(false);
    setStreamError(null);
    setImgSrc("");
    setLive(null);
    suspiciousStreakRef.current = 0;
    loiteringFramesRef.current = 0;
    personRecentFramesRef.current = 0;
    objectSeenRef.current.clear();
    objectAbsentRef.current.clear();
    if (loopRef.current) { clearTimeout(loopRef.current); loopRef.current = null; }
    if (refreshRef.current) { clearInterval(refreshRef.current); refreshRef.current = null; }
  }

  // For LAN snapshot URLs: refresh image every 400ms to simulate live video
  useEffect(() => {
    if (!streamActive || !isLan || !trimmed) return;
    const snap = buildSnapshotUrl(trimmed);
    refreshRef.current = setInterval(() => {
      setImgSrc(snap + (snap.includes("?") ? "&" : "?") + "_t=" + Date.now());
    }, 400);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [streamActive, isLan, trimmed]);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Continuous inference loop ─────────────────────────────────────
  const runInferenceTick = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !streamActive) return;
    if (!img.complete || img.naturalWidth === 0) return;

    const W = img.naturalWidth, H = img.naturalHeight;
    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const c = canvasRef.current;
    c.width = Math.min(W, 480);
    c.height = Math.round(c.width * (H / W));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    try {
      ctx.drawImage(img, 0, 0, c.width, c.height);
    } catch {
      return;
    }

    // Pixel access test (for fire detector + signals canvas taint)
    let canReadPixels = true;
    try {
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      canReadPixels = false;
    }
    if (!canReadPixels) {
      setTainted(true);
      // We can still try detection on the <img> element directly (model uses tensor.fromPixels which requires CORS-clean too)
    }

    let raw;
    try {
      raw = await detect(c);
    } catch {
      return;
    }

    // Fire detection (needs pixel access)
    const fire = canReadPixels
      ? detectFire(c)
      : { isFire: false, ratio: 0, bbox: null as BBox | null };

    // Motion estimate vs previous frame's persons.
    // IMPORTANT: drop ghost detections (score < 0.4). COCO-SSD often hallucinates
    // "person" boxes at ~0.07–0.15 on parked cars / poles / signs which jump
    // between frames and look like huge motion → false fighting alerts.
    const persons = (raw._rawPersons ?? []).filter((p) => p.score >= 0.4);
    let motion = 0;
    if (prevPersonsRef.current.length > 0 && persons.length > 0) {
      for (const p of persons) {
        let min = Infinity;
        for (const q of prevPersonsRef.current) {
          const d = Math.sqrt((p.cx - q.cx) ** 2 + (p.cy - q.cy) ** 2);
          if (d < min) min = d;
        }
        motion += min;
      }
      motion /= persons.length;
    }
    prevPersonsRef.current = persons.map(p => ({ cx: p.cx, cy: p.cy }));

    // Weapon detection (COCO-SSD weapon classes)
    const threatLabels = new Set(["knife", "scissors", "baseball bat", "fork"]);
    const reliableBoxes = raw.bbox.filter(b =>
      b.label === "person" ? b.confidence >= 0.38 : b.confidence >= 0.28
    );
    const personBoxes = reliableBoxes.filter(b => b.label === "person");
    const weaponBoxes = reliableBoxes.filter(b => threatLabels.has(b.label));
    const weaponPresent = weaponBoxes.length > 0;

    // Face-covered detection — inspect head region of largest person bbox
    let faceCoveredPersonBbox: BBox | null = null;
    if (canReadPixels && personBoxes.length >= 1) {
      const biggest = [...personBoxes].sort(
        (a, b) => b.width * b.height - a.width * a.height
      )[0];
      if (biggest && isFaceCovered(c, biggest)) faceCoveredPersonBbox = biggest;
    }

    // ── Loitering tracker ────────────────────────────────────────────────
    // If a person is in the scene and barely moving, increment loitering count.
    if (persons.length >= 1 && motion < 2.5) {
      loiteringFramesRef.current = Math.min(loiteringFramesRef.current + 1, 60);
    } else if (persons.length === 0 || motion > 6) {
      // Person left scene or is moving fast — reset loitering
      loiteringFramesRef.current = Math.max(loiteringFramesRef.current - 2, 0);
    }

    // ── Person presence tracker (for theft context) ──────────────────────
    if (persons.length >= 1) {
      personRecentFramesRef.current = Math.min(personRecentFramesRef.current + 1, 30);
    } else {
      personRecentFramesRef.current = Math.max(personRecentFramesRef.current - 1, 0);
    }

    // ── Object tracking for theft detection ──────────────────────────────
    // Track valuable items. If one disappears after being stable AND a person
    // was recently in frame, flag as possible theft.
    const valuableLabels = new Set(["backpack", "handbag", "suitcase", "laptop", "cell phone"]);
    const seenNow = new Set(
      reliableBoxes.filter(b => valuableLabels.has(b.label)).map(b => b.label)
    );

    let missingValuable: string | null = null;
    for (const item of valuableLabels) {
      if (seenNow.has(item)) {
        // Item visible — increment seen count, reset absent count
        objectSeenRef.current.set(item, (objectSeenRef.current.get(item) ?? 0) + 1);
        objectAbsentRef.current.set(item, 0);
      } else {
        // Item not visible — increment absent count
        const seenCount = objectSeenRef.current.get(item) ?? 0;
        const absentCount = (objectAbsentRef.current.get(item) ?? 0) + 1;
        objectAbsentRef.current.set(item, absentCount);
        // Was stable for 8+ frames, now gone for 3+ frames, person was recently seen
        if (seenCount >= 8 && absentCount >= 3 && personRecentFramesRef.current >= 3) {
          missingValuable = item;
          // Reset seen count so it doesn't fire again until item reappears
          objectSeenRef.current.set(item, 0);
        }
      }
    }

    const result = toUserCategory({
      rawActivity: raw.activity,
      rawConfidence: raw.confidence,
      rawBbox: raw.bbox,
      fire,
      motionLevel: motion,
      weaponPresent,
      faceCoveredPersonBbox,
      loiteringFrames: loiteringFramesRef.current,
      missingValuable,
    });

    setLive(result);

    const meta = CATEGORY_META[result.category];
    if (meta.suspicious && result.confidence >= 0.75) {
      suspiciousStreakRef.current += 1;
      const COOLDOWN_MS = 5 * 60 * 1000;
      const now = Date.now();
      if (suspiciousStreakRef.current >= 3 && now - lastAlertRef.current > COOLDOWN_MS) {
        lastAlertRef.current = now;
        suspiciousStreakRef.current = 0;
        sendAlert(result.category, result.confidence);
      }
    } else {
      suspiciousStreakRef.current = 0;
    }
  }, [detect, streamActive]);

  // Schedule the loop
  useEffect(() => {
    if (!streamActive || !modelReady) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await runInferenceTick();
      if (cancelled) return;
      loopRef.current = setTimeout(tick, 700);
    };
    tick();
    return () => {
      cancelled = true;
      if (loopRef.current) clearTimeout(loopRef.current);
    };
  }, [streamActive, modelReady, runInferenceTick]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (loopRef.current) clearTimeout(loopRef.current);
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  async function sendAlert(category: Category, confidence: number) {
    try {
      const res = await fetch(`${BASE}/api/alerts/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity: category, confidence, source: "CCTV Live Monitor" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.whatsapp) {
        toast({ title: "WhatsApp alert sent!", description: `Alert sent for: ${CATEGORY_META[category].label}` });
      }
    } catch { /* silent */ }
  }

  function snapshotAndSave() {
    if (!live) {
      toast({ title: "No live detection yet", description: "Wait a moment for the model to analyze a frame.", variant: "destructive" });
      return;
    }
    const meta = CATEGORY_META[live.category];
    createMutation.mutate({
      data: {
        inputType: "stream",
        inputUrl: trimmed,
        activityType: live.category,
        confidence: live.confidence,
        status: meta.suspicious ? "suspicious" : "normal",
        boundingBoxes: JSON.stringify(live.bbox),
        notes: `Live CCTV: ${trimmed} — ${live.reason}`,
      }
    }, {
      onSuccess: (data) => {
        toast({ title: "Snapshot saved", description: `${meta.label} logged.` });
        setSavedResult({ id: data.id, result: live });
        queryClient.invalidateQueries({ queryKey: getListDetectionsQueryKey() });
        if (meta.suspicious && live.confidence >= 0.75) {
          sendAlert(live.category, live.confidence);
        }
      },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    });
  }

  const meta = live ? CATEGORY_META[live.category] : null;

  return (
    <div className="relative max-w-6xl space-y-6">
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-96 bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.15),_transparent_70%)]" />

      <div className="relative">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
          CCTV / Live Stream Analysis
        </h1>
        <p className="text-muted-foreground mt-1 text-base max-w-2xl">
          Connect your IP camera and run continuous AI inference for: <strong>robbery, fighting, fire, weapon threats</strong>.
        </p>
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── LEFT: Live Stream ─────────────────────────────────────── */}
        <Card className="relative border-border/60 bg-card/70 backdrop-blur-xl">
          <div className="h-1 w-full bg-gradient-to-r from-primary/60 via-blue-500/40 to-transparent rounded-t-xl" />
          <CardHeader className="pb-3 pt-4 px-5">
            <CardTitle className="flex items-center gap-2.5 text-base">
              <span className="w-7 h-7 rounded-md bg-primary/15 border border-primary/20 flex items-center justify-center">
                <Radio className="w-4 h-4 text-primary" />
              </span>
              Live Stream Source
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5 ml-9 -mt-0.5 text-xs">
              <Cpu className="w-3.5 h-3.5" />
              {!modelReady ? (
                <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading detection model…</span>
              ) : streamActive ? (
                <span className="text-green-500">Live inference active · ~1.4 fps</span>
              ) : (
                <span className="text-green-500">Model ready — connect a stream to begin</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5 pb-5">
            <div className="relative w-full bg-zinc-950 rounded-xl overflow-hidden border border-border" style={{ height: "250px" }}>
              {streamActive && imgSrc && (
                <img
                  key={isLan ? "lan-img" : imgSrc}
                  ref={imgRef}
                  src={imgSrc}
                  alt="Live CCTV"
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                  onLoad={() => { setStreamLoaded(true); setStreamError(null); }}
                  onError={() => {
                    setStreamError(
                      isLan
                        ? "Cannot reach camera. Check it's powered on, on the same Wi-Fi, and that the URL is correct."
                        : "Stream unreachable. Check the URL or try a public test feed."
                    );
                  }}
                />
              )}

              {streamActive && streamLoaded && <LiveOverlay result={live} />}

              {streamActive && !streamLoaded && !streamError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 gap-2">
                  <Loader2 className="w-7 h-7 text-primary animate-spin" />
                  <p className="text-xs font-mono text-zinc-400">Connecting to stream…</p>
                  {isLan && <p className="text-[10px] text-zinc-600">Direct browser → camera (LAN)</p>}
                </div>
              )}

              {streamActive && streamError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 gap-2 p-6 text-center">
                  <AlertTriangle className="w-8 h-8 text-orange-400" />
                  <p className="text-sm font-mono text-orange-400 font-semibold">STREAM ERROR</p>
                  <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">{streamError}</p>
                </div>
              )}

              {!streamActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Radio className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">Enter a stream URL and click Connect</p>
                  <p className="text-xs mt-1 opacity-60">Supports IP Webcam (LAN), HTTP/MJPEG, and RTSP</p>
                </div>
              )}

              {streamActive && streamLoaded && (
                <>
                  <div className="absolute top-3 left-3 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-mono text-white drop-shadow">LIVE</span>
                  </div>
                  <div className="absolute top-3 right-3 text-xs font-mono text-zinc-300 bg-black/60 px-2 py-0.5 rounded">
                    {time}
                  </div>
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block animate-pulse" />
                    <span className="text-xs font-mono text-zinc-300">
                      {isLan ? "DIRECT LAN" : "PROXY"} · INFERENCE
                    </span>
                  </div>
                </>
              )}
            </div>

            {tainted && (
              <div className="text-[10px] text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-md p-1.5">
                Browser blocked pixel access (CORS). Enable <strong>Cross-Origin Resource Sharing</strong> in IP Webcam's Server settings.
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">CCTV / Stream URL</Label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10"
                  placeholder="http://192.168.1.50:8080  or  rtsp://cam/stream  or  https://cam/mjpeg"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  data-testid="input-cctv-url"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                LAN cameras connect directly from your browser. RTSP & public HTTP go through the server proxy.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {!streamActive ? (
                <Button
                  className="col-span-2 h-11"
                  disabled={!trimmed}
                  onClick={startStream}
                  data-testid="button-connect"
                >
                  <Radio className="w-4 h-4 mr-2" /> Connect & Analyze Live
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="h-11"
                    onClick={stopStream}
                    data-testid="button-disconnect"
                  >
                    Disconnect
                  </Button>
                  <Button
                    className="h-11"
                    disabled={!live || createMutation.isPending}
                    onClick={snapshotAndSave}
                    data-testid="button-snapshot"
                  >
                    {createMutation.isPending ? (
                      <><ScanLine className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                    ) : (
                      <><Activity className="w-4 h-4 mr-2" /> Save Snapshot</>
                    )}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── RIGHT: Live Detection Panel ──────────────────────────── */}
        <div>
          {savedResult ? (
            <Card className={`border-2 ${CATEGORY_META[savedResult.result.category].suspicious ? "border-destructive/60" : "border-green-500/60"} animate-in fade-in slide-in-from-bottom-4`}>
              <div className="h-1.5 w-full" style={{ backgroundColor: CATEGORY_META[savedResult.result.category].color }} />
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="w-5 h-5" /> Snapshot Saved
                </CardTitle>
                <CardDescription>Detection logged to database</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-muted rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Category</p>
                    <p className="font-bold capitalize">{CATEGORY_META[savedResult.result.category].label}</p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Confidence</p>
                    <p className="font-bold font-mono text-lg">{(savedResult.result.confidence * 100).toFixed(2)}%</p>
                  </div>
                </div>
                <Badge
                  variant={CATEGORY_META[savedResult.result.category].suspicious ? "destructive" : "outline"}
                  className="w-full justify-center py-1.5 text-sm"
                >
                  {CATEGORY_META[savedResult.result.category].suspicious ? "SUSPICIOUS ACTIVITY" : "NO THREAT"}
                </Badge>
              </CardContent>
              <CardFooter className="gap-3">
                <Link href={`/detections/${savedResult.id}`} className="flex-1">
                  <Button variant="outline" className="w-full">View Full Report</Button>
                </Link>
                <Button variant="ghost" onClick={() => setSavedResult(null)} className="flex-1">
                  <RotateCcw className="w-4 h-4 mr-2" /> Continue Monitoring
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Card className="border-border/60">
              <div className="h-1 w-full" style={{ backgroundColor: meta?.color ?? "#3f3f46" }} />
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="w-5 h-5" /> Live Detection
                </CardTitle>
                <CardDescription>Updates every ~700ms while connected</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!streamActive && (
                  <div className="p-6 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                    Connect a stream to see live detections.
                  </div>
                )}
                {streamActive && !live && (
                  <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    Waiting for first analyzed frame…
                  </div>
                )}
                {live && meta && (
                  <>
                    <div className="flex items-center gap-3 p-4 rounded-lg border-2" style={{ borderColor: meta.color, backgroundColor: meta.color + "12" }}>
                      <meta.icon className="w-8 h-8 shrink-0" style={{ color: meta.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-lg" style={{ color: meta.color }}>{meta.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{live.reason}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold font-mono" style={{ color: meta.color }}>
                          {(live.confidence * 100).toFixed(0)}%
                        </p>
                        <p className="text-[10px] text-muted-foreground uppercase">confidence</p>
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground text-center">
                      Press <strong>Save Snapshot</strong> to log this detection and trigger alerts.
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
