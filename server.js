import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import multer from "multer";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// Secret key for JWT (should be in .env in production)
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// SQLite database setup
const dbPath = path.join(__dirname, "data", "chat.db");
let db;

(async () => {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  // Create tables if they don’t exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT NOT NULL DEFAULT 'individual',
      createdBy TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_participants (
      chatId TEXT,
      userId TEXT,
      FOREIGN KEY (chatId) REFERENCES chats(id),
      FOREIGN KEY (userId) REFERENCES users(id),
      PRIMARY KEY (chatId, userId)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chatId TEXT NOT NULL,
      senderId TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      status TEXT NOT NULL DEFAULT 'sent',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (chatId) REFERENCES chats(id),
      FOREIGN KEY (senderId) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      originalName TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mimetype TEXT NOT NULL,
      uploadedBy TEXT NOT NULL,
      uploadedAt TEXT NOT NULL,
      FOREIGN KEY (uploadedBy) REFERENCES users(id)
    );
  `);
  console.log("Database initialized");
})();

// Configure multer for file uploads
const uploadDir = path.join(__dirname, "uploads");
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error("Only images and PDFs are allowed"));
  },
});

// Helper function to verify JWT
const verifyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.sendStatus(401);

  const token = authHeader.split(" ")[1];
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- Routes ---

// Authentication Routes
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const existingUser = await db.get(
      "SELECT * FROM users WHERE username = ?",
      username
    );
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const newUser = {
      id: uuidv4(),
      username,
      password, // In production, hash this!
      createdAt: new Date().toISOString(),
    };

    await db.run(
      "INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)",
      [newUser.id, newUser.username, newUser.password, newUser.createdAt]
    );

    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const user = await db.get(
      "SELECT * FROM users WHERE username = ? AND password = ?",
      [username, password]
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      {
        expiresIn: "24h",
      }
    );
    res.json({ token });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Chats Routes
app.get("/api/chats", verifyAuth, async (req, res) => {
  try {
    const chats = await db.all(
      `
      SELECT c.*
      FROM chats c
      JOIN chat_participants cp ON c.id = cp.chatId
      WHERE cp.userId = ?
    `,
      [req.user.userId]
    );
    res.json(chats);
  } catch (error) {
    console.error("Get chats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/chats", verifyAuth, async (req, res) => {
  try {
    const { name, participants, type = "individual" } = req.body;
    if (!participants || !Array.isArray(participants)) {
      return res.status(400).json({ error: "Participants array is required" });
    }

    // Check for existing individual chat
    if (type === "individual" && participants.length === 2) {
      const existingChat = await db.get(
        `
        SELECT c.*
        FROM chats c
        JOIN chat_participants cp1 ON c.id = cp1.chatId
        JOIN chat_participants cp2 ON c.id = cp2.chatId
        WHERE c.type = 'individual'
          AND cp1.userId = ? AND cp2.userId = ?
      `,
        [participants[0], participants[1]]
      );
      if (existingChat) return res.json(existingChat);
    }

    const newChat = {
      id: uuidv4(),
      name: name || null,
      type,
      createdBy: req.user.userId,
      createdAt: new Date().toISOString(),
    };

    await db.run(
      "INSERT INTO chats (id, name, type, createdBy, createdAt) VALUES (?, ?, ?, ?, ?)",
      [
        newChat.id,
        newChat.name,
        newChat.type,
        newChat.createdBy,
        newChat.createdAt,
      ]
    );

    // Add participants
    for (const userId of participants) {
      await db.run(
        "INSERT INTO chat_participants (chatId, userId) VALUES (?, ?)",
        [newChat.id, userId]
      );
    }

    res.status(201).json(newChat);
  } catch (error) {
    console.error("Create chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Messages Routes
app.get("/api/messages", verifyAuth, async (req, res) => {
  try {
    const { chatId } = req.query;
    if (!chatId) {
      return res.status(400).json({ error: "Chat ID is required" });
    }

    const messages = await db.all("SELECT * FROM messages WHERE chatId = ?", [
      chatId,
    ]);
    res.json(messages);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/messages", verifyAuth, async (req, res) => {
  try {
    const { chatId, content, type = "text" } = req.body;
    if (!chatId || !content) {
      return res
        .status(400)
        .json({ error: "Chat ID and content are required" });
    }

    const newMessage = {
      id: uuidv4(),
      chatId,
      senderId: req.user.userId,
      content,
      type,
      status: "sent",
      createdAt: new Date().toISOString(),
    };

    await db.run(
      "INSERT INTO messages (id, chatId, senderId, content, type, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        newMessage.id,
        newMessage.chatId,
        newMessage.senderId,
        newMessage.content,
        newMessage.type,
        newMessage.status,
        newMessage.createdAt,
      ]
    );

    res.status(201).json(newMessage);
  } catch (error) {
    console.error("Create message error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// File Upload Route
app.post("/api/upload", verifyAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileInfo = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedBy: req.user.userId,
      uploadedAt: new Date().toISOString(),
    };

    await db.run(
      "INSERT INTO uploads (id, filename, originalName, path, size, mimetype, uploadedBy, uploadedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        fileInfo.id,
        fileInfo.filename,
        fileInfo.originalName,
        fileInfo.path,
        fileInfo.size,
        fileInfo.mimetype,
        fileInfo.uploadedBy,
        fileInfo.uploadedAt,
      ]
    );

    res.status(201).json(fileInfo);
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Serve uploaded files statically
app.use("/uploads", express.static(uploadDir));

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
