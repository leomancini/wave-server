import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import QRCode from "qrcode";
import dotenv from "dotenv";
import webpush from "web-push";

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
      const itemId = path.parse(newFilename).name;
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
        await saveMetadata(groupId, file, itemId, uploaderId, dimensions);

        await generateThumbnail(groupId, newPath, itemId);

        updateUnreadItems(groupId, itemId, uploaderId).catch((err) => {
          console.error("Error updating unread items:", err);
        });

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

    // Store subscription with user info
    subscriptions[userId] = {
      subscription,
      timestamp: Date.now()
    };

    fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2));

    res.json({ success: true, isSubscribed: true });
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
      delete subscriptions[userId];
      fs.writeFileSync(
        subscriptionsPath,
        JSON.stringify(subscriptions, null, 2)
      );
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
    const userSubscription = subscriptions[userId];

    if (!userSubscription) {
      return res.status(404).json({
        success: false,
        error: "User subscription not found"
      });
    }

    const payload = JSON.stringify({
      title: "Test Notification",
      body: "This is a test notification!",
      timestamp: Date.now()
    });

    try {
      await webpush.sendNotification(userSubscription.subscription, payload);
    } catch (error) {
      if (
        error.statusCode === 410 ||
        error.body.includes("unsubscribed or expired")
      ) {
        // Remove expired subscription
        delete subscriptions[userId];
        fs.writeFileSync(
          subscriptionsPath,
          JSON.stringify(subscriptions, null, 2)
        );

        return res.status(400).json({
          success: false,
          error: "Subscription has expired",
          isExpired: true
        });
      }
      throw error; // Re-throw other errors
    }

    res.json({ success: true, message: "Test notification sent" });
  } catch (error) {
    console.error("Error sending test notification:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a helper function to validate and clean subscriptions
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
      error.body.includes("unsubscribed or expired")
    ) {
      return false;
    }
    throw error;
  }
};

// Add a new endpoint to validate subscriptions
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

    for (const userId of userIds) {
      const isValid = await validateSubscription(
        subscriptions[userId].subscription
      );
      if (!isValid) {
        delete subscriptions[userId];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      fs.writeFileSync(
        subscriptionsPath,
        JSON.stringify(subscriptions, null, 2)
      );
    }

    res.json({ success: true, cleaned });
  } catch (error) {
    console.error("Error validating subscriptions:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/web-push/renew-subscription/:groupId/:userId", async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const subscription = req.body;

    // Validate input
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        success: false,
        error: "Invalid subscription object"
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

    // Load existing subscriptions
    let subscriptions = {};
    if (fs.existsSync(subscriptionsPath)) {
      try {
        const fileContent = fs.readFileSync(subscriptionsPath, "utf8");
        if (fileContent.trim()) {
          subscriptions = JSON.parse(fileContent);
        }
      } catch (parseError) {
        console.error("Error parsing subscriptions file:", parseError);
        // If file is corrupted, start fresh
        subscriptions = {};
      }
    }

    // Validate the new subscription
    try {
      const testPayload = JSON.stringify({
        title: "Subscription Renewal",
        body: "Validating renewed subscription",
        timestamp: Date.now()
      });
      await webpush.sendNotification(subscription, testPayload);
    } catch (error) {
      if (
        error.statusCode === 410 ||
        error.body.includes("unsubscribed or expired")
      ) {
        return res.status(400).json({
          success: false,
          error: "New subscription is invalid",
          isExpired: true
        });
      }
      throw error;
    }

    // Update subscription with new data and timestamp
    subscriptions[userId] = {
      subscription,
      timestamp: Date.now(),
      renewalCount: (subscriptions[userId]?.renewalCount || 0) + 1,
      lastRenewal: new Date().toISOString()
    };

    // Save updated subscriptions
    fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2));

    // Send success response with subscription info
    res.json({
      success: true,
      message: "Subscription renewed successfully",
      renewalCount: subscriptions[userId].renewalCount,
      lastRenewal: subscriptions[userId].lastRenewal
    });
  } catch (error) {
    console.error("Error renewing subscription:", error);
    console.error("Request body:", req.body);
    res.status(500).json({
      success: false,
      error: error.message,
      details: "Failed to renew push notification subscription"
    });
  }
});
