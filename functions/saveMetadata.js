import * as fs from "fs";
import * as path from "path";

export default async (
  groupId,
  file,
  newFilename,
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
    newFilename,
    mimeType: file.mimetype,
    size: file.size,
    uploadDate: uploadDate,
    uploaderId: uploaderId,
    dimensions,
    uploadDate: Number(newFilename.split("-")[0])
  };

  fs.writeFileSync(
    path.join(metadataDir, `${path.parse(newFilename).name}.json`),
    JSON.stringify(metadata, null, 2)
  );
};
