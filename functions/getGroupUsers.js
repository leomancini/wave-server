import fs from "fs";

const getGroupUsers = (groupId, { includeDuplicates = false } = {}) => {
  const usersFile = `groups/${groupId}/users/identities.json`;
  if (!fs.existsSync(usersFile)) {
    return [];
  } else {
    let users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    if (!includeDuplicates) {
      users = users.filter((user) => !user.isDuplicate);
    }
    return users;
  }
};

export default getGroupUsers;
