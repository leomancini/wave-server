import path from "path";
import fs from "fs";

export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
// Audio is always transcoded to AAC in an .m4a container on upload so it
// plays natively on iOS (which can't play webm/ogg opus recordings).
export const AUDIO_EXTENSIONS = [".m4a"];

const MEDIA_EXTENSIONS = [".jpg", ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

export const findMediaFile = (groupId, itemId) => {
  for (const ext of MEDIA_EXTENSIONS) {
    const mediaPath = path.join("groups", groupId, "media", `${itemId}${ext}`);
    if (fs.existsSync(mediaPath)) {
      return mediaPath;
    }
  }
  return null;
};

export const findCommentMediaFile = (groupId, mediaId) => {
  for (const ext of MEDIA_EXTENSIONS) {
    const mediaPath = path.join("groups", groupId, "comment-media", `${mediaId}${ext}`);
    if (fs.existsSync(mediaPath)) {
      return mediaPath;
    }
  }
  return null;
};
