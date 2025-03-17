import fetch from 'node-fetch';

    const baseURL = 'http://localhost:3000/api';

    async function registerUser(username, password) {
      const response = await fetch(baseURL + '/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      return response.json();
    }

    async function loginUser(username, password) {
      const response = await fetch(baseURL + '/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      return response.json();
    }

    async function createChat(token, participants) {
      const response = await fetch(baseURL + '/chats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ participants })
      });
      return response.json();
    }

    async function getChats(token) {
      const response = await fetch(baseURL + '/chats', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      return response.json();
    }

    async function createMessage(token, chatId, content) {
      const response = await fetch(baseURL + '/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ chatId, content })
      });
      return response.json();
    }

    async function getMessages(token, chatId) {
      const response = await fetch(baseURL + `/messages?chatId=${chatId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      return response.json();
    }

    async function runTests() {
      // Delay to ensure the server is running
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Register two users
      const user1 = await registerUser('testuser1', 'password');
      const user2 = await registerUser('testuser2', 'password');

      console.log('Registered users:', user1, user2);

      // Login users
      const login1 = await loginUser('testuser1', 'password');
      const login2 = await loginUser('testuser2', 'password');

      console.log('Logged in users:', login1, login2);

      const token1 = login1.token;
      const token2 = login2.token;

      // Create a chat between the two users
      const createChatResponse = await createChat(token1, [user1.id, user2.id]);
      console.log('Created chat:', createChatResponse);
      const chatId = createChatResponse.id;

      // Get chats for user1
      const chatsForUser1 = await getChats(token1);
      console.log('Chats for user1:', chatsForUser1);

      // Create a message in the chat
      const message1 = await createMessage(token1, chatId, 'Hello from user1!');
      console.log('Created message:', message1);

      // Get messages for the chat
      const messagesInChat = await getMessages(token1, chatId);
      console.log('Messages in chat:', messagesInChat);
    }

    runTests();
