import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

import saveMetadata from "../functions/saveMetadata.js";
import generateThumbnail from "../functions/generateThumbnail.js";
import getDimensions from "../functions/getDimensions.js";

export default async (groupId) => {
  try {
    const mediaPath = `groups/${groupId}/media`;

    if (!fs.existsSync(mediaPath)) {
      throw new Error("Group media directory not found");
    }

    const files = fs.readdirSync(mediaPath);
    let updatedCount = 0;

    for (const file of files) {
      const filePath = path.join(mediaPath, file);
      const fileExt = path.extname(file).toLowerCase();

      if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
        try {
          const filenameParts = file.split("-");
          const uploaderId = filenameParts[1];
          const stats = fs.statSync(filePath);

          const dimensions = await getDimensions(filePath);

          await saveMetadata(
            groupId,
            {
              originalname: file,
              mimetype: `image/${fileExt.slice(1)}`,
              size: stats.size
            },
            file,
            uploaderId,
            dimensions,
            Number(file.split("-")[0])
          );

          await generateThumbnail(groupId, filePath, file);

          updatedCount++;
        } catch (err) {
          console.error(`Error adding metadata for ${file}:`, err);
          continue;
        }
      }
    }

    return {
      message: `Successfully added metadata for ${updatedCount} files and their thumbnails in group ${groupId}`
    };
  } catch (error) {
    console.error("Error adding metadata and thumbnails:", error);
    return {
      error: "An error occurred while adding metadata and thumbnails"
    };
  }
};
