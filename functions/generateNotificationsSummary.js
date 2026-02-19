export default (groupId, userId, notifications) => {
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

      case "reaction-on-your-comment":
        return `${formatUserList(users)} reacted to your ${
          itemCount > 1 ? "comments" : "comment"
        }`;

      case "upload":
        const contentCount = group.length;
        return `${formatUserList(users)} added ${
          contentCount > 1 ? "posts" : "a post"
        }`;

      case "mention":
        return `${formatUserList(users)} mentioned you in a comment`;

      default:
        return `Unknown: ${type}`;
    }
  });

  const baseUrl = `${process.env.CLIENT_URL}/${groupId}/${userId}`;
  const prefix = `(WAVE)${groupId}: `;
  const suffix = `. ${baseUrl}`;
  const mainText = summaries.join(". ");

  // Split into multiple messages if too long
  if ((prefix + mainText + suffix).length > 160) {
    return summaries.map((summary, index) => {
      const isFirst = index === 0;
      const isLast = index === summaries.length - 1;

      return `${isFirst ? prefix : ""}${summary}${isLast ? suffix : "."}`;
    });
  }

  return prefix + mainText + suffix;
};

const formatUserList = (users) => {
  if (users.length === 1) return users[0];
  if (users.length === 2) return `${users[0]} and ${users[1]}`;
  return `${users[0]}, ${users[1]}, and ${users.length - 2} ${
    users.length - 2 > 1 ? "others" : "other"
  }`;
};
