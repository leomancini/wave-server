import fs from "fs";
import path from "path";

export default (groupId, file, data) => {
  const filePath = path.join("groups", groupId, `${file}.json`);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  return;
};
