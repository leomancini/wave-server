import * as fs from "fs";
import * as path from "path";

export default (groupId, ownerId) => {
  const deletedItems = [];
  const errors = [];

  try {
    // Get all media files in the group
    const mediaDir = path.join("groups", groupId, "media");
    
    if (!fs.existsSync(mediaDir)) {
      return { deletedItems: [], errors: ["Group media directory not found"] };
    }

    const mediaFiles = fs.readdirSync(mediaDir);
    
    // Filter files owned by the specified user
    const ownerFiles = mediaFiles.filter(filename => {
      const itemId = path.parse(filename).name;
      const filenameParts = itemId.split("-");
      if (filenameParts.length < 2) return false;
      
      const uploaderId = filenameParts[1];
      return uploaderId === ownerId;
    });

    // Delete each owned item and its associated files
    ownerFiles.forEach(filename => {
      const itemId = path.parse(filename).name;
      
      try {
        // Define all possible file paths for this item
        const filesToDelete = [
          path.join("groups", groupId, "media", filename),
          path.join("groups", groupId, "thumbnails", `${itemId}.jpg`),
          path.join("groups", groupId, "metadata", `${itemId}.json`),
          path.join("groups", groupId, "reactions", `${itemId}.json`),
          path.join("groups", groupId, "comments", `${itemId}.json`)
        ];

        let deletedCount = 0;
        
        // Delete each file if it exists
        filesToDelete.forEach(filePath => {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        });

        if (deletedCount > 0) {
          deletedItems.push({
            itemId,
            filename,
            deletedFiles: deletedCount
          });
        }
        
      } catch (error) {
        errors.push({
          itemId,
          filename,
          error: error.message
        });
      }
    });

    return {
      deletedItems,
      errors,
      totalDeleted: deletedItems.length
    };

  } catch (error) {
    return {
      deletedItems: [],
      errors: [error.message],
      totalDeleted: 0
    };
  }
};