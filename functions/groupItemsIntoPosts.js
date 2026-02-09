const POST_GROUPING_WINDOW_MS = 120000; // 2 minutes

export default (items) => {
  const posts = [];
  const processedItemIds = new Set();

  for (const item of items) {
    if (processedItemIds.has(item.metadata.itemId)) continue;

    const postId = item.metadata.postId || item.metadata.itemId;

    let postItems;
    if (item.metadata.postId && item.metadata.postId !== item.metadata.itemId) {
      // Explicit postId (new multi-photo uploads)
      postItems = items.filter(
        (i) =>
          !processedItemIds.has(i.metadata.itemId) &&
          i.metadata.postId === postId
      );
    } else {
      // Legacy grouping or single-photo: same uploader, within 2 minutes
      postItems = items.filter((i) => {
        if (processedItemIds.has(i.metadata.itemId)) return false;
        if (i.metadata.postId && i.metadata.postId !== i.metadata.itemId)
          return false;
        return (
          i.metadata.uploaderId === item.metadata.uploaderId &&
          Math.abs(i.metadata.uploadDate - item.metadata.uploadDate) <=
            POST_GROUPING_WINDOW_MS
        );
      });
    }

    // Sort post items by uploadDate ascending (oldest first within the post)
    postItems.sort((a, b) => a.metadata.uploadDate - b.metadata.uploadDate);

    postItems.forEach((i) => processedItemIds.add(i.metadata.itemId));

    // Use the earliest item's uploadDate as the post date
    const earliestItem = postItems[0];

    posts.push({
      postId,
      items: postItems,
      uploader: earliestItem.uploader,
      uploadDate: earliestItem.metadata.uploadDate,
      isUnread: postItems.some((i) => i.isUnread)
    });
  }

  return posts;
};
