import express from 'express';
    import bodyParser from 'body-parser';
    import cors from 'cors';
    import fs from 'fs/promises';
    import path from 'path';
    import { v4 as uuidv4 } from 'uuid';
    import jwt from 'jsonwebtoken';

    const app = express();
    const port = process.env.PORT || 3000;

    // Middleware
    app.use(cors());
    app.use(bodyParser.json());
    app.use(express.static('public'));

    // Secret key for JWT (should be in .env in production)
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

    // Helper function to verify JWT
    const verifyAuth = (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (authHeader) {
        const token = authHeader.split(' ')[1];

        jwt.verify(token, JWT_SECRET, (err, user) => {
          if (err) {
            return res.sendStatus(403);
          }

          req.user = user;
          next();
        });
      } else {
        res.sendStatus(401);
      }
    };

    // --- Routes ---

    // Authentication Routes
    app.post('/api/auth/register', async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password are required' });
        }

        const usersPath = path.join(__dirname, 'data', 'users.json');
        let users = [];
        try {
          const data = await fs.readFile(usersPath, 'utf8');
          users = JSON.parse(data);
        } catch (error) {
          // File doesn't exist yet, will create it
        }

        // Check if username already exists
        if (users.some(user => user.username === username)) {
          return res.status(400).json({ error: 'Username already exists' });
        }

        const newUser = {
          id: uuidv4(),
          username,
          password, // In production, this should be hashed!
          createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await fs.writeFile(usersPath, JSON.stringify(users, null, 2));

        const { password: _, ...userWithoutPassword } = newUser;
        res.json(userWithoutPassword);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/auth/login', async (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password are required' });
        }

        const usersPath = path.join(__dirname, 'data', 'users.json');
        const users = JSON.parse(await fs.readFile(usersPath, 'utf8'));

        const user = users.find(u => u.username === username && u.password === password);

        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, {
          expiresIn: '24h'
        });

        res.json({ token });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Chats Routes
    app.get('/api/chats', verifyAuth, async (req, res) => {
      try {
        const chatsPath = path.join(__dirname, 'data', 'chats.json');
        const chats = JSON.parse(await fs.readFile(chatsPath, 'utf8'));

        // Filter chats where the user is a participant
        const userChats = chats.filter(chat => 
          chat.participants.includes(req.user.userId)
        );

        res.json(userChats);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/chats', verifyAuth, async (req, res) => {
      try {
        const { name, participants, type = 'individual' } = req.body;

        if (!participants || !Array.isArray(participants)) {
          return res.status(400).json({ error: 'Participants array is required' });
        }

        const chatsPath = path.join(__dirname, 'data', 'chats.json');
        let chats = [];
        try {
          const data = await fs.readFile(chatsPath, 'utf8');
          chats = JSON.parse(data);
        } catch (error) {
          // File doesn't exist yet
        }

        // For individual chats, check if chat already exists
        if (type === 'individual' && participants.length === 2) {
          const existingChat = chats.find(chat => 
            chat.type === 'individual' &&
            chat.participants.length === 2 &&
            chat.participants.includes(participants[0]) &&
            chat.participants.includes(participants[1])
          );

          if (existingChat) {
            return res.json(existingChat);
          }
        }

        const newChat = {
          id: uuidv4(),
          name: name || null,
          type,
          participants,
          createdBy: req.user.userId,
          createdAt: new Date().toISOString()
        };

        chats.push(newChat);
        await fs.writeFile(chatsPath, JSON.stringify(chats, null, 2));

        res.json(newChat);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Messages Routes
    app.get('/api/messages', verifyAuth, async (req, res) => {
      try {
        const { chatId } = req.query;

        if (!chatId) {
          return res.status(400).json({ error: 'Chat ID is required' });
        }

        const messagesPath = path.join(__dirname, 'data', 'messages.json');
        const messages = JSON.parse(await fs.readFile(messagesPath, 'utf8'));

        const chatMessages = messages.filter(msg => msg.chatId === chatId);
        res.json(chatMessages);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    app.post('/api/messages', verifyAuth, async (req, res) => {
      try {
        const { chatId, content, type = 'text' } = req.body;

        if (!chatId || !content) {
          return res.status(400).json({ error: 'Chat ID and content are required' });
        }

        const messagesPath = path.join(__dirname, 'data', 'messages.json');
        let messages = [];
        try {
          const data = await fs.readFile(messagesPath, 'utf8');
          messages = JSON.parse(data);
        } catch (error) {
          // File doesn't exist yet
        }

        const newMessage = {
          id: uuidv4(),
          chatId,
          senderId: req.user.userId,
          content,
          type,
          status: 'sent',
          createdAt: new Date().toISOString(),
          seenBy: []
        };

        messages.push(newMessage);
        await fs.writeFile(messagesPath, JSON.stringify(messages, null, 2));

        res.json(newMessage);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // File Upload Route
    app.post('/api/upload', verifyAuth, async (req, res) => {
      try {
        // This is a placeholder - handling file uploads with express directly in WebContainer is tricky
        // In a real environment, you'd use middleware like 'multer' and configure a proper upload directory
        res.status(500).json({ error: 'File upload not implemented in this environment' });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Start the server
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
