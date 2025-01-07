import * as fs from "fs";
import * as path from "path";

export default (groupId, itemId) => {
  let reactions = [];
  const reactionsFile = path.join(
    "groups",
    groupId,
    "reactions",
    `${itemId}.json`
  );
  if (fs.existsSync(reactionsFile)) {
    const reactionsData = fs.readFileSync(reactionsFile, "utf8");
    reactions = JSON.parse(reactionsData);
  }

  return reactions;
};
