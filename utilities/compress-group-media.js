import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

export default async (groupId) => {
  try {
    const mediaPath = `groups/${groupId}/media`;

    if (!fs.existsSync(mediaPath)) {
      throw new Error("Group media directory not found");
    }

    const files = fs.readdirSync(mediaPath);
    let compressedCount = 0;

    for (const file of files) {
      const filePath = path.join(mediaPath, file);
      const fileExt = path.extname(file).toLowerCase();

      if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
        try {
          const compressedPath = path.join(mediaPath, `compressed_${file}`);

          await sharp(filePath)
            .rotate()
            .resize(1920, 1080, {
              fit: "inside",
              withoutEnlargement: true
            })
            .jpeg({ quality: 100 })
            .toFile(compressedPath);

          fs.unlinkSync(filePath);
          fs.renameSync(compressedPath, filePath);

          compressedCount++;
        } catch (err) {
          console.error(`Error compressing ${file}:`, err);
          continue;
        }
      }
    }

    return {
      message: `Successfully compressed ${compressedCount} images in group ${groupId}`
    };
  } catch (error) {
    console.error("Compression error:", error);
    return {
      error: "An error occurred while compressing group images"
    };
  }
};
