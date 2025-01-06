import * as fs from "fs";
import * as path from "path";

import getGroupUsers from "./getGroupUsers.js";

export default async (groupId, newFilename, uploaderId) => {
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
      unreadItems = JSON.parse(fs.readFileSync(unreadPath, "utf8"));
    }

    if (!unreadItems.includes(newFilename)) {
      unreadItems.push(newFilename);
      await fs.promises.writeFile(
        unreadPath,
        JSON.stringify(unreadItems, null, 2)
      );
    }
  }
};
