import fs from "fs";
import path from "path";

export default (groupId) => {
  try {
    const groupPath = `groups/${groupId}`;
    const mediaPath = `${groupPath}/media`;
    const mediaFiles = fs.readdirSync(mediaPath);

    const earliestDate = mediaFiles.reduce((earliest, file) => {
      const stats = fs.statSync(path.join(mediaPath, file));
      return earliest
        ? Math.min(earliest, stats.birthtimeMs)
        : stats.birthtimeMs;
    }, null);

    const config = {
      createdAt: new Date(earliestDate).toISOString(),
      reactions: ["❤️", "‼️", "😂", "🔥", "🌊"]
    };

    fs.writeFileSync(
      path.join(groupPath, "config.json"),
      JSON.stringify(config, null, 2)
    );

    return {
      message: `Successfully added config to group ${groupId}`
    };
  } catch (error) {
    console.error(error);
    return {
      error: "Failed to add config to group"
    };
  }
};
