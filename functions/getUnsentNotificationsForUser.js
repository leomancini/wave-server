import fs from "fs";
import path from "path";

export default (groupId, userId) => {
  const notificationsPath = path.join(
    "groups",
    groupId,
    "notifications",
    "unsent",
    `${userId}.json`
  );

  if (!fs.existsSync(notificationsPath)) {
    return [];
  }

  try {
    const notificationsFileContent = fs.readFileSync(notificationsPath, "utf8");
    if (!notificationsFileContent.trim()) {
      return [];
    }
    const notifications = JSON.parse(notificationsFileContent);
    return Array.isArray(notifications) ? notifications : [];
  } catch (error) {
    console.error("Error reading notifications file:", error);
    return [];
  }
};
