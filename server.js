import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const app = express();
const port = 3107;

const groups = ["ASIA2425", "STRAWBERRY", "LEOTEST"];

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

app.get("/compress-group/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const mediaPath = `groups/${groupId}/media`;

    if (!fs.existsSync(mediaPath)) {
      return res.status(404).json({ error: "Group media directory not found" });
    }

    const files = fs.readdirSync(mediaPath);
    let compressedCount = 0;

    for (const file of files) {
      const filePath = path.join(mediaPath, file);
      const fileExt = path.extname(file).toLowerCase();

      if ([".jpg", ".jpeg", ".png"].includes(fileExt)) {
        try {
          const compressedPath = path.join(mediaPath, `compressed_${file}`);

          await sharp(filePath)
            .rotate()
            .resize(1920, 1080, {
              fit: "inside",
              withoutEnlargement: true
            })
            .jpeg({ quality: 100 })
            .toFile(compressedPath);

          fs.unlinkSync(filePath);
          fs.renameSync(compressedPath, filePath);

          compressedCount++;
        } catch (err) {
          console.error(`Error compressing ${file}:`, err);
          continue;
        }
      }
    }

    res.json({
      message: `Successfully compressed ${compressedCount} images in group ${groupId}`
    });
  } catch (error) {
    console.error("Compression error:", error);
    res.status(500).json({
      error: "An error occurred while compressing group images"
    });
  }
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

      let dimensions;
      if (file.mimetype.startsWith("image/")) {
        const imageMetadata = await sharp(file.path).metadata();
        dimensions = {
          width: imageMetadata.width,
          height: imageMetadata.height
        };

        await sharp(file.path)
          .rotate()
          .resize(1920, 1080, {
            fit: "inside",
            withoutEnlargement: true
          })
          .jpeg({ quality: 100 })
          .toFile(newPath);

        fs.unlinkSync(file.path);
      }

      const groupId = file.originalname.split("-")[0];
      const metadataDir = path.join("groups", groupId, "metadata");
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }

      const metadata = {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploadDate: Date.now(),
        uploaderId: uploaderId,
        dimensions
      };

      fs.writeFileSync(
        path.join(metadataDir, `${path.parse(newFilename).name}.json`),
        JSON.stringify(metadata, null, 2)
      );

      const thumbnailsDir = path.join("groups", groupId, "thumbnails");
      if (!fs.existsSync(thumbnailsDir)) {
        fs.mkdirSync(thumbnailsDir, { recursive: true });
      }

      if (file.mimetype.startsWith("image/")) {
        const thumbnailPath = path.join(thumbnailsDir, newFilename);
        await sharp(newPath)
          .resize(128, 128, {
            fit: "inside",
            withoutEnlargement: true
          })
          .jpeg({ quality: 50 })
          .toFile(thumbnailPath);
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
                created: parseInt(filename.split("-")[0]),
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
            })
            .filter(Boolean)
        : [];

    mediaFiles.sort((a, b) => b.created - a.created);

    // Calculate pagination
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

    const reactionsFile = path.join(reactionsDir, `${filename}.json`);
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
