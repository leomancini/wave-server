export default (notification) => {
  switch (notification.type) {
    case "upload":
      return `${notification.user.name} uploaded a new post.`;

    case "reaction":
      return `${notification.user.name} reacted ${notification.content.reaction} to your post.`;

    case "comment-on-your-post":
      return `${notification.user.name} commented on your post: "${notification.content.comment}"`;

    case "comment-on-post-you-commented-on":
      return `${notification.user.name} also commented on a post you commented on: "${notification.content.comment}"`;

    case "reaction-on-your-comment":
      return `${notification.user.name} reacted ${notification.content.reaction} to your comment.`;
  }

  return "";
};
