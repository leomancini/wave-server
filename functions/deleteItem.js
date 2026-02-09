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
    const postId = metadata.postId || cleanedItemId;

    // Find the actual media file (could be .jpg, .mp4, .mov, etc.)
    const mediaDir = path.join(groupPath, "media");
    let mediaFilePath = null;
    if (fs.existsSync(mediaDir)) {
      const mediaFiles = fs.readdirSync(mediaDir);
      const match = mediaFiles.find((f) => path.parse(f).name === cleanedItemId);
      if (match) {
        mediaFilePath = path.join(mediaDir, match);
      }
    }

    // Define files for this item (media, thumbnail, metadata)
    const filesToDelete = [
      ...(mediaFilePath ? [{ path: mediaFilePath, type: "media" }] : []),
      {
        path: path.join(groupPath, "thumbnails", `${cleanedItemId}.jpg`),
        type: "thumbnail"
      },
      {
        path: path.join(groupPath, "metadata", `${cleanedItemId}.json`),
        type: "metadata"
      },
      // Also try to delete item-level reactions/comments (legacy)
      {
        path: path.join(groupPath, "reactions", `${cleanedItemId}.json`),
        type: "reactions"
      },
      {
        path: path.join(groupPath, "comments", `${cleanedItemId}.json`),
        type: "comments"
      }
    ];

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

    // Check if any other items share this postId
    let hasOtherItems = false;
    if (postId !== cleanedItemId) {
      const metadataDir = path.join(groupPath, "metadata");

      if (fs.existsSync(metadataDir)) {
        const metadataFiles = fs.readdirSync(metadataDir);
        hasOtherItems = metadataFiles.some((file) => {
          try {
            const otherMetadata = JSON.parse(
              fs.readFileSync(path.join(metadataDir, file), "utf8")
            );
            return (
              otherMetadata.postId === postId &&
              otherMetadata.itemId !== cleanedItemId
            );
          } catch {
            return false;
          }
        });
      }

      // If no other items remain, delete post-level reactions/comments
      if (!hasOtherItems) {
        const postFiles = [
          {
            path: path.join(groupPath, "reactions", `${postId}.json`),
            type: "post-reactions"
          },
          {
            path: path.join(groupPath, "comments", `${postId}.json`),
            type: "post-comments"
          }
        ];

        postFiles.forEach(({ path: filePath, type }) => {
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              deletedFiles.push({ type, path: filePath });
            }
          } catch (error) {
            errors.push({ type, path: filePath, error: error.message });
          }
        });
      }
    }

    // Also remove from unread items for all users
    try {
      const unreadDir = path.join(groupPath, "users", "unread");
      if (fs.existsSync(unreadDir)) {
        const unreadFiles = fs.readdirSync(unreadDir);
        unreadFiles.forEach(unreadFile => {
          try {
            const unreadPath = path.join(unreadDir, unreadFile);
            const unreadItems = JSON.parse(fs.readFileSync(unreadPath, "utf8"));
            // Remove itemId (legacy) and postId (only if this is the last item in the post)
            const updatedItems = unreadItems.filter(item => {
              if (item === cleanedItemId) return false;
              if (item === postId && !hasOtherItems) return false;
              return true;
            });

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
