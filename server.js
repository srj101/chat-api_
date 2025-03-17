import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import sqlite3 from "sqlite3";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static("public"));

// Disable CORS entirely (allow all origins, methods, headers)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200); // Respond to preflight requests immediately
  }
  next();
});

// SQLite database setup
const dbPath = path.join(__dirname, "data", "chat.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err);
  } else {
    console.log("Database connected");
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          createdAt TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          name TEXT,
          type TEXT NOT NULL DEFAULT 'individual',
          createdBy TEXT NOT NULL,
          createdAt TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS chat_participants (
          chatId TEXT,
          userId TEXT,
          FOREIGN KEY (chatId) REFERENCES chats(id),
          FOREIGN KEY (userId) REFERENCES users(id),
          PRIMARY KEY (chatId, userId)
        )
      `);
      db.run(`
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
        )
      `);
      db.run(`
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
        )
      `);
    });
  }
});

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

// 50 KB limit
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 50 },
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

// Promisify SQLite queries
const runQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const getQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const allQuery = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// --- Routes ---

// Authentication Routes (No JWT verification)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    const existingUser = await getQuery(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const newUser = {
      id: uuidv4(),
      username,
      password, // No hashing for simplicity
      createdAt: new Date().toISOString(),
    };

    await runQuery(
      "INSERT INTO users (id, username, password, createdAt) VALUES (?, ?, ?, ?)",
      [newUser.id, newUser.username, newUser.password, newUser.createdAt]
    );

    res.status(201).json({ id: newUser.id, username: newUser.username });
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

    const user = await getQuery(
      "SELECT * FROM users WHERE username = ? AND password = ?",
      [username, password]
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ id: user.id, username: user.username }); // No token, just user info
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Chats Routes (No auth verification)
app.get("/api/chats", async (req, res) => {
  try {
    const { userId } = req.query; // Pass userId as query param
    if (!userId) {
      return res
        .status(400)
        .json({ error: "userId query parameter is required" });
    }

    const chats = await allQuery(
      `
      SELECT c.*
      FROM chats c
      JOIN chat_participants cp ON c.id = cp.chatId
      WHERE cp.userId = ?
    `,
      [userId]
    );
    res.json(chats);
  } catch (error) {
    console.error("Get chats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/chats", async (req, res) => {
  try {
    const { name, participants, type = "individual", createdBy } = req.body;
    if (!participants || !Array.isArray(participants) || !createdBy) {
      return res
        .status(400)
        .json({ error: "participants array and createdBy are required" });
    }

    if (type === "individual" && participants.length === 2) {
      const existingChat = await getQuery(
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
      createdBy,
      createdAt: new Date().toISOString(),
    };

    await runQuery(
      "INSERT INTO chats (id, name, type, createdBy, createdAt) VALUES (?, ?, ?, ?, ?)",
      [
        newChat.id,
        newChat.name,
        newChat.type,
        newChat.createdBy,
        newChat.createdAt,
      ]
    );

    for (const userId of participants) {
      await runQuery(
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

// Messages Routes (No auth verification)
app.get("/api/messages", async (req, res) => {
  try {
    const { chatId } = req.query;
    if (!chatId) {
      return res.status(400).json({ error: "Chat ID is required" });
    }

    const messages = await allQuery("SELECT * FROM messages WHERE chatId = ?", [
      chatId,
    ]);
    res.json(messages);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/messages", async (req, res) => {
  try {
    const { chatId, content, senderId, type = "text" } = req.body;
    if (!chatId || !content || !senderId) {
      return res
        .status(400)
        .json({ error: "chatId, content, and senderId are required" });
    }

    const newMessage = {
      id: uuidv4(),
      chatId,
      senderId,
      content,
      type,
      status: "sent",
      createdAt: new Date().toISOString(),
    };

    await runQuery(
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

// File Upload Route (No auth verification)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { uploadedBy } = req.body; // Expect uploadedBy in form-data
    if (!uploadedBy) {
      return res.status(400).json({ error: "uploadedBy is required" });
    }

    const fileInfo = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
    };

    await runQuery(
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

// Cleanup on process exit
process.on("SIGINT", () => {
  db.close((err) => {
    if (err) console.error("Error closing database:", err);
    console.log("Database connection closed");
    process.exit(0);
  });
});
