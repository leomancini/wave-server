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
    // Send mention notifications to @mentioned users who aren't already being notified
    const mentionedUserIds = extractMentionedUserIds(content?.comment || "", users);
    const alreadyNotifiedIds = new Set([uploaderId, userId, ...uniqueUserIds]);

    mentionedUserIds.forEach((mentionedUserId) => {
      if (!alreadyNotifiedIds.has(mentionedUserId)) {
        processNotificationForUser(
          "add",
          users,
          groupId,
          mentionedUserId,
          constructNotificationData(
            groupId,
            itemId,
            userId,
            "mention",
            content
          )
        );
        alreadyNotifiedIds.add(mentionedUserId);
      }
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
  } else if (type === "comment-reaction") {
    // Send notification to the comment author (uploaderId is used as commentAuthorId here)
    if (userId !== uploaderId) {
      processNotificationForUser(
        "add",
        users,
        groupId,
        uploaderId,
        constructNotificationData(groupId, itemId, userId, "reaction-on-your-comment", content)
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
  const userData = getUser(users, userId);

  // Check if user exists
  if (!userData || !userData.user) {
    console.warn(`User ${userId} not found in group ${groupId}`);
    return;
  }

  const user = userData.user;

  const notificationsDir = path.join("groups", groupId, "notifications");
  confirmDirectoryExists(notificationsDir);

  const notificationsUnsentDir = path.join(
    "groups",
    groupId,
    "notifications",
    "sms-unsent"
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
    // Check if user has notification preferences and handle cases where they don't
    if (
      user.notificationPreference === "SMS" &&
      user.phoneNumber &&
      user.phoneNumber.verified
    ) {
      notifications.push(notification);
    } else if (user.notificationPreference === "PUSH") {
      sendPushNotification(groupId, userId, {
        title: `New activity in WAVE!`,
        body: generateNotificationText(notification),
        url: `${process.env.CLIENT_URL}/${groupId}/${userId}#${notification.itemId}`,
        data: {
          itemId: notification.itemId,
          ...(notification.content?.commentIndex !== undefined && {
            commentIndex: notification.content.commentIndex
          })
        }
      });
    }
    // If user has no notification preference, we silently skip sending notifications
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

const extractMentionedUserIds = (commentText, users) => {
  if (!commentText || !users || users.length === 0) return [];

  const sortedUsers = [...users].sort((a, b) => b.name.length - a.name.length);
  const mentionedIds = [];
  const atRegex = /@/g;
  let match;

  while ((match = atRegex.exec(commentText)) !== null) {
    const afterAt = commentText.slice(match.index + 1);
    for (const user of sortedUsers) {
      if (afterAt.toLowerCase().startsWith(user.name.toLowerCase())) {
        const charAfter = afterAt[user.name.length];
        if (!charAfter || /[^a-zA-Z0-9]/.test(charAfter)) {
          if (!mentionedIds.includes(user.id)) {
            mentionedIds.push(user.id);
          }
          break;
        }
      }
    }
  }

  return mentionedIds;
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
