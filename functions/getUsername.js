import getGroupUsers from "./getGroupUsers.js";

export default (userId, groupId) => {
  const users = getGroupUsers(groupId);

  return users.find((u) => u.id === userId)?.name;
};
