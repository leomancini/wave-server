import * as fs from "fs";

export default (directory) => {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
};
