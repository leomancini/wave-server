export default (items) => {
  const posts = [];
  const processedItemIds = new Set();

  for (const item of items) {
    if (processedItemIds.has(item.metadata.itemId)) continue;

    const postId = item.metadata.postId || item.metadata.itemId;

    // Group items that share the same explicit postId
    const postItems = items.filter(
      (i) =>
        !processedItemIds.has(i.metadata.itemId) &&
        (i.metadata.postId || i.metadata.itemId) === postId
    );

    // Sort post items by orderIndex if available, otherwise by uploadDate ascending
    postItems.sort((a, b) => {
      const aOrder = a.metadata.orderIndex;
      const bOrder = b.metadata.orderIndex;
      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      return a.metadata.uploadDate - b.metadata.uploadDate;
    });

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
