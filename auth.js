// auth.js - PostgreSQL Version for Railway
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Database connection using Railway's provided DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect()
  .then(client => {
    console.log('✅ Connected to PostgreSQL database');
    client.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err);
  });

// Initialize database tables
const initializeDatabase = async () => {
  try {
    const client = await pool.connect();

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        age_group VARCHAR(50) DEFAULT 'middle',
        preferred_subjects TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Users table ready');

    // Conversations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        subject VARCHAR(100) NOT NULL,
        title VARCHAR(255),
        messages TEXT NOT NULL DEFAULT '[]',
        detected_level VARCHAR(50),
        model_used VARCHAR(50) DEFAULT 'openai',
        is_archived BOOLEAN DEFAULT FALSE,
        tags TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Conversations table ready');

    // User sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Sessions table ready');

    client.release();
    console.log('🎉 All database tables initialized successfully!');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
};

// JWT secret - use environment variable in production
const JWT_SECRET = process.env.JWT_SECRET || 'lilibet-fallback-secret-change-in-production';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('🔒 Invalid token attempt');
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

    const client = await pool.connect();

    try {
      // Check if user already exists
      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      
      if (existingUser.rows.length > 0) {
        client.release();
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      
      const result = await client.query(`
        INSERT INTO users (email, password_hash, display_name, age_group) 
        VALUES ($1, $2, $3, $4) 
        RETURNING id, email, display_name, age_group
      `, [
        email, 
        passwordHash, 
        displayName || email.split('@')[0], 
        ageGroup || 'middle'
      ]);

      const newUser = result.rows[0];
      const token = generateToken(newUser);

      client.release();

      console.log(`🎉 New user registered: ${email}`);
      res.status(201).json({
        message: 'Account created successfully!',
        user: {
          id: newUser.id,
          email: newUser.email,
          displayName: newUser.display_name,
          ageGroup: newUser.age_group
        },
        token
      });

    } catch (dbError) {
      client.release();
      console.error('Database error:', dbError);
      res.status(500).json({ error: 'Database error occurred' });
    }

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

    const client = await pool.connect();

    try {
      // Find user
      const result = await client.query(`
        SELECT id, email, password_hash, display_name, age_group 
        FROM users WHERE email = $1
      `, [email]);

      if (result.rows.length === 0) {
        client.release();
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = result.rows[0];

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        client.release();
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const userInfo = {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        ageGroup: user.age_group
      };

      const token = generateToken(userInfo);

      client.release();

      console.log(`🔓 User logged in: ${email}`);
      res.json({
        message: 'Login successful!',
        user: userInfo,
        token
      });

    } catch (dbError) {
      client.release();
      console.error('Database error:', dbError);
      res.status(500).json({ error: 'Database error occurred' });
    }

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const client = await pool.connect();

    const result = await client.query(`
      SELECT id, email, display_name, age_group, preferred_subjects, created_at 
      FROM users WHERE id = $1
    `, [userId]);

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    res.json({
      user: {
        ...user,
        displayName: user.display_name,
        ageGroup: user.age_group,
        preferred_subjects: JSON.parse(user.preferred_subjects || '[]')
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Database error occurred' });
  }
};

// Save conversation
const saveConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { subject, messages, detectedLevel, modelUsed, title } = req.body;

    if (!subject || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Subject and messages array are required' });
    }

    // Generate a title if not provided
    const conversationTitle = title || `${subject} session - ${new Date().toLocaleDateString()}`;

    const client = await pool.connect();

    const result = await client.query(`
      INSERT INTO conversations (user_id, subject, title, messages, detected_level, model_used)
      VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING id
    `, [
      userId, 
      subject, 
      conversationTitle, 
      JSON.stringify(messages), 
      detectedLevel, 
      modelUsed
    ]);

    client.release();

    console.log(`💾 Conversation saved for user ${userId}: ${conversationTitle}`);
    res.json({
      message: 'Conversation saved successfully',
      conversationId: result.rows[0].id
    });

  } catch (error) {
    console.error('Save conversation error:', error);
    res.status(500).json({ error: 'Failed to save conversation' });
  }
};

// Get user's conversations
const getUserConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { subject, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT id, subject, title, detected_level, model_used, created_at, updated_at
      FROM conversations 
      WHERE user_id = $1 AND is_archived = FALSE
    `;
    let params = [userId];
    let paramCount = 1;

    if (subject) {
      paramCount++;
      query += ` AND subject = $${paramCount}`;
      params.push(subject);
    }

    paramCount++;
    query += ` ORDER BY updated_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const client = await pool.connect();
    const result = await client.query(query, params);
    client.release();

    res.json({ conversations: result.rows });

  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Database error occurred' });
  }
};

// Get specific conversation with messages
const getConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;

    const client = await pool.connect();
    
    const result = await client.query(`
      SELECT * FROM conversations 
      WHERE id = $1 AND user_id = $2
    `, [conversationId, userId]);

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation = result.rows[0];

    res.json({
      conversation: {
        ...conversation,
        messages: JSON.parse(conversation.messages)
      }
    });

  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Database error occurred' });
  }
};

// Update conversation (for adding new messages)
const updateConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    const { messages, title } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const client = await pool.connect();

    let query = 'UPDATE conversations SET messages = $1, updated_at = CURRENT_TIMESTAMP';
    let params = [JSON.stringify(messages)];
    let paramCount = 1;

    if (title) {
      paramCount++;
      query += `, title = $${paramCount}`;
      params.push(title);
    }

    paramCount++;
    query += ` WHERE id = $${paramCount}`;
    params.push(conversationId);
    
    paramCount++;
    query += ` AND user_id = $${paramCount}`;
    params.push(userId);

    const result = await client.query(query, params);
    client.release();

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({ message: 'Conversation updated successfully' });

  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
};

// Logout (invalidate token on server side)
const logoutUser = (req, res) => {
  console.log('👋 User logged out');
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
  pool
};