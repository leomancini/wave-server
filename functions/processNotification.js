import * as fs from "fs";
import * as path from "path";

import confirmDirectoryExists from "./confirmDirectoryExists.js";
import getGroupUsers from "./getGroupUsers.js";
import getUser from "./getUser.js";
import getUsername from "./getUsername.js";
import getCommentsForItem from "./getCommentsForItem.js";
import generateNotificationText from "./generateNotificationText.js";
import sendPushNotification from "./sendPushNotification.js";

export default async (
  action,
  groupId,
  itemId,
  uploaderId,
  userId,
  type,
  content
) => {
  const users = getGroupUsers(groupId);

  if (type === "upload") {
    // Add to queue for all users in the group, other than the uploader
    users.forEach((user) => {
      if (user.id !== uploaderId) {
        processNotificationForUser(
          "add",
          users,
          groupId,
          user.id,
          constructNotificationData(groupId, itemId, uploaderId, type, content)
        );
      }
    });
  } else if (type === "comment") {
    // Add to queue for uploader, if the commenter is not the uploader
    if (userId !== uploaderId) {
      processNotificationForUser(
        "add",
        users,
        groupId,
        uploaderId,
        constructNotificationData(
          groupId,
          itemId,
          userId,
          "comment-on-your-post",
          content
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
      processNotificationForUser(
        "add",
        users,
        groupId,
        uniqueUserId,
        constructNotificationData(
          groupId,
          itemId,
          userId,
          "comment-on-post-you-commented-on",
          content
        )
      );
    });
  } else if (type === "reaction") {
    // Add to or remove from queue for uploader,
    // if the reactor is not the uploader
    if (userId !== uploaderId) {
      processNotificationForUser(
        action,
        users,
        groupId,
        uploaderId,
        constructNotificationData(groupId, itemId, userId, type, content)
      );
    }
  }
};

const processNotificationForUser = async (
  action,
  users,
  groupId,
  userId,
  notification
) => {
  const user = getUser(users, userId);

  const notificationsDir = path.join("groups", groupId, "notifications");
  confirmDirectoryExists(notificationsDir);

  const notificationsUnsentDir = path.join(
    "groups",
    groupId,
    "notifications",
    "unsent"
  );
  confirmDirectoryExists(notificationsUnsentDir);

  let notifications = [];
  const notificationPath = path.join(notificationsUnsentDir, `${userId}.json`);

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

    if (user.notificationPreference === "PUSH") {
      sendPushNotification(groupId, userId, {
        title: `New activity in WAVE!`,
        body: generateNotificationText(notification)
      });
    }
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

const constructNotificationData = (groupId, itemId, userId, type, content) => {
  return {
    itemId,
    type,
    user: {
      id: userId,
      name: getUsername(userId, groupId)
    },
    content
  };
};
