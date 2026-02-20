import path from "path";
import fs from "fs";

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".avi", ".mkv"];

export const findMediaFile = (groupId, itemId) => {
  const jpgPath = path.join("groups", groupId, "media", `${itemId}.jpg`);
  if (fs.existsSync(jpgPath)) {
    return jpgPath;
  }
  for (const ext of VIDEO_EXTENSIONS) {
    const videoPath = path.join("groups", groupId, "media", `${itemId}${ext}`);
    if (fs.existsSync(videoPath)) {
      return videoPath;
    }
  }
  return null;
};

export const findCommentMediaFile = (groupId, mediaId) => {
  const jpgPath = path.join("groups", groupId, "comment-media", `${mediaId}.jpg`);
  if (fs.existsSync(jpgPath)) return jpgPath;
  for (const ext of VIDEO_EXTENSIONS) {
    const videoPath = path.join("groups", groupId, "comment-media", `${mediaId}${ext}`);
    if (fs.existsSync(videoPath)) return videoPath;
  }
  return null;
};
