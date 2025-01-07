import * as fs from "fs";
import * as path from "path";

export default (groupId, itemId) => {
  let metadata = {};
  const metadataFile = path.join(
    "groups",
    groupId,
    "metadata",
    `${itemId}.json`
  );
  if (fs.existsSync(metadataFile)) {
    const metadataData = fs.readFileSync(metadataFile, "utf8");
    metadata = JSON.parse(metadataData);
  }

  return metadata;
};
