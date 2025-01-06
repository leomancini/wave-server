import fs from "fs";

const getGroupUsers = (groupId) => {
  return JSON.parse(
    fs.readFileSync(`groups/${groupId}/users/identities.json`, "utf8")
  );
};

export default getGroupUsers;
