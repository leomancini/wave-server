import * as fs from "fs";
import * as path from "path";

import getGroupUsers from "./getGroupUsers.js";

export default async (groupId, itemId, uploaderId) => {
  const users = getGroupUsers(groupId);
  const unreadDir = path.join("groups", groupId, "users", "unread");

  if (!fs.existsSync(unreadDir)) {
    fs.mkdirSync(unreadDir, { recursive: true });
  }

  for (const user of users) {
    if (user.id === uploaderId) continue;

    const unreadPath = path.join(unreadDir, `${user.id}.json`);
    let unreadItems = [];

    if (fs.existsSync(unreadPath)) {
      try {
        const fileContent = fs.readFileSync(unreadPath, "utf8");
        if (fileContent.trim()) {
          unreadItems = JSON.parse(fileContent);
        }
      } catch (error) {
        console.error(`Error reading unread items for user ${user.id}:`, error);
      }
    }

    if (!Array.isArray(unreadItems)) {
      unreadItems = [];
    }

    if (!unreadItems.includes(itemId)) {
      unreadItems.push(itemId);
      try {
        await fs.promises.writeFile(
          unreadPath,
          JSON.stringify(unreadItems, null, 2)
        );
      } catch (error) {
        console.error(`Error writing unread items for user ${user.id}:`, error);
      }
    }
  }
};
