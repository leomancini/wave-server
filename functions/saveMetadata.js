import * as fs from "fs";
import * as path from "path";

export default async (
  groupId,
  file,
  itemId,
  uploaderId,
  dimensions,
  uploadDate,
  postId,
  mediaType,
  orderIndex
) => {
  const metadataDir = path.join("groups", groupId, "metadata");
  if (!fs.existsSync(metadataDir)) {
    fs.mkdirSync(metadataDir, { recursive: true });
  }

  const metadata = {
    originalName: file.originalname,
    itemId,
    postId: postId || itemId,
    mimeType: file.mimetype,
    size: file.size,
    uploadDate: uploadDate,
    uploaderId: uploaderId,
    dimensions,
    uploadDate: Number(itemId.split("-")[0])
  };

  if (mediaType === "video") {
    metadata.mediaType = "video";
  }

  if (orderIndex !== undefined) {
    metadata.orderIndex = orderIndex;
  }

  fs.writeFileSync(
    path.join(metadataDir, `${itemId}.json`),
    JSON.stringify(metadata, null, 2)
  );
};
