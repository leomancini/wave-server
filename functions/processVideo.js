import { execFile } from "child_process";
import path from "path";
import fs from "fs";

export const getVideoDimensions = (filePath) => {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        filePath
      ],
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const data = JSON.parse(stdout);
          const stream = data.streams[0];
          resolve({ width: stream.width, height: stream.height });
        } catch (e) {
          reject(e);
        }
      }
    );
  });
};

export const generateVideoThumbnail = (videoPath, groupId, itemId) => {
  const thumbnailsDir = path.join("groups", groupId, "thumbnails");
  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }

  const thumbnailPath = path.join(thumbnailsDir, `${itemId}.jpg`);

  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-i", videoPath,
        "-ss", "00:00:00.5",
        "-vframes", "1",
        "-vf", "scale=100:-1",
        "-q:v", "10",
        "-y",
        thumbnailPath
      ],
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(thumbnailPath);
      }
    );
  });
};
