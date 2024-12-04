import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const port = 3107;

const groups = ["ASIA2425"];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

const getGroupUsers = (groupId) => {
  return JSON.parse(fs.readFileSync(`groups/${groupId}/users.json`, "utf8"));
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "groups/" + groups[0] + "/media";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filename = file.originalname;
    const groupId = filename.split("-")[0];
    const uploaderId = filename.split("-")[1];
    const isKnownUser = getGroupUsers(groupId).some(
      (user) => user.id === uploaderId
    );

    if (!isKnownUser) {
      cb(new Error("Unknown user tried to upload, file rejected!"));
      return;
    }

    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image or video files are allowed!"));
    }
  }
});

app.post("/upload", upload.array("media", 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No media files provided!" });
    }

    req.files.forEach((file) => {
      const extension = file.originalname.split(".").pop();
      const uploaderId = req.body.uploaderId;
      const newFilename = `${Date.now()}-${uploaderId}-${Math.floor(
        Math.random() * 10000000000
      )}.${extension}`;
      fs.renameSync(file.path, path.join(path.dirname(file.path), newFilename));
      file.filename = newFilename;
      file.path = path.join(path.dirname(file.path), newFilename);
    });

    res.json({
      message: `Successfully uploaded ${req.files.length} media file${
        req.files.length > 1 ? "s" : ""
      }!`
    });
  } catch (error) {
    console.error("Upload error:", error);

    res.status(500).json({
      error: "An error occurred while uploading files!",
      details: error.message
    });
  }
});

app.get("/media/:groupId", (req, res) => {
  try {
    const groupId = req.params.groupId;
    const mediaDir = `groups/${groupId}/media`;

    if (!fs.existsSync(mediaDir)) {
      return res.status(404).json({ error: "Group media directory not found" });
    }

    const files = fs.readdirSync(mediaDir);
    const mediaFiles = files.map((filename) => {
      const filePath = path.join(mediaDir, filename);
      const stats = fs.statSync(filePath);
      const uploaderId = filename.split("-")[1].split(".")[0];
      const users = getGroupUsers(groupId);
      const uploader = users.find((user) => user.id === uploaderId);

      // Get reactions for this media file
      let reactions = [];
      const reactionsFile = path.join(
        "groups",
        groupId,
        "reactions",
        `${filename}.json`
      );
      if (fs.existsSync(reactionsFile)) {
        const reactionsData = fs.readFileSync(reactionsFile, "utf8");
        reactions = JSON.parse(reactionsData);
      }

      return {
        filename: filename,
        uploader: {
          id: uploader?.id || "unknown",
          name: uploader?.name || "Unknown"
        },
        path: `/groups/${groupId}/media/${filename}`,
        size: stats.size,
        created: stats.birthtime,
        reactions: reactions.map((r) => {
          const user = users.find((u) => u.id === r.userId);
          return {
            ...r,
            user: {
              id: user?.id || "unknown",
              name: user?.name || "Unknown"
            }
          };
        })
      };
    });

    mediaFiles.sort((a, b) => b.created - a.created);

    res.json({
      groupId: groupId,
      mediaCount: mediaFiles.length,
      media: mediaFiles
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/media/:groupId/:filename", (req, res) => {
  try {
    const { groupId, filename } = req.params;
    const filePath = path.join("groups", groupId, "media", filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    res.sendFile(path.resolve(filePath));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/media/:groupId/:filename/reactions", (req, res) => {
  try {
    const { groupId, filename } = req.params;
    const { userId, reaction } = req.body;

    // Validate required fields
    if (!userId || !reaction) {
      return res
        .status(400)
        .json({ error: "userId and reaction are required" });
    }

    // Verify the media file exists
    const mediaPath = path.join("groups", groupId, "media", filename);
    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    // Create reactions directory if it doesn't exist
    const reactionsDir = path.join("groups", groupId, "reactions");
    if (!fs.existsSync(reactionsDir)) {
      fs.mkdirSync(reactionsDir, { recursive: true });
    }

    // Create/update reactions file for the media item
    const reactionsFile = path.join(reactionsDir, `${filename}.json`);
    let reactions = [];

    if (fs.existsSync(reactionsFile)) {
      const data = fs.readFileSync(reactionsFile, "utf8");
      reactions = JSON.parse(data);

      // Check if user already has the same reaction
      const existingReaction = reactions.find(
        (r) => r.userId === userId && r.reaction === reaction
      );
      if (existingReaction) {
        // Remove the reaction if it already exists
        reactions = reactions.filter((r) => r.userId !== userId);
      } else {
        // Remove any different reaction from this user
        reactions = reactions.filter((r) => r.userId !== userId);
        // Add new reaction
        reactions.push({
          userId,
          reaction,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      // Add new reaction if no reactions file exists
      reactions.push({
        userId,
        reaction,
        timestamp: new Date().toISOString()
      });
    }

    // Save reactions to file
    fs.writeFileSync(reactionsFile, JSON.stringify(reactions, null, 2));

    res.json({
      success: true,
      reactions: reactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
