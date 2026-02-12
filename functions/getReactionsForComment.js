import * as fs from "fs";
import * as path from "path";

export default (groupId, postId, commentIndex) => {
  let reactions = [];
  const reactionsFile = path.join(
    "groups",
    groupId,
    "comment-reactions",
    `${postId}-${commentIndex}.json`
  );
  if (fs.existsSync(reactionsFile)) {
    const reactionsData = fs.readFileSync(reactionsFile, "utf8");
    reactions = JSON.parse(reactionsData);
  }

  return reactions;
};
