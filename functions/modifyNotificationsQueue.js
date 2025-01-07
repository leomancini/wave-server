import * as fs from "fs";
import * as path from "path";

import getGroupUsers from "./getGroupUsers.js";
import getUsername from "./getUsername.js";
import getCommentsForItem from "./getCommentsForItem.js";

const modifyNotificationsQueueFileForUser = (
  action,
  groupId,
  userId,
  notification
) => {
  const notificationsDir = path.join("groups", groupId, "notifications");
  if (!fs.existsSync(notificationsDir)) {
    fs.mkdirSync(notificationsDir);
  }

  let notifications = [];
  const notificationPath = path.join(notificationsDir, `${userId}.json`);

  if (fs.existsSync(notificationPath)) {
    try {
      const fileContent = fs.readFileSync(notificationPath, "utf8");
      if (fileContent.trim()) {
        const data = JSON.parse(fileContent);
        notifications = Array.isArray(data) ? data : [];
      }
    } catch (error) {
      console.error("Error parsing notifications file:", error);
      notifications = [];
    }
  }

  if (action === "add") {
    notifications.push(notification);
  } else if (action === "remove") {
    notifications = notifications.filter(
      (n) =>
        !(
          n.itemId === notification.itemId &&
          n.type === notification.type &&
          n.user.id === notification.user.id
        )
    );
  }

  fs.writeFileSync(notificationPath, JSON.stringify(notifications, null, 2));
};

const constructNotificationData = (groupId, itemId, userId, type) => {
  return {
    itemId,
    type,
    user: {
      id: userId,
      name: getUsername(userId, groupId)
    }
  };
};

export default async (action, groupId, itemId, uploaderId, userId, type) => {
  if (type === "upload") {
    // Add to queue for all users in the group, other than the uploader
    const users = getGroupUsers(groupId);
    users.forEach((user) => {
      if (user.id !== uploaderId) {
        modifyNotificationsQueueFileForUser(
          "add",
          groupId,
          user.id,
          constructNotificationData(groupId, itemId, uploaderId, type)
        );
      }
    });
  } else if (type === "comment") {
    // Add to queue for uploader, if the commenter is not the uploader
    if (userId !== uploaderId) {
      modifyNotificationsQueueFileForUser(
        "add",
        groupId,
        uploaderId,
        constructNotificationData(
          groupId,
          itemId,
          userId,
          "comment-on-your-post"
        )
      );
    }

    // Add to queue for anyone who has already commented on this post,
    // other than the uploader and the commenter
    const comments = getCommentsForItem(groupId, itemId);
    let uniqueUserIds = [...new Set(comments.map((comment) => comment.userId))];
    uniqueUserIds = uniqueUserIds.filter(
      (id) => id !== uploaderId && id !== userId
    );
    uniqueUserIds.forEach((uniqueUserId) => {
      modifyNotificationsQueueFileForUser(
        "add",
        groupId,
        uniqueUserId,
        constructNotificationData(
          groupId,
          itemId,
          userId,
          "comment-on-post-you-commented-on"
        )
      );
    });
  } else if (type === "reaction") {
    // Add to or remove from queue for uploader,
    // if the reactor is not the uploader
    if (userId !== uploaderId) {
      modifyNotificationsQueueFileForUser(
        action,
        groupId,
        uploaderId,
        constructNotificationData(groupId, itemId, userId, type)
      );
    }
  }
};