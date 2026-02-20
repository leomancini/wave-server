import fs from "fs";
import path from "path";
import sharp from "sharp";
import getMetadataForItem from "./getMetadataForItem.js";
import getCommentsForItem from "./getCommentsForItem.js";
import { findMediaFile, findCommentMediaFile, VIDEO_EXTENSIONS } from "./findMediaFile.js";
import extractVideoFrames from "./extractVideoFrames.js";

const MAX_IMAGES = 10;

const isVideoFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
};

const resizeImageToBuffer = async (filePath) => {
  return sharp(filePath)
    .resize(800, null, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
};

const bufferToContentBlock = (buffer, mediaType = "image/jpeg") => ({
  type: "image",
  source: {
    type: "base64",
    media_type: mediaType,
    data: buffer.toString("base64")
  }
});

export default async (groupId, postId) => {
  const contentBlocks = [];

  // 1. Gather all items belonging to this post
  const mediaDir = path.join("groups", groupId, "media");
  if (!fs.existsSync(mediaDir)) return contentBlocks;

  const allFiles = fs.readdirSync(mediaDir);
  const postItems = [];

  for (const filename of allFiles) {
    const itemId = path.parse(filename).name;
    const metadata = getMetadataForItem(groupId, itemId);
    const itemPostId = metadata.postId || itemId;
    if (itemPostId === postId) {
      postItems.push({ itemId, metadata });
    }
  }

  // Sort by orderIndex, then uploadDate
  postItems.sort((a, b) => {
    if (a.metadata.orderIndex !== undefined && b.metadata.orderIndex !== undefined) {
      return a.metadata.orderIndex - b.metadata.orderIndex;
    }
    return (a.metadata.uploadDate || 0) - (b.metadata.uploadDate || 0);
  });

  // 2. Process each post item
  for (const item of postItems) {
    if (contentBlocks.length >= MAX_IMAGES) break;

    const filePath = findMediaFile(groupId, item.itemId);
    if (!filePath) continue;

    try {
      if (isVideoFile(filePath)) {
        const frames = await extractVideoFrames(filePath);
        for (const frame of frames) {
          if (contentBlocks.length >= MAX_IMAGES) break;
          contentBlocks.push(bufferToContentBlock(frame.buffer, frame.mediaType));
        }
      } else {
        const buffer = await resizeImageToBuffer(filePath);
        contentBlocks.push(bufferToContentBlock(buffer));
      }
    } catch (err) {
      console.error(`Error processing media for item ${item.itemId}:`, err);
    }
  }

  // 3. Process comment media
  const comments = getCommentsForItem(groupId, postId);
  for (const comment of comments) {
    if (contentBlocks.length >= MAX_IMAGES) break;
    if (!comment.media || !comment.media.mediaId) continue;

    const mediaPath = findCommentMediaFile(groupId, comment.media.mediaId);
    if (!mediaPath) continue;

    try {
      if (isVideoFile(mediaPath)) {
        const frames = await extractVideoFrames(mediaPath);
        for (const frame of frames) {
          if (contentBlocks.length >= MAX_IMAGES) break;
          contentBlocks.push(bufferToContentBlock(frame.buffer, frame.mediaType));
        }
      } else {
        const buffer = await resizeImageToBuffer(mediaPath);
        contentBlocks.push(bufferToContentBlock(buffer));
      }
    } catch (err) {
      console.error(`Error processing comment media ${comment.media.mediaId}:`, err);
    }
  }

  return contentBlocks;
};
