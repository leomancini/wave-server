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
  orderIndex,
  extra = {}
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
    uploadDate: Number(itemId.split("-")[0]),
    uploaderId: uploaderId,
    dimensions
  };

  // Images are the default and carry no mediaType (legacy metadata has none)
  if (mediaType && mediaType !== "image") {
    metadata.mediaType = mediaType;
  }

  if (orderIndex !== undefined) {
    metadata.orderIndex = orderIndex;
  }

  // Extra fields, e.g. { duration } for audio clips
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) {
      metadata[key] = value;
    }
  }

  fs.writeFileSync(
    path.join(metadataDir, `${itemId}.json`),
    JSON.stringify(metadata, null, 2)
  );
};
