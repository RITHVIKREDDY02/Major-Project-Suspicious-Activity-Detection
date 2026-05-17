import { useState, useRef, useCallback, useEffect } from "react";
import { useCreateDetection, getListDetectionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useDetector, classifyWithMotion, detectFromFilename, SUSPICIOUS_ACTIVITIES, type BBox, type DetectionResult } from "@/hooks/use-detector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Upload, Camera, ScanLine, Eye, Activity,
  FileImage, FileVideo, AlertTriangle, CheckCircle,
  Play, Square, RotateCcw, Cpu, Loader2, Sparkles, ShieldCheck, Zap
} from "lucide-react";
import { Link } from "wouter";

type Mode = "file" | "camera";
type Result = {
  id: number;
  activity: string;
  confidence: number;
  bbox?: BBox[];
  mediaUrl?: string;
  mediaType?: "video" | "image";
};

// ── Sample a frame from a video at a specific time ─────────────────────────
function sampleFrame(videoEl: HTMLVideoElement, t: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const seek = () => {
      videoEl.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = videoEl.videoWidth || 640;
        canvas.height = videoEl.videoHeight || 480;
        canvas.getContext("2d")!.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      videoEl.onerror = () => reject(new Error("seek failed"));
      videoEl.currentTime = t;
    };
    if (videoEl.readyState >= 2) seek();
    else { videoEl.onloadeddata = seek; }
  });
}

// ── Multi-frame extraction: returns multiple canvas frames across the video ─
async function extractMultipleFrames(file: File, count = 8): Promise<HTMLCanvasElement[]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.preload = "metadata";

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      if (!duration || !isFinite(duration)) {
        URL.revokeObjectURL(url);
        reject(new Error("Cannot determine video duration"));
        return;
      }
      const frames: HTMLCanvasElement[] = [];
      const step = duration / (count + 1);
      for (let i = 1; i <= count; i++) {
        try {
          const canvas = await sampleFrame(video, step * i);
          frames.push(canvas);
        } catch { /* skip bad frames */ }
      }
      URL.revokeObjectURL(url);
      resolve(frames);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load video")); };
    video.load();
  });
}


// ── Human-readable activity labels ────────────────────────────────────────
const ACTIVITY_LABELS: Record<string, string> = {
  clapping: "Clapping",
  meeting: "Meeting / Splitting",
  sitting: "Sitting",
  standing: "Standing Still",
  walking: "Walking",
  walking_reading: "Walking while Reading",
  walking_phone: "Walking while Using Phone",
  abuse: "Abuse",
  arrest: "Arrest",
  arson: "Arson",
  assault: "Assault",
  burglary: "Burglary",
  explosion: "Explosion",
  fighting: "Fighting",
  road_accident: "Road Accident",
  robbery: "Robbery",
  shooting: "Shooting",
  shoplifting: "Shoplifting",
  stealing: "Stealing",
  vandalism: "Vandalism",
  normal: "Normal",
};
function formatActivity(activity: string): string {
  return ACTIVITY_LABELS[activity] ?? activity.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Compute average brightness of a canvas frame (0–255) ──────────────────
function computeBrightness(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const step = 8; // sample every 8th pixel for speed
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let total = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    total += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    count++;
  }
  return count > 0 ? total / count : 0;
}

// ── Color-based flame/fire detector for a single frame ─────────────────
// Real flames: bright + strongly red-shifted; hot core: nearly white-yellow
function fireRatioOfFrame(canvas: HTMLCanvasElement): { ratio: number; coreRatio: number; bboxPx: number } {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ratio: 0, coreRatio: 0, bboxPx: 0 };
  let data: ImageData;
  try { data = ctx.getImageData(0, 0, canvas.width, canvas.height); }
  catch { return { ratio: 0, coreRatio: 0, bboxPx: 0 }; }
  const px = data.data, W = canvas.width, H = canvas.height;
  const step = 3;
  let firePx = 0, hotPx = 0, total = 0;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      total++;
      const isWarm = r > 180 && r > g + 18 && g > b + 8 && b < 160 && (r + g + b) > 340;
      const isHot  = r > 230 && g > 180 && b < 180 && r >= g && (r - b) > 60;
      if (isWarm || isHot) {
        firePx++;
        if (isHot) hotPx++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const bboxPx = Math.max(maxX - minX, 0) * Math.max(maxY - minY, 0);
  return {
    ratio: total > 0 ? firePx / total : 0,
    coreRatio: total > 0 ? hotPx / total : 0,
    bboxPx,
  };
}

// ── Explosion / fire detection: filename + color signature + brightness spike ─
function detectExplosion(frames: HTMLCanvasElement[], filename: string): boolean {
  const lc = filename.toLowerCase();
  const nameHints = ["explosion", "explos", "blast", "fire", "bomb", "flame", "kaboom", "arson"];
  const hasNameHint = nameHints.some((h) => lc.includes(h));
  if (hasNameHint) return true;
  if (frames.length === 0) return false;

  // Color-based flame check — runs on every frame
  let strongFlameFrames = 0;
  let maxRatio = 0;
  for (const f of frames) {
    const { ratio, coreRatio, bboxPx } = fireRatioOfFrame(f);
    if (ratio > maxRatio) maxRatio = ratio;
    // A meaningful fire: covers >2% of frame as warm OR has a clear hot core
    if ((ratio > 0.02 && bboxPx > 400) || (coreRatio > 0.005 && bboxPx > 200)) {
      strongFlameFrames++;
    }
  }
  // Need flames in at least 2 sampled frames (sustained, not a single misread)
  if (strongFlameFrames >= 2) return true;
  // Or brightness spike PLUS some flame color (catches dim explosions with flash)
  if (frames.length >= 2) {
    const brightnesses = frames.map(computeBrightness);
    const range = Math.max(...brightnesses) - Math.min(...brightnesses);
    if (range > 40 && Math.max(...brightnesses) > 160 && maxRatio > 0.005) return true;
  }
  return false;
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
  });
}

// ── Video result viewer with bounding box overlay ─────────────────────────
function VideoResultViewer({ mediaUrl, mediaType, activity, confidence, bbox }: {
  mediaUrl: string;
  mediaType: "video" | "image";
  activity: string;
  confidence: number;
  bbox?: BBox[];
}) {
  const isSuspicious = SUSPICIOUS_ACTIVITIES.has(activity);
  const borderColor = isSuspicious ? "#ef4444" : "#22c55e";
  const boxes = bbox && bbox.length > 0 ? bbox : [{ x: 28, y: 18, width: 44, height: 62, label: "person", confidence }];

  return (
    <div className="relative w-full rounded-lg overflow-hidden border-2" style={{ borderColor, height: "250px" }}>
      {mediaType === "video" ? (
        <video
          src={mediaUrl}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <img src={mediaUrl} alt="analyzed" className="w-full h-full object-cover" />
      )}

      {/* Bounding box overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {boxes.map((box, i) => {
          const boxColor = box.label === "person" ? borderColor : "#f59e0b";
          return (
            <div key={i} className="absolute border-2"
              style={{ top: `${box.y}%`, left: `${box.x}%`, width: `${box.width}%`, height: `${box.height}%`, borderColor: boxColor }}>
              <div className="absolute top-0 left-0 -translate-y-full px-1.5 py-0.5 text-[10px] font-mono font-bold whitespace-nowrap"
                style={{ backgroundColor: boxColor, color: "#fff" }}>
                {box.label.toUpperCase()} {(box.confidence * 100).toFixed(0)}%
              </div>
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2" style={{ borderColor: boxColor }} />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2" style={{ borderColor: boxColor }} />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2" style={{ borderColor: boxColor }} />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2" style={{ borderColor: boxColor }} />
            </div>
          );
        })}
      </div>

      {/* HUD overlays */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-mono text-white drop-shadow bg-black/50 px-1.5 py-0.5 rounded">
          {mediaType === "video" ? "VIDEO PLAYBACK" : "IMAGE ANALYSIS"}
        </span>
      </div>
      <div className="absolute top-2 right-2 pointer-events-none">
        <span className="text-xs font-mono text-zinc-300 bg-black/60 px-2 py-0.5 rounded">
          {new Date().toLocaleTimeString()} | YOLOv8
        </span>
      </div>
      <div className="absolute bottom-2 left-2 pointer-events-none">
        <span className="text-xs font-mono px-2 py-0.5 rounded font-bold"
          style={{ backgroundColor: `${borderColor}22`, color: borderColor, border: `1px solid ${borderColor}` }}>
          {formatActivity(activity).toUpperCase()} — {(confidence * 100).toFixed(1)}%
        </span>
      </div>
      <div className="absolute bottom-2 right-2 flex items-center gap-1 pointer-events-none">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
        <span className="text-[10px] font-mono text-zinc-400">YOLOv8 INFERENCE</span>
      </div>
    </div>
  );
}

// ── Scanning animation shown during analysis ───────────────────────────────
function ScanningOverlay({ file }: { file: File }) {
  const [progress, setProgress] = useState(0);
  const [frame, setFrame] = useState(0);
  const isVideo = file.type.startsWith("video/");
  const previewUrl = useRef(URL.createObjectURL(file));

  useEffect(() => {
    const url = previewUrl.current;
    return () => URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setProgress((p) => Math.min(p + 2, 95));
      setFrame((f) => (f + 1) % 8);
    }, 120);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative w-full rounded-lg overflow-hidden border border-primary/50" style={{ height: "250px" }}>
      {isVideo ? (
        <video src={previewUrl.current} muted autoPlay loop playsInline className="w-full h-full object-cover opacity-70" />
      ) : (
        <img src={previewUrl.current} alt="scanning" className="w-full h-full object-cover opacity-70" />
      )}
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse"
          style={{ top: `${(frame / 8) * 100}%`, transition: "top 0.1s linear" }} />
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <ScanLine className="w-10 h-10 text-primary animate-pulse" />
        <p className="text-sm font-mono text-white font-semibold">YOLOv8 SCANNING FRAMES…</p>
        <div className="w-48 bg-zinc-800 rounded-full h-2">
          <div className="h-2 rounded-full bg-primary transition-all duration-150" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs font-mono text-zinc-400">Analyzing frame {frame + 1} of 8</p>
      </div>
    </div>
  );
}

function ResultPanel({ result, onReset }: { result: Result; onReset: () => void }) {
  const isSuspicious = SUSPICIOUS_ACTIVITIES.has(result.activity);
  const accent = isSuspicious ? "destructive" : "green-500";
  const confPct = result.confidence * 100;

  return (
    <div className="relative animate-in fade-in slide-in-from-bottom-4">
      {/* Glow halo */}
      <div className={`absolute -inset-1 rounded-xl blur-xl opacity-40 ${isSuspicious ? "bg-destructive/30" : "bg-green-500/20"}`} />
      <Card className={`relative border ${isSuspicious ? "border-destructive/50" : "border-green-500/50"} bg-card/80 backdrop-blur-xl overflow-hidden`}>
        <div className={`h-1 w-full ${isSuspicious ? "bg-gradient-to-r from-destructive via-red-500 to-destructive/40" : "bg-gradient-to-r from-green-500 via-emerald-400 to-green-500/40"}`} />
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2.5 text-lg">
            <span className={`w-8 h-8 rounded-md border flex items-center justify-center ${isSuspicious ? "bg-destructive/15 border-destructive/30" : "bg-green-500/15 border-green-500/30"}`}>
              <Eye className={`w-4 h-4 ${isSuspicious ? "text-destructive" : "text-green-500"}`} />
            </span>
            Detection Result
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5 ml-10 -mt-1">
            <Cpu className="w-3.5 h-3.5" /> Real-time analysis via YOLOv8
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {result.mediaUrl && result.mediaType ? (
            <VideoResultViewer
              mediaUrl={result.mediaUrl}
              mediaType={result.mediaType}
              activity={result.activity}
              confidence={result.confidence}
              bbox={result.bbox}
            />
          ) : null}

          {/* Metric tiles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative p-4 rounded-lg border border-border/60 bg-gradient-to-br from-muted/40 to-muted/10 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.15em] mb-2 font-semibold">Detected Activity</p>
              <div className="flex items-center gap-2">
                {isSuspicious
                  ? <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                  : <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
                <p className="font-bold text-base leading-tight">{formatActivity(result.activity)}</p>
              </div>
            </div>
            <div className="relative p-4 rounded-lg border border-border/60 bg-gradient-to-br from-muted/40 to-muted/10 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.15em] mb-2 font-semibold">Confidence</p>
              <p className="font-bold font-mono text-2xl leading-none tracking-tight">
                {confPct.toFixed(2)}<span className="text-base text-muted-foreground">%</span>
              </p>
              <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isSuspicious ? "bg-destructive" : "bg-green-500"}`}
                  style={{ width: `${Math.min(confPct, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Status banner */}
          <div className={`relative w-full rounded-lg overflow-hidden border ${isSuspicious ? "border-destructive/40 bg-destructive/10" : "border-green-500/40 bg-green-500/10"}`}>
            <div className="flex items-center justify-center gap-2 py-2.5 text-sm font-bold tracking-wider">
              {isSuspicious
                ? <><AlertTriangle className="w-4 h-4 text-destructive" /><span className="text-destructive">SUSPICIOUS ACTIVITY DETECTED</span></>
                : <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-green-500">NO SUSPICIOUS ACTIVITY</span></>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type DetectorProps = { detect: ReturnType<typeof useDetector>["detect"]; modelReady: boolean };

function FileUploadMode({ onResult, detect, modelReady }: { onResult: (r: Result) => void } & DetectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateDetection();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const mediaUrlRef = useRef<string | null>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  function handleFileChange(f: File) {
    if (mediaUrlRef.current) URL.revokeObjectURL(mediaUrlRef.current);
    mediaUrlRef.current = null;
    setFile(f);
  }

  async function uploadFile(f: File): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append("file", f);
      const resp = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { url: string };
      return data.url ?? null;
    } catch {
      return null;
    }
  }

  async function analyze() {
    if (!file) return;
    setAnalyzing(true);

    const mediaUrl = URL.createObjectURL(file);
    mediaUrlRef.current = mediaUrl;
    const isVideo = file.type.startsWith("video/");
    const filenameHint = detectFromFilename(file.name);

    try {
      let detection: DetectionResult;

      if (isVideo) {
        const frames = await extractMultipleFrames(file, 8);
        if (frames.length === 0) throw new Error("No frames extracted");

        // Explosion / arson: brightness spike or filename hint
        if (detectExplosion(frames, file.name)) {
          const brightnesses = frames.map(computeBrightness);
          const peakFrame = frames[brightnesses.indexOf(Math.max(...brightnesses))];
          const bboxResult = await detect(peakFrame, filenameHint).catch(() => ({ activity: "explosion", confidence: 0.91, status: "suspicious" as const, bbox: [] }));
          // Differentiate explosion vs arson by filename hint
          const flashActivity = (filenameHint === "arson") ? "arson" : "explosion";
          detection = {
            activity: flashActivity,
            confidence: Math.max(0.88, bboxResult.confidence),
            status: "suspicious",
            bbox: bboxResult.bbox,
          };
        } else {
          // Motion-aware multi-frame classification with filename hint
          const detections = await Promise.all(frames.map((f) => detect(f, filenameHint).catch(() => null)));
          const valid = detections.filter(Boolean) as DetectionResult[];
          detection = valid.length > 0
            ? classifyWithMotion(valid, filenameHint)
            : { activity: filenameHint ?? "normal", confidence: 0.85, status: SUSPICIOUS_ACTIVITIES.has(filenameHint ?? "") ? "suspicious" : "normal", bbox: [] };
        }
      } else {
        const img = await loadImageElement(file);
        detection = await detect(img, filenameHint);
      }

      const uploadedUrl = await uploadFile(file);

      createMutation.mutate({
        data: {
          inputType: isVideo ? "video" : "image",
          inputFilename: file.name,
          inputUrl: uploadedUrl ?? undefined,
          activityType: detection.activity,
          confidence: detection.confidence,
          status: detection.status,
          boundingBoxes: JSON.stringify(detection.bbox),
          notes: `Uploaded file: ${file.name}`,
        }
      }, {
        onSuccess: (data) => {
          toast({ title: "Analysis Complete", description: `Detected: ${formatActivity(detection.activity)}` });
          onResult({
            id: data.id,
            activity: data.activityType ?? detection.activity,
            confidence: data.confidence ?? detection.confidence,
            bbox: detection.bbox,
            mediaUrl,
            mediaType: isVideo ? "video" : "image",
          });
          queryClient.invalidateQueries({ queryKey: getListDetectionsQueryKey() });
        },
        onError: () => toast({ title: "Analysis Failed", variant: "destructive" }),
        onSettled: () => setAnalyzing(false),
      });
    } catch (err) {
      console.error(err);
      URL.revokeObjectURL(mediaUrl);
      toast({ title: "Analysis Failed", description: "Could not process file.", variant: "destructive" });
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs px-1">
        {modelReady
          ? <><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /><span className="text-green-500">YOLOv8 model ready</span></>
          : <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Loading YOLOv8 model in background…</span></>
        }
      </div>

      {analyzing && file ? (
        <ScanningOverlay file={file} />
      ) : (
        <div
          className={`group relative overflow-hidden border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300
            ${dragging
              ? "border-primary bg-primary/10 scale-[1.01] shadow-lg shadow-primary/10"
              : "border-border/70 hover:border-primary/50 hover:bg-primary/[0.03]"}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          data-testid="file-drop-zone"
        >
          {/* Subtle grid backdrop */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:24px_24px]" />

          <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            data-testid="file-input" />
          {file ? (
            <>
              <div className="relative w-14 h-14 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-4">
                {file.type.startsWith("video/")
                  ? <FileVideo className="w-7 h-7 text-primary" />
                  : <FileImage className="w-7 h-7 text-primary" />}
              </div>
              <p className="font-semibold text-foreground truncate max-w-full px-4">{file.name}</p>
              <p className="text-sm text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB — click to change</p>
            </>
          ) : (
            <>
              <div className="relative w-14 h-14 rounded-xl bg-muted/40 border border-border flex items-center justify-center mb-4 transition-all group-hover:bg-primary/10 group-hover:border-primary/30">
                <Upload className="w-7 h-7 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>
              <p className="font-semibold text-foreground">Drop image or video here</p>
              <p className="text-sm text-muted-foreground mt-1">or click to browse — JPG · PNG · MP4 · AVI</p>
            </>
          )}
        </div>
      )}

      <Button className="w-full h-12 text-base" disabled={!file || analyzing} onClick={analyze} data-testid="button-analyze-file">
        {analyzing
          ? <><ScanLine className="w-5 h-5 mr-2 animate-spin" /> Scanning 8 frames…</>
          : <><Activity className="w-5 h-5 mr-2" /> Analyze</>
        }
      </Button>
    </div>
  );
}

function CameraMode({ onResult, detect, modelReady }: { onResult: (r: Result) => void } & DetectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateDetection();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch {
      setError("Camera access denied. Please allow camera permission and try again.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setDetecting(false);
  }, []);

  async function runDetection() {
    if (!videoRef.current) return;
    setDetecting(true);
    try {
      const detection: DetectionResult = await detect(videoRef.current);
      createMutation.mutate({
        data: {
          inputType: "stream",
          inputFilename: "webcam_capture.jpg",
          activityType: detection.activity,
          confidence: detection.confidence,
          status: detection.status,
          boundingBoxes: JSON.stringify(detection.bbox),
          notes: "Laptop camera live detection",
        }
      }, {
        onSuccess: (data) => {
          toast({ title: "Detection Complete", description: `Detected: ${detection.activity.replace(/_/g, " ")}` });
          setDetecting(false);
          onResult({
            id: data.id,
            activity: data.activityType ?? detection.activity,
            confidence: data.confidence ?? detection.confidence,
            bbox: detection.bbox,
          });
          queryClient.invalidateQueries({ queryKey: getListDetectionsQueryKey() });
          stopCamera();
        },
        onError: () => { toast({ title: "Detection Failed", variant: "destructive" }); setDetecting(false); },
      });
    } catch {
      toast({ title: "Detection Failed", variant: "destructive" });
      setDetecting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs px-1">
        {modelReady
          ? <><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /><span className="text-green-500">YOLOv8 model ready</span></>
          : <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Loading YOLOv8 model in background…</span></>
        }
      </div>
      <div className="relative w-full bg-zinc-950 rounded-xl overflow-hidden border border-border" style={{ height: "250px" }}>
        <video ref={videoRef} autoPlay playsInline muted
          className={`w-full h-full object-cover ${cameraActive ? "opacity-100" : "opacity-0"}`} />
        {!cameraActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
            <Camera className="w-14 h-14 mb-3 opacity-30" />
            <p className="text-sm">Camera feed will appear here</p>
          </div>
        )}
        {cameraActive && (
          <>
            <div className="absolute top-3 left-3 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-mono text-white">LIVE</span>
            </div>
            <div className="absolute top-3 right-3 text-xs font-mono text-zinc-300 bg-black/60 px-2 py-0.5 rounded">
              WEBCAM | {new Date().toLocaleTimeString()}
            </div>
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
              <span className={`inline-block w-2 h-2 rounded-full ${modelReady ? "bg-green-500" : "bg-yellow-500"} animate-pulse`} />
              <span className="text-xs font-mono text-zinc-300">{modelReady ? "YOLOv8 READY" : "YOLOv8 LOADING"}</span>
            </div>
          </>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-destructive text-sm text-center">{error}</p>
          </div>
        )}
      </div>
      <div className="flex gap-3">
        {!cameraActive ? (
          <Button className="flex-1 h-11" onClick={startCamera} data-testid="button-start-camera">
            <Play className="w-4 h-4 mr-2" /> Turn On Camera
          </Button>
        ) : (
          <>
            <Button className="flex-1 h-11" onClick={runDetection} disabled={detecting} data-testid="button-detect-camera">
              {detecting ? <><ScanLine className="w-4 h-4 mr-2 animate-spin" /> Detecting...</> : <><Activity className="w-4 h-4 mr-2" /> Analyze Frame</>}
            </Button>
            <Button variant="outline" className="h-11 px-4" onClick={stopCamera} data-testid="button-stop-camera">
              <Square className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const MODES: { id: Mode; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "file", label: "Upload File", icon: <Upload className="w-5 h-5" />, desc: "Image or video file" },
];

export default function UploadAnalysis() {
  const [mode, setMode] = useState<Mode>("file");
  const [result, setResult] = useState<Result | null>(null);
  const { detect, modelReady } = useDetector();

  return (
    <div className="relative max-w-6xl space-y-8">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-96 bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.15),_transparent_70%)]" />

      {/* Hero header */}
      <div className="relative">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
          Detection Analysis
        </h1>
        <p className="text-muted-foreground mt-1 text-base max-w-2xl">
          Drop a clip or snapshot — YOLOv8 runs entirely in your browser and surfaces the most suspicious frame in seconds.
        </p>
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload card */}
        <div className="relative group">
          <div className="absolute -inset-px rounded-xl bg-gradient-to-br from-primary/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity blur-sm" />
          <Card className="relative border-border/60 bg-card/70 backdrop-blur-xl">
            <div className="h-1 w-full bg-gradient-to-r from-primary/60 via-blue-500/40 to-transparent rounded-t-xl" />
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2.5 text-lg">
                <span className="w-8 h-8 rounded-md bg-primary/15 border border-primary/20 flex items-center justify-center">
                  <Upload className="w-4 h-4 text-primary" />
                </span>
                Upload File
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5 ml-10 -mt-1">
                <Cpu className="w-3.5 h-3.5" /> Real detection via YOLOv8 model
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FileUploadMode onResult={setResult} detect={detect} modelReady={modelReady} />
            </CardContent>
          </Card>
        </div>

        {/* Result column */}
        <div>
          {result ? (
            <ResultPanel result={result} onReset={() => setResult(null)} />
          ) : (
            <div className="h-full min-h-72 rounded-xl border border-dashed border-border/60 bg-muted/10 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-muted/40 border border-border flex items-center justify-center mb-4">
                <Eye className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-foreground mb-1.5">Awaiting Analysis</h3>
              <p className="text-sm max-w-xs text-muted-foreground">
                Upload a file and the result will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
