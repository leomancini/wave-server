import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const getVideoDuration = (videoPath) => {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        videoPath
      ],
      (error, stdout) => {
        if (error) return reject(error);
        const duration = parseFloat(stdout.trim());
        if (isNaN(duration)) return reject(new Error("Could not parse duration"));
        resolve(duration);
      }
    );
  });
};

const extractFrameAtTimestamp = (videoPath, timestamp, outputPath) => {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-ss", String(timestamp),
        "-i", videoPath,
        "-vframes", "1",
        "-vf", "scale=800:-1",
        "-q:v", "5",
        "-y",
        outputPath
      ],
      (error) => {
        if (error) return reject(error);
        resolve(outputPath);
      }
    );
  });
};

// Returns array of { buffer: Buffer, mediaType: "image/jpeg" }
export default async (videoPath, { frameCount = 3 } = {}) => {
  const duration = await getVideoDuration(videoPath);
  const frames = [];
  const tmpDir = os.tmpdir();

  // For very short videos, just grab one frame
  const actualFrameCount = duration < 3 ? 1 : frameCount;

  for (let i = 1; i <= actualFrameCount; i++) {
    const fraction = i / (actualFrameCount + 1);
    const timestamp = duration * fraction;
    const tmpPath = path.join(tmpDir, `wave-frame-${Date.now()}-${i}.jpg`);

    try {
      await extractFrameAtTimestamp(videoPath, timestamp, tmpPath);
      const buffer = fs.readFileSync(tmpPath);
      frames.push({ buffer, mediaType: "image/jpeg" });
    } catch (err) {
      console.error(`Error extracting frame at ${timestamp}s:`, err);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  return frames;
};
