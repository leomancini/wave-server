import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import QRCode from "qrcode";
import dotenv from "dotenv";
import webpush from "web-push";
import { Worker } from "worker_threads";
import { cpus } from "os";

dotenv.config();

const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY
};

webpush.setVapidDetails(
  "mailto:" + process.env.VAPID_CONTACT_EMAIL,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const app = express();
const port = 3107;

// Move CORS middleware to the top, before any routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware with proper OPTIONS handling
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  // Handle OPTIONS requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

import confirmDirectoryExists from "./functions/confirmDirectoryExists.js";
import saveMetadata from "./functions/saveMetadata.js";
import generateThumbnail from "./functions/generateThumbnail.js";
import updateUnreadItems from "./functions/updateUnreadItems.js";
import getDimensions from "./functions/getDimensions.js";
import getGroupUsers from "./functions/getGroupUsers.js";
import generateUserId from "./functions/generateUserId.js";
import modifyNotificationsQueue from "./functions/modifyNotificationsQueue.js";
import getMetadataForItem from "./functions/getMetadataForItem.js";
import getReactionsForItem from "./functions/getReactionsForItem.js";
import getCommentsForItem from "./functions/getCommentsForItem.js";
import getUnsentNotificationsForUser from "./functions/getUnsentNotificationsForUser.js";
import generateNotificationText from "./functions/generateNotificationText.js";
import sendSMS from "./functions/sendSMS.js";

// Create a worker pool for image processing
const workerPool = new Set();
const maxWorkers = Math.max(1, cpus().length - 1); // Leave one CPU core free

const processImage = async (inputPath, outputPath, options) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const sharp = require('sharp');
      const { parentPort } = require('worker_threads');
      
      parentPort.on('message', async ({ inputPath, outputPath, options }) => {
        try {
          await sharp(inputPath)
            .rotate()
            .resize(options.width, options.height, {
              fit: options.fit,
              withoutEnlargement: options.withoutEnlargement
            })
            .jpeg({ quality: options.quality })
            .toFile(outputPath);
          
          parentPort.postMessage('done');
        } catch (error) {
          parentPort.postMessage({ error: error.message });
        }
      });
    `,
      { eval: true }
    );

    worker.on("message", (result) => {
      workerPool.delete(worker);
      worker.terminate();
      if (result.error) {
        reject(new Error(result.error));
      } else {
        resolve();
      }
    });

    worker.on("error", (error) => {
      workerPool.delete(worker);
      worker.terminate();
      reject(error);
    });

    workerPool.add(worker);
    worker.postMessage({ inputPath, outputPath, options });
  });
};

// Configure multer with optimized settings
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const filename = file.originalname;
    const groupId = filename.split("-")[0];
    const uploadDir = "groups/" + groupId + "/media";
    confirmDirectoryExists(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Max 10 files per upload
  },
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

const cleanItemId = (itemId) => {
  // This is just to make sure old itemIds are cleaned up
  if (itemId.includes(".")) {
    itemId = path.parse(itemId).name;
  }
  return itemId;
};

// import compressGroupMedia from "./utilities/compress-group-media.js";
// app.get("/compress-group-media/:groupId", async (req, res) => {
//   const result = await compressGroupMedia(req.params.groupId);
//   res.json(result);
// });

// import addMetadataAndThumbnails from "./utilities/add-metadata-and-thumbnails.js";
// app.get("/add-metadata-and-thumbnails/:groupId", async (req, res) => {
//   const result = await addMetadataAndThumbnails(req.params.groupId);
//   res.json(result);
// });

// import addConfigToExistingGroup from "./utilities/add-config-to-existing-group.js";
// app.get("/add-config-to-existing-group/:groupId", (req, res) => {
//   const result = addConfigToExistingGroup(req.params.groupId);
//   res.json(result);
// });

// import updateToItemId from "./utilities/update-to-item-id.js";
// app.get("/update-to-item-id", (req, res) => {
//   const result = updateToItemId();
//   res.json(result);
// });

// Add this retry utility at the top with other imports
const retry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retry(fn, retries - 1, delay * 2);
  }
};

// Add this helper function if not already present
const waitForFile = async (filePath, maxAttempts = 5, delay = 1000) => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 0) {
        return true;
      }
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(
    `File not available after ${maxAttempts} attempts: ${filePath}`
  );
};

// Update the upload endpoint's file processing
app.post("/upload", upload.array("media", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No media files provided!" });
    }

    // Process files in parallel with worker pool
    const processPromises = req.files.map(async (file) => {
      const uploaderId = req.body.uploaderId;
      const newFilename = `${req.body.itemId.replace("-new-upload", "")}.jpg`;

      console.log(newFilename);
      const itemId = path.parse(newFilename).name;
      const newPath = path.join(path.dirname(file.path), newFilename);

      if (file.mimetype.startsWith("image/")) {
        // Get dimensions before processing
        const dimensions = await getDimensions(file.path);

        // Wait for available worker in pool
        while (workerPool.size >= maxWorkers) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Process image with worker
        await processImage(file.path, newPath, {
          width: 1920,
          height: 1080,
          fit: "inside",
          withoutEnlargement: true,
          quality: 85
        });

        // Clean up original file
        fs.unlinkSync(file.path);

        const groupId = file.originalname.split("-")[0];

        // Process metadata and thumbnail with retries
        try {
          await Promise.all([
            saveMetadata(groupId, file, itemId, uploaderId, dimensions),
            // Add retry logic for thumbnail generation
            retry(async () => {
              // Verify the source file exists and is readable
              await fs.promises.access(newPath, fs.constants.R_OK);
              // Generate thumbnail with increased timeout
              await generateThumbnail(groupId, newPath, itemId);
              // Verify thumbnail was created
              const thumbnailPath = path.join(
                "groups",
                groupId,
                "thumbnails",
                `${itemId}.jpg`
              );
              await fs.promises.access(thumbnailPath, fs.constants.R_OK);
            }),
            updateUnreadItems(groupId, itemId, uploaderId).catch((err) => {
              console.error("Error updating unread items:", err);
            })
          ]);
        } catch (error) {
          console.error(`Error processing file ${newFilename}:`, error);
          throw new Error(`Failed to process ${newFilename}: ${error.message}`);
        }

        // Queue notification after successful processing
        modifyNotificationsQueue(
          "add",
          groupId,
          itemId,
          uploaderId,
          null,
          "upload"
        );

        file.filename = newFilename;
        file.path = newPath;
      }
    });

    // Wait for all files to be processed
    await Promise.all(processPromises);

    res.json({
      message: `Successfully uploaded ${req.files.length} media file${
        req.files.length > 1 ? "s" : ""
      }!`,
      success: true
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
    const users = getGroupUsers(groupId);
    const userCount = users.length;

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

app.get("/unread/:groupId/:userId", (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const unreadPath = path.join(
      "groups",
      groupId,
      "users",
      "unread",
      `${userId}.json`
    );

    let unreadCount = 0;
    if (fs.existsSync(unreadPath)) {
      const unreadItems = JSON.parse(fs.readFileSync(unreadPath, "utf8"));
      unreadCount = unreadItems.length;
    }

    res.json({ unreadCount });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get unread count",
      details: error.message
    });
  }
});

app.get("/users/:groupId", (req, res) => {
  try {
    const { groupId } = req.params;
    const usersPath = path.join("groups", groupId, "users/identities.json");

    if (!fs.existsSync(usersPath)) {
      return res.status(404).json({
        error: "Group users file not found"
      });
    }

    const users = getGroupUsers(groupId);

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
    const userId = req.query.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const mediaDir = `groups/${groupId}/media`;

    let unreadItems = [];
    if (userId) {
      const unreadPath = path.join(
        "groups",
        groupId,
        "users",
        "unread",
        `${userId}.json`
      );
      if (fs.existsSync(unreadPath)) {
        unreadItems = JSON.parse(fs.readFileSync(unreadPath, "utf8"));
      }
    }

    if (!fs.existsSync(mediaDir)) {
      return res.status(404).json({ error: "Group media directory not found" });
    }

    const addUsernames = (data) => {
      const users = getGroupUsers(groupId, { includeDuplicates: true });

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
              const filenameParts = filename.split("-");
              if (filenameParts.length < 2) {
                return null;
              }

              const uploaderId = filenameParts[1].split(".")[0];
              const users = getGroupUsers(groupId, { includeDuplicates: true });
              const uploader = users.find((user) => user.id === uploaderId);

              const itemId = path.parse(filename).name;
              const metadata = getMetadataForItem(groupId, itemId);
              const reactions = getReactionsForItem(groupId, itemId);
              const comments = getCommentsForItem(groupId, itemId);

              return {
                filename: filename,
                uploader: {
                  id: uploader?.id || "unknown",
                  name: uploader?.name || "Unknown"
                },
                path: `/groups/${groupId}/media/${filename}`,
                metadata,
                reactions: addUsernames(reactions),
                comments: addUsernames(comments),
                isUnread: userId ? unreadItems.includes(itemId) : undefined
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

app.get("/media/:groupId/:itemId", (req, res) => {
  try {
    const { groupId } = req.params;
    const itemId = cleanItemId(req.params.itemId);
    const filePath = path.join("groups", groupId, "media", `${itemId}.jpg`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    res.sendFile(path.resolve(filePath));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/media/:groupId/:itemId/thumbnail", (req, res) => {
  try {
    const { groupId } = req.params;
    const itemId = cleanItemId(req.params.itemId);
    const filePath = path.join(
      "groups",
      groupId,
      "thumbnails",
      `${itemId}.jpg`
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    res.sendFile(path.resolve(filePath));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/media/:groupId/:itemId/reactions", (req, res) => {
  try {
    const { groupId } = req.params;
    const itemId = cleanItemId(req.params.itemId);
    const { userId, reaction } = req.body;
    const uploaderId = itemId.split("-")[1];

    if (!userId || !reaction) {
      return res
        .status(400)
        .json({ error: "userId and reaction are required" });
    }

    const mediaPath = path.join("groups", groupId, "media", `${itemId}.jpg`);
    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    const reactionsDir = path.join("groups", groupId, "reactions");
    confirmDirectoryExists(reactionsDir);

    const reactionsFile = path.join(reactionsDir, `${itemId}.json`);
    let reactions = getReactionsForItem(groupId, itemId);

    const existingReaction = reactions.find(
      (r) => r.userId === userId && r.reaction === reaction
    );
    if (existingReaction) {
      reactions = reactions.filter((r) => r.userId !== userId);
      modifyNotificationsQueue(
        "remove",
        groupId,
        itemId,
        uploaderId,
        userId,
        "reaction"
      );
    } else {
      const hadDifferentReaction = reactions.some((r) => r.userId === userId);
      reactions = reactions.filter((r) => r.userId !== userId);
      reactions.push({
        userId,
        reaction,
        timestamp: new Date().toISOString()
      });

      if (!hadDifferentReaction) {
        modifyNotificationsQueue(
          "add",
          groupId,
          itemId,
          uploaderId,
          userId,
          "reaction"
        );
      }
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

app.post("/media/:groupId/:itemId/comment", async (req, res) => {
  try {
    const { groupId } = req.params;
    const itemId = cleanItemId(req.params.itemId);
    const { userId, comment } = req.body;
    const uploaderId = itemId.split("-")[1];
    if (!userId || !comment) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const mediaPath = path.join("groups", groupId, "media", `${itemId}.jpg`);
    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: "Media file not found" });
    }

    const commentsDir = path.join("groups", groupId, "comments");
    confirmDirectoryExists(commentsDir);

    const commentsFile = path.join(commentsDir, `${itemId}.json`);
    let comments = getCommentsForItem(groupId, itemId);

    comments.push({
      userId,
      comment,
      timestamp: new Date().toISOString()
    });

    fs.writeFileSync(commentsFile, JSON.stringify(comments, null, 2));

    modifyNotificationsQueue(
      "add",
      groupId,
      itemId,
      uploaderId,
      userId,
      "comment"
    );

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

    const users = getGroupUsers(groupId, { includeDuplicates: true });
    const userExists = users.some((user) => user.id === userId);
    const user = users.find((user) => user.id === userId);

    res.json({
      valid: userExists,
      isDuplicate: user?.isDuplicate,
      primaryId: user?.primaryId,
      id: user?.id,
      name: user?.name,
      notificationPreference: user?.notificationPreference,
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
    fs.mkdirSync(path.join(groupPath, "users"));
    fs.mkdirSync(path.join(groupPath, "users", "unread"));
    fs.mkdirSync(path.join(groupPath, "media"));
    fs.mkdirSync(path.join(groupPath, "metadata"));
    fs.mkdirSync(path.join(groupPath, "thumbnails"));
    fs.mkdirSync(path.join(groupPath, "reactions"));
    fs.mkdirSync(path.join(groupPath, "comments"));
    fs.mkdirSync(path.join(groupPath, "notifications"));
    fs.mkdirSync(path.join(groupPath, "notifications", "unsent"));
    fs.mkdirSync(path.join(groupPath, "notifications", "sent"));

    const users = [
      {
        id: userId,
        name: userName
      }
    ];
    fs.writeFileSync(
      path.join(groupPath, "users/identities.json"),
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
    const usersPath = path.join(groupPath, "users/identities.json");

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

    const url = `${process.env.CLIENT_URL}/${groupId}/${userId}`;

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

app.post("/update-reaction-emojis/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const { emojis } = req.body;

    if (!Array.isArray(emojis)) {
      return res.status(400).json({
        error: "Emojis must be an array"
      });
    }

    if (emojis.length === 0) {
      return res.status(400).json({
        error: "Emojis array cannot be empty"
      });
    }

    const groupsDir = path.join("groups", groupId);
    confirmDirectoryExists(groupsDir);

    const configPath = path.join(groupsDir, "config.json");
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
    config.reactions = emojis;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    res.json({
      success: true,
      message: "Successfully updated reaction emojis",
      emojis
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to update reaction emojis",
      details: error.message
    });
  }
});

app.post("/mark-items-read/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({
        error: "Items must be an array"
      });
    }

    const groupPath = path.join("groups", groupId);
    const users = getGroupUsers(groupId);
    const userExists = users.some((user) => user.id === userId);

    if (!fs.existsSync(groupPath) || !userExists) {
      return res.status(404).json({
        error: "Invalid group or user"
      });
    }

    const unreadPath = path.join(
      groupPath,
      "users",
      "unread",
      `${userId}.json`
    );

    if (!fs.existsSync(unreadPath)) {
      return res.status(200).json({
        message: "No unread items found"
      });
    }

    const unreadItems = JSON.parse(fs.readFileSync(unreadPath, "utf8"));
    const updatedItems = unreadItems.filter((item) => !items.includes(item));

    fs.writeFileSync(unreadPath, JSON.stringify(updatedItems, null, 2));

    res.json({
      success: true,
      message: "Successfully marked items as read"
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to mark items as read",
      details: error.message
    });
  }
});

app.get(
  "/send-sms-notifications/:groupId/:userId/:smsAuthToken",
  (req, res) => {
    const { groupId, userId, smsAuthToken } = req.params;

    if (smsAuthToken === process.env.SMS_AUTH_TOKEN) {
      const notifications = getUnsentNotificationsForUser(groupId, userId);

      // TODO: Check if user has SMS notifications enabled

      // const { phoneNumber, message, smsAuthToken } = req.params;
      // if (smsAuthToken === process.env.SMS_AUTH_TOKEN) {
      //   sendSMS(phoneNumber, message);
      //   res.json({ success: true });
      // } else {
      //   res.status(401).json({ error: "Unauthorized" });
      // }
      // const notificationsToSend = generateNotifications(notifications);
      // res.json(notificationsToSend);

      const notificationText = generateNotificationText(
        groupId,
        userId,
        notifications
      );
      res.json(notificationText);
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  }
);

app.post("/web-push/save-subscription/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const subscription = req.body;

    // Basic validation
    if (!subscription) {
      return res.status(400).json({
        success: false,
        error: "Missing subscription data",
        isSupported: false
      });
    }

    // Validate endpoint
    if (!subscription.endpoint || subscription.endpoint.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Invalid subscription: empty endpoint",
        isSupported: false
      });
    }

    const subscriptionsDir = path.join(
      "groups",
      groupId,
      "notifications",
      "subscriptions"
    );
    const subscriptionsPath = path.join(subscriptionsDir, "web-push.json");

    confirmDirectoryExists(subscriptionsDir);

    // Create/load existing subscriptions
    let subscriptions = {};
    if (fs.existsSync(subscriptionsPath)) {
      subscriptions = JSON.parse(fs.readFileSync(subscriptionsPath, "utf8"));
    }

    // Initialize user's subscriptions if needed
    if (!subscriptions[userId]) {
      subscriptions[userId] = {
        subscriptions: []
      };
    }

    // Check if this subscription endpoint already exists
    const existingIndex = subscriptions[userId].subscriptions.findIndex(
      (sub) => sub.subscription.endpoint === subscription.endpoint
    );

    if (existingIndex !== -1) {
      // Update existing subscription
      subscriptions[userId].subscriptions[existingIndex] = {
        subscription,
        timestamp: Date.now(),
        renewalCount:
          (subscriptions[userId].subscriptions[existingIndex].renewalCount ||
            0) + 1,
        lastRenewal: new Date().toISOString()
      };
    } else {
      // Add new subscription
      subscriptions[userId].subscriptions.push({
        subscription,
        timestamp: Date.now(),
        renewalCount: 0,
        lastRenewal: new Date().toISOString()
      });
    }

    fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2));

    res.json({
      success: true,
      isSubscribed: true,
      deviceCount: subscriptions[userId].subscriptions.length
    });
  } catch (error) {
    console.error("Error saving subscription:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/web-push/remove-subscription/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const subscription = req.body;
    const subscriptionsPath = path.join(
      "groups",
      groupId,
      "notifications",
      "subscriptions",
      "web-push.json"
    );

    if (fs.existsSync(subscriptionsPath)) {
      const subscriptions = JSON.parse(
        fs.readFileSync(subscriptionsPath, "utf8")
      );

      if (subscriptions[userId]) {
        if (subscription && subscription.endpoint) {
          // Remove specific subscription
          subscriptions[userId].subscriptions = subscriptions[
            userId
          ].subscriptions.filter(
            (sub) => sub.subscription.endpoint !== subscription.endpoint
          );

          // Remove user entry if no subscriptions left
          if (subscriptions[userId].subscriptions.length === 0) {
            delete subscriptions[userId];
          }
        } else {
          // Remove all subscriptions for user if no specific subscription provided
          delete subscriptions[userId];
        }

        fs.writeFileSync(
          subscriptionsPath,
          JSON.stringify(subscriptions, null, 2)
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing subscription:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/web-push/send-test/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const subscriptionsPath = path.join(
      "groups",
      groupId,
      "notifications",
      "subscriptions",
      "web-push.json"
    );

    if (!fs.existsSync(subscriptionsPath)) {
      return res.status(404).json({
        success: false,
        error: "No subscriptions found"
      });
    }

    const subscriptions = JSON.parse(
      fs.readFileSync(subscriptionsPath, "utf8")
    );
    const userSubscriptions = subscriptions[userId];

    if (!userSubscriptions || !userSubscriptions.subscriptions.length) {
      return res.status(404).json({
        success: false,
        error: "User subscriptions not found"
      });
    }

    const payload = JSON.stringify({
      title: "Test Notification",
      body: "This is a test notification!",
      timestamp: Date.now()
    });

    const results = await Promise.allSettled(
      userSubscriptions.subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          return { success: true, endpoint: sub.subscription.endpoint };
        } catch (error) {
          if (
            error.statusCode === 410 ||
            error.body?.includes("unsubscribed or expired")
          ) {
            return {
              success: false,
              endpoint: sub.subscription.endpoint,
              expired: true
            };
          }
          throw error;
        }
      })
    );

    // Remove expired subscriptions
    const expiredEndpoints = results
      .filter((r) => r.value?.expired)
      .map((r) => r.value.endpoint);

    if (expiredEndpoints.length > 0) {
      userSubscriptions.subscriptions = userSubscriptions.subscriptions.filter(
        (sub) => !expiredEndpoints.includes(sub.subscription.endpoint)
      );

      if (userSubscriptions.subscriptions.length === 0) {
        delete subscriptions[userId];
      }

      fs.writeFileSync(
        subscriptionsPath,
        JSON.stringify(subscriptions, null, 2)
      );
    }

    const successCount = results.filter((r) => r.value?.success).length;
    const expiredCount = expiredEndpoints.length;

    res.json({
      success: true,
      message: `Test notification sent to ${successCount} device(s)`,
      successCount,
      expiredCount,
      remainingDevices: userSubscriptions.subscriptions.length
    });
  } catch (error) {
    console.error("Error sending test notification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to validate subscription
const validateSubscription = async (subscription) => {
  try {
    const payload = JSON.stringify({
      title: "Subscription Validation",
      body: "Validating subscription status",
      timestamp: Date.now()
    });
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (error) {
    if (
      error.statusCode === 410 ||
      error.body?.includes("unsubscribed or expired")
    ) {
      return false;
    }
    throw error;
  }
};

app.post("/web-push/validate-subscriptions/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const subscriptionsPath = path.join(
      "groups",
      groupId,
      "notifications",
      "subscriptions",
      "web-push.json"
    );

    if (!fs.existsSync(subscriptionsPath)) {
      return res.json({ success: true, cleaned: 0 });
    }

    const subscriptions = JSON.parse(
      fs.readFileSync(subscriptionsPath, "utf8")
    );
    const userIds = Object.keys(subscriptions);
    let cleaned = 0;
    let totalValid = 0;

    for (const userId of userIds) {
      const validSubscriptions = [];
      for (const sub of subscriptions[userId].subscriptions) {
        try {
          const isValid = await validateSubscription(sub.subscription);
          if (isValid) {
            validSubscriptions.push(sub);
            totalValid++;
          } else {
            cleaned++;
          }
        } catch (error) {
          console.error("Error validating subscription:", error);
          cleaned++;
        }
      }

      if (validSubscriptions.length === 0) {
        delete subscriptions[userId];
      } else {
        subscriptions[userId].subscriptions = validSubscriptions;
      }
    }

    if (cleaned > 0) {
      fs.writeFileSync(
        subscriptionsPath,
        JSON.stringify(subscriptions, null, 2)
      );
    }

    res.json({
      success: true,
      cleaned,
      remainingSubscriptions: totalValid,
      activeUsers: Object.keys(subscriptions).length
    });
  } catch (error) {
    console.error("Error validating subscriptions:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app
  .route("/web-push/check-subscription/:groupId/:userId")
  .get(async (req, res) => {
    try {
      const { groupId, userId } = req.params;
      const subscriptionsPath = path.join(
        "groups",
        groupId,
        "notifications",
        "subscriptions",
        "web-push.json"
      );

      if (!fs.existsSync(subscriptionsPath)) {
        return res.json({
          success: true,
          isSubscribed: false,
          deviceCount: 0
        });
      }

      const subscriptions = JSON.parse(
        fs.readFileSync(subscriptionsPath, "utf8")
      );
      const userSubscriptions = subscriptions[userId];

      if (!userSubscriptions || !userSubscriptions.subscriptions.length) {
        return res.json({
          success: true,
          isSubscribed: false,
          deviceCount: 0
        });
      }

      // Validate all subscriptions
      const validSubscriptions = [];
      for (const sub of userSubscriptions.subscriptions) {
        try {
          const isValid = await validateSubscription(sub.subscription);
          if (isValid) {
            validSubscriptions.push(sub);
          }
        } catch (error) {
          console.error("Error validating subscription:", error);
        }
      }

      // Update storage if any subscriptions were invalid
      if (
        validSubscriptions.length !== userSubscriptions.subscriptions.length
      ) {
        if (validSubscriptions.length === 0) {
          delete subscriptions[userId];
        } else {
          subscriptions[userId].subscriptions = validSubscriptions;
        }
        fs.writeFileSync(
          subscriptionsPath,
          JSON.stringify(subscriptions, null, 2)
        );
      }

      res.json({
        success: true,
        isSubscribed: validSubscriptions.length > 0,
        deviceCount: validSubscriptions.length,
        subscriptions: validSubscriptions.map((sub) => ({
          endpoint: sub.subscription.endpoint,
          timestamp: sub.timestamp,
          renewalCount: sub.renewalCount,
          lastRenewal: sub.lastRenewal
        }))
      });
    } catch (error) {
      console.error("Error checking subscription:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  })
  .post(async (req, res) => {
    try {
      const { groupId, userId } = req.params;
      const subscriptionsPath = path.join(
        "groups",
        groupId,
        "notifications",
        "subscriptions",
        "web-push.json"
      );

      if (!fs.existsSync(subscriptionsPath)) {
        return res.json({
          success: true,
          isSubscribed: false,
          deviceCount: 0
        });
      }

      const subscriptions = JSON.parse(
        fs.readFileSync(subscriptionsPath, "utf8")
      );
      const userSubscriptions = subscriptions[userId];

      if (!userSubscriptions || !userSubscriptions.subscriptions.length) {
        return res.json({
          success: true,
          isSubscribed: false,
          deviceCount: 0
        });
      }

      // If subscription provided in body, check only that one
      if (req.body && req.body.endpoint) {
        const matchingSubscription = userSubscriptions.subscriptions.find(
          (sub) => sub.subscription.endpoint === req.body.endpoint
        );

        if (!matchingSubscription) {
          return res.json({
            success: true,
            isSubscribed: false,
            deviceCount: userSubscriptions.subscriptions.length
          });
        }

        try {
          const isValid = await validateSubscription(
            matchingSubscription.subscription
          );
          if (!isValid) {
            // Remove invalid subscription
            userSubscriptions.subscriptions =
              userSubscriptions.subscriptions.filter(
                (sub) => sub.subscription.endpoint !== req.body.endpoint
              );

            if (userSubscriptions.subscriptions.length === 0) {
              delete subscriptions[userId];
            }

            fs.writeFileSync(
              subscriptionsPath,
              JSON.stringify(subscriptions, null, 2)
            );

            return res.json({
              success: true,
              isSubscribed: false,
              deviceCount: userSubscriptions.subscriptions.length
            });
          }

          return res.json({
            success: true,
            isSubscribed: true,
            deviceCount: userSubscriptions.subscriptions.length,
            subscription: {
              endpoint: matchingSubscription.subscription.endpoint,
              timestamp: matchingSubscription.timestamp,
              renewalCount: matchingSubscription.renewalCount,
              lastRenewal: matchingSubscription.lastRenewal
            }
          });
        } catch (error) {
          console.error("Error validating subscription:", error);
          return res.status(500).json({ success: false, error: error.message });
        }
      }

      // If no specific subscription provided, validate all
      const validSubscriptions = [];
      for (const sub of userSubscriptions.subscriptions) {
        try {
          const isValid = await validateSubscription(sub.subscription);
          if (isValid) {
            validSubscriptions.push(sub);
          }
        } catch (error) {
          console.error("Error validating subscription:", error);
        }
      }

      // Update storage if any subscriptions were invalid
      if (
        validSubscriptions.length !== userSubscriptions.subscriptions.length
      ) {
        if (validSubscriptions.length === 0) {
          delete subscriptions[userId];
        } else {
          subscriptions[userId].subscriptions = validSubscriptions;
        }
        fs.writeFileSync(
          subscriptionsPath,
          JSON.stringify(subscriptions, null, 2)
        );
      }

      res.json({
        success: true,
        isSubscribed: validSubscriptions.length > 0,
        deviceCount: validSubscriptions.length,
        subscriptions: validSubscriptions.map((sub) => ({
          endpoint: sub.subscription.endpoint,
          timestamp: sub.timestamp,
          renewalCount: sub.renewalCount,
          lastRenewal: sub.lastRenewal
        }))
      });
    } catch (error) {
      console.error("Error checking subscription:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

// Update the media endpoint
app.get("/media/:groupId/:filename", async (req, res) => {
  try {
    const { groupId, filename } = req.params;
    const filePath = path.join("groups", groupId, "media", filename);

    // Wait for file to be fully written and accessible
    try {
      await retry(
        async () => {
          await waitForFile(filePath);
        },
        3,
        1000
      );
    } catch (error) {
      console.error(`File access error for ${filePath}:`, error);
      return res.status(404).send("File not found or not ready");
    }

    // Set appropriate headers
    res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year cache
    res.setHeader("Content-Type", "image/jpeg");

    // Stream the file with error handling
    const stream = fs.createReadStream(filePath);

    stream.on("error", (error) => {
      console.error(`Streaming error for ${filePath}:`, error);
      if (!res.headersSent) {
        res.status(500).send("Error streaming file");
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error("Media endpoint error:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

app.post("/users/:groupId/:userId/notification-preference", (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { notificationType } = req.body;

    if (!notificationType) {
      return res.status(400).json({
        error: "notificationType is required"
      });
    }

    const users = getGroupUsers(groupId);
    const userIndex = users.findIndex((user) => user.id === userId);
    if (userIndex === -1) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const identitiesPath = path.join(
      "groups",
      groupId,
      "users",
      "identities.json"
    );
    const identities = JSON.parse(fs.readFileSync(identitiesPath, "utf8"));

    identities[userIndex].notificationPreference = notificationType;

    fs.writeFileSync(identitiesPath, JSON.stringify(identities, null, 2));

    res.json({
      success: true,
      user: identities[userIndex]
    });
  } catch (error) {
    console.error("Error updating notification preferences:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
