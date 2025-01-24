import fs from "fs";
import path from "path";

export default (groupId, userId) => {
  const notificationsPath = path.join(
    "groups",
    groupId,
    "notifications",
    "sms-unsent",
    `${userId}.json`
  );

  if (fs.existsSync(notificationsPath)) {
    try {
      fs.writeFileSync(notificationsPath, "[]");
      return true;
    } catch (error) {
      console.error("Error clearing notifications queue:", error);
      return false;
    }
  }

  return true;
};
