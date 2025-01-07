import * as fs from "fs";
import * as path from "path";

export default async () => {
  const groups = fs.readdirSync("groups");
  for (const group of groups) {
    const groupPath = path.join("groups", group);
    const mediaPath = path.join(groupPath, "media");
    const metadataPath = path.join(groupPath, "metadata");
    const reactionsPath = path.join(groupPath, "reactions");
    const commentsPath = path.join(groupPath, "comments");
    const thumbnailsPath = path.join(groupPath, "thumbnails");

    if (!fs.existsSync(mediaPath)) continue;

    const mediaFiles = fs.readdirSync(mediaPath);
    for (const file of mediaFiles) {
      const itemId = path.parse(file).name;

      // Update metadata file content
      if (fs.existsSync(path.join(metadataPath, `${itemId}.json`))) {
        const metadataFilePath = path.join(metadataPath, `${itemId}.json`);
        const metadata = JSON.parse(fs.readFileSync(metadataFilePath, "utf8"));

        if (metadata.newFilename) {
          metadata.itemId = path.parse(metadata.newFilename).name;
          delete metadata.newFilename;

          fs.writeFileSync(metadataFilePath, JSON.stringify(metadata, null, 2));
        }
      }

      // Update reactions file
      if (fs.existsSync(path.join(reactionsPath, file))) {
        fs.renameSync(
          path.join(reactionsPath, file),
          path.join(reactionsPath, `${itemId}.json`)
        );
      }

      // Update comments file
      if (fs.existsSync(path.join(commentsPath, file))) {
        fs.renameSync(
          path.join(commentsPath, file),
          path.join(commentsPath, `${itemId}.json`)
        );
      }

      // Update thumbnail file
      if (fs.existsSync(path.join(thumbnailsPath, file))) {
        fs.renameSync(
          path.join(thumbnailsPath, file),
          path.join(thumbnailsPath, `${itemId}.jpg`)
        );
      }
    }
  }
};
