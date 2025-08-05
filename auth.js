// auth.js - Updated for Railway Volume Support
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database setup - Use volume path in production
const getDbPath = () => {
  // Railway volume path for persistent storage
  const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (volumePath) {
    return path.join(volumePath, 'lilibet.db');
  }
  // Local development path
  return path.join(__dirname, 'lilibet.db');
};

const dbPath = getDbPath();
console.log(`📁 Database path: ${dbPath}`);

// Ensure directory exists in production
const fs = require('fs');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

// Initialize database tables
const initializeDatabase = () => {
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      age_group TEXT DEFAULT 'middle',
      preferred_subjects TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Conversations table
    db.run(`CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      title TEXT,
      messages TEXT NOT NULL DEFAULT '[]',
      detected_level TEXT,
      model_used TEXT DEFAULT 'openai',
      is_archived INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // User sessions table (for tracking active sessions)
    db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    console.log('✅ Database tables initialized');
    console.log(`💾 Database location: ${dbPath}`);
  });
};

// JWT secret - use environment variable in production
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-in-production';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Helper function to generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' } // Token expires in 7 days
  );
};

// Helper function to hash passwords
const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

// Helper function to validate email
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Auth routes to add to your server.js

// Register new user
const registerUser = async (req, res) => {
  try {
    const { email, password, displayName, ageGroup } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if user already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error occurred' });
      }

      if (existingUser) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Hash password and create user
      try {
        const passwordHash = await hashPassword(password);
        
        db.run(
          `INSERT INTO users (email, password_hash, display_name, age_group) 
           VALUES (?, ?, ?, ?)`,
          [email, passwordHash, displayName || email.split('@')[0], ageGroup || 'middle'],
          function(err) {
            if (err) {
              console.error('Error creating user:', err);
              return res.status(500).json({ error: 'Failed to create account' });
            }

            const newUser = {
              id: this.lastID,
              email,
              displayName: displayName || email.split('@')[0],
              ageGroup: ageGroup || 'middle'
            };

            const token = generateToken(newUser);

            console.log(`✅ New user registered: ${email}`);
            res.status(201).json({
              message: 'Account created successfully!',
              user: newUser,
              token
            });
          }
        );
      } catch (hashError) {
        console.error('Password hashing error:', hashError);
        res.status(500).json({ error: 'Failed to secure password' });
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// Login user
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    db.get(
      'SELECT id, email, password_hash, display_name, age_group FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database error occurred' });
        }

        if (!user) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Verify password
        try {
          const passwordMatch = await bcrypt.compare(password, user.password_hash);
          
          if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
          }

          const userInfo = {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            ageGroup: user.age_group
          };

          const token = generateToken(userInfo);

          console.log(`✅ User logged in: ${email}`);
          res.json({
            message: 'Login successful!',
            user: userInfo,
            token
          });

        } catch (compareError) {
          console.error('Password comparison error:', compareError);
          res.status(500).json({ error: 'Authentication failed' });
        }
      }
    );

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// Get user profile
const getUserProfile = (req, res) => {
  const userId = req.user.id;

  db.get(
    'SELECT id, email, display_name, age_group, preferred_subjects, created_at FROM users WHERE id = ?',
    [userId],
    (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error occurred' });
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        user: {
          ...user,
          preferred_subjects: JSON.parse(user.preferred_subjects || '[]')
        }
      });
    }
  );
};

// Save conversation
const saveConversation = (req, res) => {
  const userId = req.user.id;
  const { subject, messages, detectedLevel, modelUsed, title } = req.body;

  if (!subject || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Subject and messages array are required' });
  }

  // Generate a title if not provided
  const conversationTitle = title || `${subject} session - ${new Date().toLocaleDateString()}`;

  db.run(
    `INSERT INTO conversations (user_id, subject, title, messages, detected_level, model_used)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, subject, conversationTitle, JSON.stringify(messages), detectedLevel, modelUsed],
    function(err) {
      if (err) {
        console.error('Error saving conversation:', err);
        return res.status(500).json({ error: 'Failed to save conversation' });
      }

      console.log(`💾 Conversation saved for user ${userId}: ${conversationTitle}`);
      res.json({
        message: 'Conversation saved successfully',
        conversationId: this.lastID
      });
    }
  );
};

// Get user's conversations
const getUserConversations = (req, res) => {
  const userId = req.user.id;
  const { subject, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT id, subject, title, detected_level, model_used, created_at, updated_at
    FROM conversations 
    WHERE user_id = ? AND is_archived = 0
  `;
  let params = [userId];

  if (subject) {
    query += ' AND subject = ?';
    params.push(subject);
  }

  query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, conversations) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error occurred' });
    }

    res.json({ conversations });
  });
};

// Get specific conversation with messages
const getConversation = (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  db.get(
    `SELECT * FROM conversations 
     WHERE id = ? AND user_id = ?`,
    [conversationId, userId],
    (err, conversation) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error occurred' });
      }

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      res.json({
        conversation: {
          ...conversation,
          messages: JSON.parse(conversation.messages)
        }
      });
    }
  );
};

// Update conversation (for adding new messages)
const updateConversation = (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;
  const { messages, title } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  let query = 'UPDATE conversations SET messages = ?, updated_at = CURRENT_TIMESTAMP';
  let params = [JSON.stringify(messages)];

  if (title) {
    query += ', title = ?';
    params.push(title);
  }

  query += ' WHERE id = ? AND user_id = ?';
  params.push(conversationId, userId);

  db.run(query, params, function(err) {
    if (err) {
      console.error('Error updating conversation:', err);
      return res.status(500).json({ error: 'Failed to update conversation' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ message: 'Conversation updated successfully' });
  });
};

// Logout (invalidate token on server side)
const logoutUser = (req, res) => {
  // In a more complex system, you'd add the token to a blacklist
  // For now, we'll just send success and let client remove token
  res.json({ message: 'Logged out successfully' });
};

module.exports = {
  initializeDatabase,
  authenticateToken,
  registerUser,
  loginUser,
  getUserProfile,
  saveConversation,
  getUserConversations,
  getConversation,
  updateConversation,
  logoutUser,
  db
};