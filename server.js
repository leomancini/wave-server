import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

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
import getUser from "./functions/getUser.js";
import generateUserId from "./functions/generateUserId.js";
import processNotification from "./functions/processNotification.js";
import getMetadataForItem from "./functions/getMetadataForItem.js";
import getReactionsForItem from "./functions/getReactionsForItem.js";
import getCommentsForItem from "./functions/getCommentsForItem.js";
import getUnsentNotificationsForUser from "./functions/getUnsentNotificationsForUser.js";
import generateNotificationsSummary from "./functions/generateNotificationsSummary.js";
import clearNotificationsQueue from "./functions/clearNotificationsQueue.js";
import sendPushNotification from "./functions/sendPushNotification.js";
import sendSMS from "./functions/sendSMS.js";
import saveData from "./functions/saveData.js";

const workerPool = new Set();
const maxWorkers = Math.max(1, cpus().length - 1);

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
    const uploaderId = filename.split("-")[2];
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

const retry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retry(fn, retries - 1, delay * 2);
  }
};

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

const processUploadedFile = async (
  file,
  groupId,
  itemId,
  uploaderId,
  newFilename,
  newPath
) => {
  const dimensions = await getDimensions(file.path);

  while (workerPool.size >= maxWorkers) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await processImage(file.path, newPath, {
    width: 1920,
    height: 1080,
    fit: "inside",
    withoutEnlargement: true,
    quality: 85
  });

  fs.unlinkSync(file.path);

  try {
    await Promise.all([
      saveMetadata(groupId, file, itemId, uploaderId, dimensions),
      retry(async () => {
        await waitForFile(newPath);
        await generateThumbnail(groupId, newPath, itemId);
        const thumbnailPath = path.join(
          "groups",
          groupId,
          "thumbnails",
          `${itemId}.jpg`
        );
        await waitForFile(thumbnailPath);
      }),
      updateUnreadItems(groupId, itemId, uploaderId).catch((err) => {
        console.error("Error updating unread items:", err);
      })
    ]);
  } catch (error) {
    console.error(`Error processing file ${newFilename}:`, error);
    throw new Error(`Failed to process ${newFilename}: ${error.message}`);
  }

  processNotification("add", groupId, itemId, uploaderId, null, "upload", null);

  file.filename = newFilename;
  file.path = newPath;
};

app.post("/upload", upload.array("media", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No media files provided!" });
    }

    // Check if any file is trying to upload to DEMO group
    const demoUpload = req.files.find((file) => {
      const groupId = file.originalname.split("-")[0];
      return groupId === "DEMO";
    });

    if (demoUpload) {
      return res
        .status(403)
        .json({ error: "Uploads are not allowed in demo group!" });
    }

    const processPromises = req.files.map(async (file) => {
      const groupId = file.originalname.split("-")[0];
      const uploaderId = file.originalname.split("-")[2];
      const itemId = path
        .parse(file.originalname)
        .name.replace(`${groupId}-`, "");
      const newFilename = `${itemId}.jpg`;
      const newPath = path.join(path.dirname(file.path), newFilename);

      if (file.mimetype.startsWith("image/")) {
        await processUploadedFile(
          file,
          groupId,
          itemId,
          uploaderId,
          newFilename,
          newPath
        );
      }
    });

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

    const users = getGroupUsers(groupId);
    const userCount = users.length;

    const mediaPath = path.join(groupPath, "media");
    const mediaFiles = fs.readdirSync(mediaPath);
    const mediaCount = mediaFiles.length;

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

    const topReactions = Object.entries(reactionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([reaction, count]) => ({ reaction, count }));

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

    res.json(
      users.map((user) => ({
        id: user.id,
        name: user.name
      }))
    );
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
      processNotification(
        "remove",
        groupId,
        itemId,
        uploaderId,
        userId,
        "reaction",
        null
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
        processNotification(
          "add",
          groupId,
          itemId,
          uploaderId,
          userId,
          "reaction",
          { reaction }
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

    if (groupId === "DEMO") {
      return res
        .status(403)
        .json({ error: "Comments are not allowed in demo group!" });
    }

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

    processNotification("add", groupId, itemId, uploaderId, userId, "comment", {
      comment
    });

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

    // Delete file if phone number verification is incomplete
    if (!user.phoneNumber || !user.phoneNumber.verified) {
      const phoneNumberVerificationPath = path.join(
        "groups",
        groupId,
        "users",
        "phone-number-verifications",
        `${userId}.json`
      );

      if (fs.existsSync(phoneNumberVerificationPath)) {
        fs.unlinkSync(phoneNumberVerificationPath);
      }
    }

    // Check web push subscription status
    let subscriptionStatus = false;
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
        subscriptionStatus = true;
      }
    }

    res.json({
      valid: userExists,
      isDuplicate: user?.isDuplicate,
      primaryId: user?.primaryId,
      id: user?.id,
      name: user?.name,
      notificationPreference: user?.notificationPreference,
      phoneNumber: user?.phoneNumber,
      pushNotificationsEnabled: subscriptionStatus,
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
    fs.mkdirSync(path.join(groupPath, "notifications", "sms-unsent"));

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
        light: "#FFFFFF"
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

const SMS_RATE_LIMIT = {
  perSecond: 1, // Twilio's default is 1 message per second
  perMinute: 60 // Twilio's default is 60 messages per minute
};

let smsQueue = [];
let smsSentLastMinute = 0;
let lastSmsSentTime = 0;

const processSmsQueue = async () => {
  if (smsQueue.length === 0) return;

  const now = Date.now();

  if (now - lastSmsSentTime > 60000) {
    smsSentLastMinute = 0;
  }

  if (smsSentLastMinute >= SMS_RATE_LIMIT.perMinute) {
    setTimeout(processSmsQueue, 1000);
    return;
  }

  if (now - lastSmsSentTime < 1000) {
    setTimeout(processSmsQueue, 1000);
    return;
  }

  const { phoneNumber, text } = smsQueue.shift();

  try {
    await sendSMS(phoneNumber, text);
    lastSmsSentTime = Date.now();
    smsSentLastMinute++;

    if (smsQueue.length > 0) {
      setTimeout(processSmsQueue, 1000);
    }
  } catch (error) {
    console.error("Error sending SMS:", error);
    smsQueue.push({ phoneNumber, text });
    setTimeout(processSmsQueue, 1000);
  }
};

const queueSMS = (phoneNumber, text) => {
  smsQueue.push({ phoneNumber, text });
  if (smsQueue.length === 1) {
    processSmsQueue();
  }
};

app.get("/send-sms-notifications/:smsAuthToken", (req, res) => {
  const { smsAuthToken } = req.params;

  if (smsAuthToken !== process.env.SMS_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const groups = fs
    .readdirSync("groups")
    .filter((dir) => fs.statSync(path.join("groups", dir)).isDirectory());

  try {
    groups.forEach((groupId) => {
      const users = getGroupUsers(groupId);

      users.forEach((user) => {
        const notifications = getUnsentNotificationsForUser(groupId, user.id);

        if (
          notifications.length > 0 &&
          user.notificationPreference === "SMS" &&
          user.phoneNumber &&
          user.phoneNumber.verified
        ) {
          const notificationText = generateNotificationsSummary(
            groupId,
            user.id,
            notifications
          );

          queueSMS(user.phoneNumber.e164, notificationText);

          clearNotificationsQueue(groupId, user.id);
        }
      });
    });

    res.json({
      success: true
    });
  } catch (error) {
    console.error("Error queuing SMS notifications:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/web-push/save-subscription/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const subscription = req.body;

    if (!subscription) {
      return res.status(400).json({
        success: false,
        error: "Missing subscription data",
        isSupported: false
      });
    }

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

    let subscriptions = {};
    if (fs.existsSync(subscriptionsPath)) {
      subscriptions = JSON.parse(fs.readFileSync(subscriptionsPath, "utf8"));
    }

    subscriptions[userId] = {
      subscription,
      timestamp: Date.now()
    };

    fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2));

    sendPushNotification(groupId, userId, {
      title: `Notifications enabled for WAVE!`,
      body: "You'll be notified of activity in this group.",
      url: `${process.env.CLIENT_URL}/${groupId}/${userId}`
    });

    res.json({
      success: true,
      isSubscribed: true
    });
  } catch (error) {
    console.error("Error saving subscription:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/web-push/remove-subscription/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;
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
        delete subscriptions[userId];
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
  const { groupId, userId } = req.params;

  try {
    sendPushNotification(groupId, userId, {
      title: `New activity in WAVE!`,
      body: "This is a test notification.",
      url: `${process.env.CLIENT_URL}/${groupId}/${userId}`
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending test notification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/media/:groupId/:filename", async (req, res) => {
  try {
    const { groupId, filename } = req.params;
    const filePath = path.join("groups", groupId, "media", filename);

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

    res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year cache
    res.setHeader("Content-Type", "image/jpeg");

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
    const user = getUser(users, userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    users[user.index].notificationPreference = notificationType;

    saveData(groupId, "users/identities", users);

    res.json({
      success: true,
      user: user[user.index]
    });
  } catch (error) {
    console.error("Error updating notification preferences:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/users/:groupId/:userId/generate-verification-code", (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { phoneNumber } = req.body;

    const verificationCode = `${Math.floor(Date.now() * Math.random() * 100)
      .toString()
      .substring(0, 6)}`;

    const users = getGroupUsers(groupId);
    const user = getUser(users, userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const phoneNumberVerificationsDir = path.join(
      "groups",
      groupId,
      "users",
      "phone-number-verifications"
    );
    confirmDirectoryExists(phoneNumberVerificationsDir);

    const phoneNumberVerificationPath = path.join(
      phoneNumberVerificationsDir,
      `${userId}.json`
    );

    fs.writeFileSync(
      phoneNumberVerificationPath,
      JSON.stringify(
        {
          phoneNumber,
          verificationCode
        },
        null,
        2
      )
    );

    if (process.env.ENVIRONMENT === "production") {
      sendSMS(
        phoneNumber.e164,
        `Your WAVE verification code is ${verificationCode}`
      );
    }

    res.json({
      success: true
    });
  } catch (error) {
    console.error("Error updating phone number:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/users/:groupId/:userId/verify-verification-code", (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const { verificationCode } = req.body;

    const users = getGroupUsers(groupId);
    const user = getUser(users, userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const phoneNumberVerificationsDir = path.join(
      "groups",
      groupId,
      "users",
      "phone-number-verifications"
    );
    confirmDirectoryExists(phoneNumberVerificationsDir);

    const phoneNumberVerificationPath = path.join(
      phoneNumberVerificationsDir,
      `${userId}.json`
    );

    if (!fs.existsSync(phoneNumberVerificationPath)) {
      return res.status(404).json({
        error: "Phone number verification file not found"
      });
    }

    const phoneNumberVerificationFile = fs.readFileSync(
      phoneNumberVerificationPath,
      "utf8"
    );
    const phoneNumberVerificationData = JSON.parse(phoneNumberVerificationFile);

    const verificationCodeDoesMatch =
      verificationCode === phoneNumberVerificationData.verificationCode;

    if (verificationCodeDoesMatch) {
      fs.unlinkSync(phoneNumberVerificationPath);

      users[user.index].phoneNumber = {
        display: phoneNumberVerificationData.phoneNumber.display,
        e164: phoneNumberVerificationData.phoneNumber.e164,
        verified: true
      };

      saveData(groupId, "users/identities", users);
    }

    res.json({
      success: verificationCodeDoesMatch
    });
  } catch (error) {
    console.error("Error verifying phone number:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/users/:groupId/:userId/delete-phone-number", (req, res) => {
  try {
    const { groupId, userId } = req.params;

    const users = getGroupUsers(groupId);
    const user = getUser(users, userId);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    delete users[user.index].phoneNumber;

    saveData(groupId, "users/identities", users);

    res.json({
      success: true
    });
  } catch (error) {
    console.error("Error deleting phone number:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
