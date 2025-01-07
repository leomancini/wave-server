import * as fs from "fs";
import * as path from "path";

export default (groupId, itemId) => {
  let comments = [];
  const commentsFile = path.join(
    "groups",
    groupId,
    "comments",
    `${itemId}.json`
  );
  if (fs.existsSync(commentsFile)) {
    const commentsData = fs.readFileSync(commentsFile, "utf8");
    comments = JSON.parse(commentsData);
  }

  return comments;
};
