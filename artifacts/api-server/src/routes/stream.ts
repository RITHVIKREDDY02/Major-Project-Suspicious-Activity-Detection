import { Router } from "express";
import { spawn } from "child_process";

const router = Router();

/**
 * GET /api/stream/mjpeg?url=<encoded-stream-url>
 *
 * Proxies any RTSP / HTTP / IP-camera stream through ffmpeg and outputs
 * a multipart/x-mixed-replace MJPEG response that browsers can display
 * natively inside an <img> tag for true real-time preview.
 */
router.get("/stream/mjpeg", (req, res) => {
  const url = req.query.url as string | undefined;

  if (!url) {
    res.status(400).json({ error: "Missing ?url= parameter" });
    return;
  }

  // Set MJPEG multipart headers so the browser keeps reading frames
  res.setHeader("Content-Type", "multipart/x-mixed-replace;boundary=frame");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // ffmpeg: read the source, scale to 640×360, output 10 fps JPEG frames to stdout
  const ff = spawn("ffmpeg", [
    "-loglevel", "quiet",
    "-rtsp_transport", "tcp",   // use TCP for RTSP (more reliable)
    "-i", url,
    "-f", "mjpeg",
    "-q:v", "5",                // JPEG quality 2-31 (lower = better)
    "-vf", "fps=10,scale=640:360:force_original_aspect_ratio=decrease",
    "pipe:1",
  ]);

  // Buffer incoming stdout chunks and extract complete JPEG frames
  // JPEG frames are delimited by SOI (0xFF 0xD8) and EOI (0xFF 0xD9)
  let buf = Buffer.alloc(0);

  ff.stdout.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    let searchFrom = 0;
    while (true) {
      const soi = buf.indexOf(Buffer.from([0xff, 0xd8]), searchFrom);
      if (soi === -1) break;

      const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
      if (eoi === -1) break;  // frame not yet complete

      const frame = buf.subarray(soi, eoi + 2);

      // Write multipart boundary + frame
      res.write(
        `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
      );
      res.write(frame);
      res.write("\r\n");

      searchFrom = eoi + 2;
    }

    // Keep only the unprocessed tail
    if (searchFrom > 0) buf = buf.subarray(searchFrom);
  });

  ff.stderr.on("data", () => {
    // suppress ffmpeg stderr noise
  });

  ff.on("close", () => {
    try { res.end(); } catch { /* already ended */ }
  });

  ff.on("error", () => {
    try { res.end(); } catch { /* already ended */ }
  });

  // Kill ffmpeg when the client disconnects
  req.on("close", () => {
    ff.kill("SIGTERM");
  });
});

/**
 * GET /api/stream/demo
 *
 * Streams a built-in FFmpeg test pattern (SMPTE colour bars + clock overlay)
 * as MJPEG. No external URL needed — always works for testing.
 */
router.get("/stream/demo", (_req, res) => {
  res.setHeader("Content-Type", "multipart/x-mixed-replace;boundary=frame");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const ff = spawn("ffmpeg", [
    "-loglevel", "quiet",
    "-f", "lavfi",
    "-i", "smptebars=size=640x360:rate=10",
    "-vf", "drawtext=fontcolor=white:fontsize=24:x=(w-text_w)/2:y=h-50:text='%{localtime\\:%H\\:%M\\:%S} | SAR DETECTION DEMO',drawbox=x=10:y=10:w=200:h=30:color=red@0.5:t=fill,drawtext=fontcolor=white:fontsize=14:x=16:y=17:text='● LIVE DEMO STREAM'",
    "-f", "mjpeg",
    "-q:v", "5",
    "pipe:1",
  ]);

  let buf = Buffer.alloc(0);

  ff.stdout.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    let searchFrom = 0;
    while (true) {
      const soi = buf.indexOf(Buffer.from([0xff, 0xd8]), searchFrom);
      if (soi === -1) break;
      const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
      if (eoi === -1) break;
      const frame = buf.subarray(soi, eoi + 2);
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write("\r\n");
      searchFrom = eoi + 2;
    }
    if (searchFrom > 0) buf = buf.subarray(searchFrom);
  });

  ff.on("close", () => { try { res.end(); } catch { /* already ended */ } });
  ff.on("error", () => { try { res.end(); } catch { /* already ended */ } });
  _req.on("close", () => { ff.kill("SIGTERM"); });
});

export default router;
