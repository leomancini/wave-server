import fs from "fs";
import path from "path";
import confirmDirectoryExists from "./confirmDirectoryExists.js";

const CLAUDE_USER_ID = "claude-ai";
const CLAUDE_USER_NAME = "Claude";

export const getClaudeUserId = () => CLAUDE_USER_ID;

export default (groupId) => {
  const usersDir = path.join("groups", groupId, "users");
  confirmDirectoryExists(usersDir);

  const usersFile = path.join(usersDir, "identities.json");
  let users = [];

  if (fs.existsSync(usersFile)) {
    users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
  }

  const existing = users.find((u) => u.id === CLAUDE_USER_ID);
  if (!existing) {
    users.push({
      id: CLAUDE_USER_ID,
      name: CLAUDE_USER_NAME
    });
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  }

  return { id: CLAUDE_USER_ID, name: CLAUDE_USER_NAME };
};
