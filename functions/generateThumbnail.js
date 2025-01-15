import sharp from "sharp";
import path from "path";
import fs from "fs";

const generateThumbnail = async (groupId, originalPath, itemId) => {
  const thumbnailsDir = path.join("groups", groupId, "thumbnails");
  const thumbnailPath = path.join(thumbnailsDir, `${itemId}.jpg`);

  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }

  try {
    const { width, height } = await sharp(originalPath).metadata();
    const aspectRatio = width / height;

    await sharp(originalPath, {
      failOnError: true,
      timeout: 30000
    })
      .resize(100, Math.round(100 / aspectRatio), {
        fit: "contain",
        position: "centre"
      })
      .jpeg({
        quality: 25,
        progressive: true
      })
      .toFile(thumbnailPath);

    const stats = await fs.promises.stat(thumbnailPath);
    if (stats.size === 0) {
      throw new Error("Generated thumbnail is empty");
    }

    return thumbnailPath;
  } catch (error) {
    console.error(`Error generating thumbnail for ${itemId}:`, error);
    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath);
    }
    throw error;
  }
};

export default generateThumbnail;
