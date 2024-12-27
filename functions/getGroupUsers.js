import fs from "fs";

const getGroupUsers = (groupId) => {
  return JSON.parse(fs.readFileSync(`groups/${groupId}/users.json`, "utf8"));
};

export default getGroupUsers;
