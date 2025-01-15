export default (users, userId) => {
  const index = users.findIndex((user) => user.id === userId);

  if (index === -1) {
    return false;
  }

  return {
    index,
    user: users[index]
  };
};
