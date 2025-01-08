export default (groupId, notifications) => {
  const grouped = notifications.reduce((acc, notification) => {
    const key = notification.type;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(notification);
    return acc;
  }, {});

  const summaries = Object.entries(grouped).map(([type, group]) => {
    const users = [...new Set(group.map((n) => n.user.name))];
    const itemCount = new Set(group.map((n) => n.itemId)).size;
    const itemText = itemCount > 1 ? `posts` : "a post";
    const yourItemText = itemCount > 1 ? `your posts` : "your post";

    switch (type) {
      case "reaction":
        return `${formatUserList(users)} reacted to ${yourItemText}`;

      case "comment-on-your-post":
        return `${formatUserList(users)} commented on ${yourItemText}`;

      case "comment-on-post-you-commented-on":
        return `${formatUserList(
          users
        )} also commented on ${itemText} that you commented on`;

      case "upload":
        const contentCount = group.length;
        return `${formatUserList(users)} added ${
          contentCount > 1 ? `${contentCount} posts` : "a new post"
        }`;

      default:
        return `Unknown notification type: ${type}`;
    }
  });

  return `New activity in (WAVE)${groupId}! ${
    summaries.join(". ") + (summaries.length ? "." : "")
  }`;
};

const formatUserList = (users) => {
  if (users.length === 1) return users[0];
  if (users.length === 2) return `${users[0]} and ${users[1]}`;
  if (users.length <= 3) return `${users[0]}, ${users[1]}, and ${users[2]}`;
  return `${users[0]}, ${users[1]}, ${users[2]} + ${users.length - 3} others`;
};
