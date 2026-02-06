import * as fs from "fs";
import * as path from "path";
import getMetadataForItem from "./getMetadataForItem.js";

export default (groupId, itemId, requestedOwnerId) => {
  try {
    // Clean the itemId to ensure it's in the correct format
    const cleanedItemId = itemId.includes(".") ? path.parse(itemId).name : itemId;
    
    // Get the metadata to verify the owner
    const metadata = getMetadataForItem(groupId, cleanedItemId);
    
    if (!metadata || Object.keys(metadata).length === 0) {
      return {
        success: false,
        error: "Item not found or no metadata available"
      };
    }
    
    // Verify that the requestedOwnerId matches the actual owner
    if (metadata.uploaderId !== requestedOwnerId) {
      return {
        success: false,
        error: "Owner validation failed. You can only delete items you uploaded."
      };
    }
    
    const groupPath = path.join("groups", groupId);
    const deletedFiles = [];
    const errors = [];

    // Find the actual media file (could be .jpg, .mp4, etc.)
    const mediaDir = path.join(groupPath, "media");
    const possibleExtensions = [".jpg", ".mp4", ".mov", ".webm", ".avi"];
    let mediaFilePath = null;

    for (const ext of possibleExtensions) {
      const testPath = path.join(mediaDir, `${cleanedItemId}${ext}`);
      if (fs.existsSync(testPath)) {
        mediaFilePath = testPath;
        break;
      }
    }

    // Define all possible files for this item
    const filesToDelete = [
      {
        path: path.join(groupPath, "thumbnails", `${cleanedItemId}.jpg`),
        type: "thumbnail"
      },
      {
        path: path.join(groupPath, "metadata", `${cleanedItemId}.json`),
        type: "metadata"
      },
      {
        path: path.join(groupPath, "reactions", `${cleanedItemId}.json`),
        type: "reactions"
      },
      {
        path: path.join(groupPath, "comments", `${cleanedItemId}.json`),
        type: "comments"
      }
    ];

    // Add media file if found
    if (mediaFilePath) {
      filesToDelete.unshift({
        path: mediaFilePath,
        type: "media"
      });
    }
    
    // Delete each file if it exists
    filesToDelete.forEach(({ path: filePath, type }) => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedFiles.push({ type, path: filePath });
        }
      } catch (error) {
        errors.push({
          type,
          path: filePath,
          error: error.message
        });
      }
    });
    
    // Also remove from unread items for all users
    try {
      const unreadDir = path.join(groupPath, "users", "unread");
      if (fs.existsSync(unreadDir)) {
        const unreadFiles = fs.readdirSync(unreadDir);
        unreadFiles.forEach(unreadFile => {
          try {
            const unreadPath = path.join(unreadDir, unreadFile);
            const unreadItems = JSON.parse(fs.readFileSync(unreadPath, "utf8"));
            const updatedItems = unreadItems.filter(item => item !== cleanedItemId);
            
            if (updatedItems.length !== unreadItems.length) {
              fs.writeFileSync(unreadPath, JSON.stringify(updatedItems, null, 2));
            }
          } catch (error) {
            errors.push({
              type: "unread cleanup",
              path: path.join(unreadDir, unreadFile),
              error: error.message
            });
          }
        });
      }
    } catch (error) {
      errors.push({
        type: "unread cleanup",
        error: error.message
      });
    }
    
    return {
      success: deletedFiles.length > 0,
      itemId: cleanedItemId,
      ownerId: requestedOwnerId,
      deletedFiles,
      errors: errors.length > 0 ? errors : undefined
    };
    
  } catch (error) {
    return {
      success: false,
      error: `Failed to delete item: ${error.message}`
    };
  }
};