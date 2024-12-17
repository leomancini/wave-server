import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

export default async (groupId, imagePath, filename) => {
  const thumbnailsDir = path.join("groups", groupId, "thumbnails");
  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }

  const thumbnailPath = path.join(thumbnailsDir, filename);
  await sharp(imagePath)
    .resize(128, 128, {
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 50 })
    .toFile(thumbnailPath);
};
