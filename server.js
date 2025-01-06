import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import QRCode from "qrcode";

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

import saveMetadata from "./functions/saveMetadata.js";
import generateThumbnail from "./functions/generateThumbnail.js";
import getDimensions from "./functions/getDimensions.js";
import getGroupUsers from "./functions/getGroupUsers.js";
import generateUserId from "./functions/generateUserId.js";

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

    if (groupId === "DEMO") {
      cb(new Error("Tried to upload media to demo group, file rejected!"));
      return;
    }

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

import compressGroupMedia from "./utilities/compress-group-media.js";
import addMetadataAndThumbnails from "./utilities/add-metadata-and-thumbnails.js";
import addConfigToExistingGroup from "./utilities/add-config-to-existing-group.js";

app.get("/compress-group-media/:groupId", async (req, res) => {
  const result = await compressGroupMedia(req.params.groupId);
  res.json(result);
});

app.get("/add-metadata-and-thumbnails/:groupId", async (req, res) => {
  const result = await addMetadataAndThumbnails(req.params.groupId);
  res.json(result);
});

app.get("/add-config-to-existing-group/:groupId", (req, res) => {
  const result = addConfigToExistingGroup(req.params.groupId);
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

app.get("/config/:groupId", (req, res) => {
  try {
    const { groupId } = req.params;
    const configPath = path.join("groups", groupId, "config.json");

    if (!fs.existsSync(configPath)) {
      return res.status(404).json({
        error: "Group configuration not found"
      });
    }

    const configData = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(configData);

    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: "Failed to get group configuration",
      details: error.message
    });
  }
});

app.get("/stats/:groupId", (req, res) => {
  try {
    const { groupId } = req.params;
    const groupPath = path.join("groups", groupId);

    if (!fs.existsSync(groupPath)) {
      return res.status(404).json({
        error: "Group not found"
      });
    }

    // Get user count
    const usersPath = path.join(groupPath, "users.json");
    const users = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    const userCount = users.filter((user) => !user.isSecondary).length;

    // Get media count
    const mediaPath = path.join(groupPath, "media");
    const mediaFiles = fs.readdirSync(mediaPath);
    const mediaCount = mediaFiles.length;

    // Get reaction stats and top reactions
    const reactionsPath = path.join(groupPath, "reactions");
    let totalReactions = 0;
    let reactionCounts = {};

    if (fs.existsSync(reactionsPath)) {
      const reactionFiles = fs.readdirSync(reactionsPath);
      reactionFiles.forEach((file) => {
        const reactions = JSON.parse(
          fs.readFileSync(path.join(reactionsPath, file), "utf8")
        );
        totalReactions += reactions.length;

        reactions.forEach((reaction) => {
          reactionCounts[reaction.reaction] =
            (reactionCounts[reaction.reaction] || 0) + 1;
        });
      });
    }

    // Get top 3 reactions
    const topReactions = Object.entries(reactionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([reaction, count]) => ({ reaction, count }));

    // Get comment stats
    const commentsPath = path.join(groupPath, "comments");
    let totalComments = 0;
    if (fs.existsSync(commentsPath)) {
      const commentFiles = fs.readdirSync(commentsPath);
      totalComments = commentFiles.reduce((sum, file) => {
        const comments = JSON.parse(
          fs.readFileSync(path.join(commentsPath, file), "utf8")
        );
        return sum + comments.length;
      }, 0);
    }

    res.json({
      userCount,
      mediaCount,
      totalReactions,
      topReactions,
      totalComments
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get group statistics",
      details: error.message
    });
  }
});

app.get("/users/:groupId", (req, res) => {
  try {
    const { groupId } = req.params;
    const usersPath = path.join("groups", groupId, "users.json");

    if (!fs.existsSync(usersPath)) {
      return res.status(404).json({
        error: "Group users file not found"
      });
    }

    const usersData = fs.readFileSync(usersPath, "utf8");
    let users = JSON.parse(usersData);
    users = users.filter((user) => !user.isSecondary);

    res.json(users);
  } catch (error) {
    res.status(500).json({
      error: "Failed to get group users",
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
    const user = users.find((user) => user.id === userId);

    res.json({
      valid: userExists,
      isSecondary: user?.isSecondary,
      primaryId: user?.primaryId,
      userName: user?.name,
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

    const disallowedGroupNames = ["create-group", "create-user"];

    if (disallowedGroupNames.includes(groupName)) {
      return res.status(400).json({
        error: "Group name is not allowed"
      });
    }

    const groupId = groupName.toUpperCase().replace(/[\s-]+/g, "_");
    const groupPath = path.join("groups", groupId);

    if (fs.existsSync(groupPath)) {
      return res.status(400).json({
        error: "A group with this name already exists"
      });
    }

    const userId = generateUserId();

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

    const config = {
      createdAt: new Date().toISOString(),
      reactions: ["❤️", "‼️", "😂", "🔥", "🌊"]
    };
    fs.writeFileSync(
      path.join(groupPath, "config.json"),
      JSON.stringify(config, null, 2)
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

app.post("/join-group", async (req, res) => {
  try {
    const { groupId, userName } = req.body;

    if (!groupId || !userName) {
      return res.status(400).json({
        error: "Group ID and user name are required"
      });
    }

    const groupPath = path.join("groups", groupId);
    const usersPath = path.join(groupPath, "users.json");

    if (!fs.existsSync(groupPath)) {
      return res.status(404).json({
        error: "Group not found"
      });
    }

    let userId;
    const users = JSON.parse(fs.readFileSync(usersPath, "utf8"));

    do {
      userId = generateUserId();
    } while (users.some((user) => user.id === userId));

    users.push({
      id: userId,
      name: userName
    });

    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

    res.json({
      success: true,
      groupId,
      userId,
      message: "Successfully joined group"
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to join group",
      details: error.message
    });
  }
});

app.get("/generate-qr-code/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const groupPath = path.join("groups", groupId);
    const users = getGroupUsers(groupId);
    const userExists = users.some((user) => user.id === userId);

    if (!fs.existsSync(groupPath) || !userExists) {
      return res.status(404).json({
        error: "Invalid group or user"
      });
    }

    const url = `https://wave.leo.gd/${groupId}/${userId}`;

    const qrBuffer = await QRCode.toBuffer(url, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 1024,
      color: {
        dark: "#000000",
        light: "#F2F2F2"
      }
    });

    res.type("png");
    res.send(qrBuffer);
  } catch (error) {
    res.status(500).json({
      error: "Failed to generate QR code",
      details: error.message
    });
  }
});
