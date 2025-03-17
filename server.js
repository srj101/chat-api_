import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import multer from "multer"; // Added for file uploads

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// Secret key for JWT (should be in .env in production)
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Configure multer for file uploads
const uploadDir = path.join(__dirname, "uploads");
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(uploadDir, { recursive: true }); // Ensure upload directory exists
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`; // Unique filename
    cb(null, uniqueName);
  },
});

// 100 KB limit
const upload = multer({
  storage,
  limits: { fileSize: 100000 }, // 100 KB limit
  fileFilter: (req, file, cb) => {
    // Optional: Restrict file types (e.g., images, PDFs)
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
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

// Helper function to ensure directory and initialize file
const ensureFileExists = async (filePath, defaultData = []) => {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), "utf8");
  }
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

    const usersPath = path.join(__dirname, "data", "users.json");
    await ensureFileExists(usersPath);

    const data = await fs.readFile(usersPath, "utf8");
    let users = JSON.parse(data || "[]");

    if (users.some((user) => user.username === username)) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const newUser = {
      id: uuidv4(),
      username,
      password, // In production, hash this!
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await fs.writeFile(usersPath, JSON.stringify(users, null, 2));
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

    const usersPath = path.join(__dirname, "data", "users.json");
    await ensureFileExists(usersPath);

    const users = JSON.parse(await fs.readFile(usersPath, "utf8"));
    const user = users.find(
      (u) => u.username === username && u.password === password
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
    const chatsPath = path.join(__dirname, "data", "chats.json");
    await ensureFileExists(chatsPath);

    const chats = JSON.parse(await fs.readFile(chatsPath, "utf8"));
    const userChats = chats.filter((chat) =>
      chat.participants.includes(req.user.userId)
    );
    res.json(userChats);
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

    const chatsPath = path.join(__dirname, "data", "chats.json");
    await ensureFileExists(chatsPath);

    let chats = JSON.parse(await fs.readFile(chatsPath, "utf8"));
    if (!Array.isArray(chats)) chats = [];

    if (type === "individual" && participants.length === 2) {
      const existingChat = chats.find(
        (chat) =>
          chat.type === "individual" &&
          chat.participants.length === 2 &&
          chat.participants.includes(participants[0]) &&
          chat.participants.includes(participants[1])
      );
      if (existingChat) return res.json(existingChat);
    }

    const newChat = {
      id: uuidv4(),
      name: name || null,
      type,
      participants,
      createdBy: req.user.userId,
      createdAt: new Date().toISOString(),
    };

    chats.push(newChat);
    await fs.writeFile(chatsPath, JSON.stringify(chats, null, 2));
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

    const messagesPath = path.join(__dirname, "data", "messages.json");
    await ensureFileExists(messagesPath);

    const messages = JSON.parse(await fs.readFile(messagesPath, "utf8"));
    const chatMessages = messages.filter((msg) => msg.chatId === chatId);
    res.json(chatMessages);
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

    const messagesPath = path.join(__dirname, "data", "messages.json");
    await ensureFileExists(messagesPath);

    let messages = JSON.parse(await fs.readFile(messagesPath, "utf8"));
    if (!Array.isArray(messages)) messages = [];

    const newMessage = {
      id: uuidv4(),
      chatId,
      senderId: req.user.userId,
      content,
      type,
      status: "sent",
      createdAt: new Date().toISOString(),
      seenBy: [],
    };

    messages.push(newMessage);
    await fs.writeFile(messagesPath, JSON.stringify(messages, null, 2));
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
      path: `/uploads/${req.file.filename}`, // Relative path for frontend access
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedBy: req.user.userId,
      uploadedAt: new Date().toISOString(),
    };

    // Optionally store file metadata in a JSON file
    const uploadsPath = path.join(__dirname, "data", "uploads.json");
    await ensureFileExists(uploadsPath);

    let uploads = JSON.parse(await fs.readFile(uploadsPath, "utf8"));
    if (!Array.isArray(uploads)) uploads = [];
    uploads.push(fileInfo);
    await fs.writeFile(uploadsPath, JSON.stringify(uploads, null, 2));

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
