import fs from "fs";
import path from "path";
import getGroupUsers from "./getGroupUsers.js";
import getMetadataForItem from "./getMetadataForItem.js";

export default (groupId) => {
  const groupPath = path.join("groups", groupId);

  if (!fs.existsSync(groupPath)) {
    return {};
  }

  const users = getGroupUsers(groupId);
  const userCount = users.length;

  const mediaPath = path.join(groupPath, "media");
  let mediaCount = 0;
  if (fs.existsSync(mediaPath)) {
    const mediaFiles = fs.readdirSync(mediaPath);
    const postIds = new Set();
    mediaFiles.forEach((filename) => {
      const itemId = path.parse(filename).name;
      const metadata = getMetadataForItem(groupId, itemId);
      const postId = metadata.postId || itemId;
      postIds.add(postId);
    });
    mediaCount = postIds.size;
  }

  const reactionsPath = path.join(groupPath, "reactions");
  let totalReactions = 0;
  let reactionCounts = {};

  if (fs.existsSync(reactionsPath)) {
    const reactionFiles = fs.readdirSync(reactionsPath);
    reactionFiles.forEach((file) => {
      const reactions = JSON.parse(
        fs.readFileSync(path.join(reactionsPath, file), "utf8")
      );
      totalReactions += reactions.length;
      reactions.forEach((reaction) => {
        reactionCounts[reaction.reaction] =
          (reactionCounts[reaction.reaction] || 0) + 1;
      });
    });
  }

  const topReactions = Object.entries(reactionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([reaction, count]) => ({ reaction, count }));

  const commentsPath = path.join(groupPath, "comments");
  let totalComments = 0;
  if (fs.existsSync(commentsPath)) {
    const commentFiles = fs.readdirSync(commentsPath);
    totalComments = commentFiles.reduce((sum, file) => {
      const comments = JSON.parse(
        fs.readFileSync(path.join(commentsPath, file), "utf8")
      );
      return sum + comments.length;
    }, 0);
  }

  return {
    userCount,
    mediaCount,
    totalReactions,
    topReactions,
    totalComments
  };
};
