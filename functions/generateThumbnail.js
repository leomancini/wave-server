import sharp from "sharp";
import path from "path";
import fs from "fs";

const generateThumbnail = async (groupId, originalPath, itemId) => {
  const thumbnailsDir = path.join("groups", groupId, "thumbnails");
  const thumbnailPath = path.join(thumbnailsDir, `${itemId}.jpg`);

  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }

  // Add timeout and better error handling
  try {
    await sharp(originalPath, {
      failOnError: true,
      timeout: 30000 // 30 second timeout
    })
      .resize(300, 300, {
        fit: "cover",
        position: "centre"
      })
      .jpeg({
        quality: 70,
        progressive: true
      })
      .toFile(thumbnailPath);

    // Verify the thumbnail was created successfully
    const stats = await fs.promises.stat(thumbnailPath);
    if (stats.size === 0) {
      throw new Error("Generated thumbnail is empty");
    }

    return thumbnailPath;
  } catch (error) {
    console.error(`Error generating thumbnail for ${itemId}:`, error);
    // Clean up failed thumbnail if it exists
    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath);
    }
    throw error;
  }
};

export default generateThumbnail;
