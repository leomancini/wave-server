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

      return {
        filename: filename,
        uploader: {
          id: uploader?.id || "unknown",
          name: uploader?.name || "Unknown"
        },
        path: `/groups/${groupId}/media/${filename}`,
        size: stats.size,
        created: stats.birthtime
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
