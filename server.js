import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const app = express();
const port = 3107;

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
    const filename = file.originalname;
    const groupId = filename.split("-")[0];
    const uploadDir = "groups/" + groupId + "/media";
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

    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"));
    }
  }
});

import saveMetadata from "./functions/saveMetadata.js";
import generateThumbnail from "./functions/generateThumbnail.js";
import getDimensions from "./functions/getDimensions.js";

import compressGroupMedia from "./utilities/compress-group-media.js";
import addMetadataAndThumbnails from "./utilities/add-metadata-and-thumbnails.js";

app.get("/compress-group-media/:groupId", async (req, res) => {
  const result = await compressGroupMedia(req.params.groupId);
  res.json(result);
});

app.get("/add-metadata-and-thumbnails/:groupId", async (req, res) => {
  const result = await addMetadataAndThumbnails(req.params.groupId);
  res.json(result);
});

app.post("/upload", upload.array("media", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No media files provided!" });
    }

    for (const file of req.files) {
      const uploaderId = req.body.uploaderId;
      const newFilename = `${Date.now()}-${uploaderId}-${Math.floor(
        Math.random() * 10000000000
      )}.jpg`;
      const newPath = path.join(path.dirname(file.path), newFilename);

      if (file.mimetype.startsWith("image/")) {
        const dimensions = await getDimensions(file.path);

        await sharp(file.path)
          .rotate()
          .resize(1920, 1080, {
            fit: "inside",
            withoutEnlargement: true
          })
          .jpeg({ quality: 100 })
          .toFile(newPath);

        fs.unlinkSync(file.path);

        const groupId = file.originalname.split("-")[0];
        await saveMetadata(groupId, file, newFilename, uploaderId, dimensions);

        await generateThumbnail(groupId, newPath, newFilename);
      }

      file.filename = newFilename;
      file.path = newPath;
    }

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
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const mediaDir = `groups/${groupId}/media`;

    if (!fs.existsSync(mediaDir)) {
      return res.status(404).json({ error: "Group media directory not found" });
    }

    const addUsernames = (data) => {
      const users = getGroupUsers(groupId);

      return data.map((r) => {
        const user = users.find((u) => u.id === r.userId);
        return {
          ...r,
          user: {
            id: user?.id || "unknown",
            name: user?.name || "Unknown"
          }
        };
      });
    };

    const files = fs.readdirSync(mediaDir);
    const mediaFiles =
      files.length > 0
        ? files
            .map((filename) => {
              const filePath = path.join(mediaDir, filename);
              const stats = fs.statSync(filePath);

              const filenameParts = filename.split("-");
              if (filenameParts.length < 2) {
                return null;
              }

              const uploaderId = filenameParts[1].split(".")[0];
              const users = getGroupUsers(groupId);
              const uploader = users.find((user) => user.id === uploaderId);

              let reactions = [];
              const reactionsFile = path.join(
                "groups",
                groupId,
                "reactions",
                `${path.parse(filename).name}.json`
              );
              if (fs.existsSync(reactionsFile)) {
                const reactionsData = fs.readFileSync(reactionsFile, "utf8");
                reactions = JSON.parse(reactionsData);
              }

              let metadata = {};
              const metadataFile = path.join(
                "groups",
                groupId,
                "metadata",
                `${path.parse(filename).name}.json`
              );
              if (fs.existsSync(metadataFile)) {
                const metadataData = fs.readFileSync(metadataFile, "utf8");
                metadata = JSON.parse(metadataData);
              }

              let comments = [];
              const commentsFile = path.join(
                "groups",
                groupId,
                "comments",
                `${path.parse(filename).name}.json`
              );
              if (fs.existsSync(commentsFile)) {
                const commentsData = fs.readFileSync(commentsFile, "utf8");
                comments = JSON.parse(commentsData);
              }

              return {
                filename: filename,
                uploader: {
                  id: uploader?.id || "unknown",
                  name: uploader?.name || "Unknown"
                },
                path: `/groups/${groupId}/media/${filename}`,
                metadata,
                reactions: addUsernames(reactions),
                comments: addUsernames(comments)
              };
            })
            .filter(Boolean)
        : [];

    mediaFiles.sort((a, b) => b.metadata.uploadDate - a.metadata.uploadDate);

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const totalPages = Math.ceil(mediaFiles.length / limit);
    const paginatedFiles = mediaFiles.slice(startIndex, endIndex);

    res.json({
      groupId: groupId,
      mediaCount: mediaFiles.length,
      currentPage: page,
      totalPages: totalPages,
      hasMore: page < totalPages,
      hasPrevPage: page > 1,
      media: paginatedFiles
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

app.get("/media/:groupId/:filename/thumbnail", (req, res) => {
  try {
    const { groupId, filename } = req.params;
    const filePath = path.join("groups", groupId, "thumbnails", filename);

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

    if (!userId || !reaction) {
      return res
        .status(400)
        .json({ error: "userId and reaction are required" });
    }

    const mediaPath = path.join("groups", groupId, "media", filename);
    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    const reactionsDir = path.join("groups", groupId, "reactions");
    if (!fs.existsSync(reactionsDir)) {
      fs.mkdirSync(reactionsDir, { recursive: true });
    }

    const reactionsFile = path.join(
      reactionsDir,
      `${path.parse(filename).name}.json`
    );
    let reactions = [];

    if (fs.existsSync(reactionsFile)) {
      const data = fs.readFileSync(reactionsFile, "utf8");
      reactions = JSON.parse(data);

      const existingReaction = reactions.find(
        (r) => r.userId === userId && r.reaction === reaction
      );
      if (existingReaction) {
        reactions = reactions.filter((r) => r.userId !== userId);
      } else {
        reactions = reactions.filter((r) => r.userId !== userId);
        reactions.push({
          userId,
          reaction,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      reactions.push({
        userId,
        reaction,
        timestamp: new Date().toISOString()
      });
    }

    fs.writeFileSync(reactionsFile, JSON.stringify(reactions, null, 2));

    res.json({
      success: true,
      reactions: reactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/media/:groupId/:filename/comment", async (req, res) => {
  try {
    const { groupId, filename } = req.params;
    const { userId, comment } = req.body;

    if (!userId || !comment) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const mediaPath = path.join("groups", groupId, "media", filename);
    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    const commentsDir = path.join("groups", groupId, "comments");
    if (!fs.existsSync(commentsDir)) {
      fs.mkdirSync(commentsDir, { recursive: true });
    }

    const commentsFile = path.join(
      commentsDir,
      `${path.parse(filename).name}.json`
    );
    let comments = [];

    if (fs.existsSync(commentsFile)) {
      const data = fs.readFileSync(commentsFile, "utf8");
      comments = JSON.parse(data);
    }

    comments.push({
      userId,
      comment,
      timestamp: new Date().toISOString()
    });

    fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));

    res.json({
      success: true,
      comments: comments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/validate-group-user/:groupId/:userId", (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const groupPath = path.join("groups", groupId);
    if (!fs.existsSync(groupPath)) {
      return res.status(404).json({
        valid: false,
        error: "Group not found"
      });
    }

    const users = getGroupUsers(groupId);
    const userExists = users.some((user) => user.id === userId);

    res.json({
      valid: userExists,
      error: userExists ? null : "User not found in group"
    });
  } catch (error) {
    res.status(500).json({
      valid: false,
      error: error.message
    });
  }
});

app.post("/create-group", (req, res) => {
  try {
    const { groupName, userName } = req.body;

    if (!groupName || !userName) {
      return res.status(400).json({
        error: "Group name and username are required"
      });
    }

    const groupId = groupName.toUpperCase().replace(/\s+/g, "-");
    const groupPath = path.join("groups", groupId);

    if (fs.existsSync(groupPath)) {
      return res.status(400).json({
        error: "A group with this name already exists"
      });
    }

    const userId = Math.floor(Math.random() * 1000000).toString();

    fs.mkdirSync(groupPath);
    fs.mkdirSync(path.join(groupPath, "media"));
    fs.mkdirSync(path.join(groupPath, "metadata"));
    fs.mkdirSync(path.join(groupPath, "thumbnails"));
    fs.mkdirSync(path.join(groupPath, "reactions"));
    fs.mkdirSync(path.join(groupPath, "comments"));

    const users = [
      {
        id: userId,
        name: userName
      }
    ];
    fs.writeFileSync(
      path.join(groupPath, "users.json"),
      JSON.stringify(users, null, 2)
    );

    res.json({
      success: true,
      groupId,
      userId,
      message: "Group created successfully"
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to create group",
      details: error.message
    });
  }
});
