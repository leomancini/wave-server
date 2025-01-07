import * as fs from "fs";
import * as path from "path";

export default async (
  groupId,
  file,
  itemId,
  uploaderId,
  dimensions,
  uploadDate
) => {
  const metadataDir = path.join("groups", groupId, "metadata");
  if (!fs.existsSync(metadataDir)) {
    fs.mkdirSync(metadataDir, { recursive: true });
  }

  const metadata = {
    originalName: file.originalname,
    itemId,
    mimeType: file.mimetype,
    size: file.size,
    uploadDate: uploadDate,
    uploaderId: uploaderId,
    dimensions,
    uploadDate: Number(itemId.split("-")[0])
  };

  fs.writeFileSync(
    path.join(metadataDir, `${itemId}.json`),
    JSON.stringify(metadata, null, 2)
  );
};
