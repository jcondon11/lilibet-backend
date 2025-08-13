// auth.js - Enhanced with Email OR Username Login Support
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection
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

// Enhanced database initialization with username support
const initializeDatabase = async () => {
  try {
    const client = await pool.connect();

    // Create or alter users table with username support
    try {
      // First, create basic users table if it doesn't exist
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
      console.log('✅ Basic users table ready');

      // Add username column if it doesn't exist
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS username VARCHAR(50),
        ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'student',
        ADD COLUMN IF NOT EXISTS parent_id INTEGER,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS last_login TIMESTAMP
      `);
      console.log('✅ Enhanced users table with username support');

      // Add unique constraint on username if it doesn't exist
      try {
        await client.query(`
          ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username)
        `);
      } catch (constraintError) {
        if (!constraintError.message.includes('already exists')) {
          console.log('⚠️ Username constraint issue:', constraintError.message);
        }
      }

    } catch (userTableError) {
      console.error('Error with users table:', userTableError);
    }

    // Enhanced conversations table
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
    console.log('✅ Enhanced conversations table ready');

    // User sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token_hash VARCHAR(255) NOT NULL,
        device_info VARCHAR(255),
        ip_address INET,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Enhanced sessions table ready');

    // Create indexes safely
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`);
      console.log('✅ Database indexes created successfully');
    } catch (indexError) {
      console.log('⚠️ Some indexes may already exist, continuing...');
    }

    client.release();
    console.log('🎉 Enhanced database initialized successfully with email/username support!');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    console.log('⚠️ Database initialization had issues but app will continue');
  }
};

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'lilibet-enhanced-auth-secret-change-in-production';

// Enhanced middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

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

// Enhanced token generation
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      username: user.username,
      displayName: user.display_name || user.displayName,
      userType: user.user_type,
      ageGroup: user.age_group
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Helper functions
const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const isValidUsername = (username) => {
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
};

// ENHANCED: Register user with optional username
const registerUser = async (req, res) => {
  try {
    const { 
      email, 
      username, 
      password, 
      displayName, 
      userType = 'student',
      ageGroup
    } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (username && !isValidUsername(username)) {
      return res.status(400).json({ 
        error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const client = await pool.connect();

    try {
      // Check if email already exists
      const existingEmail = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingEmail.rows.length > 0) {
        client.release();
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Check if username already exists (if provided)
      if (username) {
        const existingUsername = await client.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUsername.rows.length > 0) {
          client.release();
          return res.status(409).json({ error: 'This username is already taken' });
        }
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      
      const result = await client.query(`
        INSERT INTO users (email, username, password_hash, display_name, user_type, age_group) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id, email, username, display_name, user_type, age_group
      `, [
        email, 
        username || null,
        passwordHash, 
        displayName || email.split('@')[0], 
        userType,
        userType === 'parent' ? 'adult' : (ageGroup || 'middle')
      ]);

      const newUser = result.rows[0];
      const token = generateToken(newUser);

      client.release();

      console.log(`🎉 New ${userType} registered: ${email}${username ? ` (username: ${username})` : ''}`);
      
      res.status(201).json({
        message: `${userType === 'parent' ? 'Parent' : 'Student'} account created successfully!`,
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          displayName: newUser.display_name,
          userType: newUser.user_type,
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

// ENHANCED: Login with email OR username support
const loginUser = async (req, res) => {
  try {
    // SUPPORT BOTH FORMATS: 
    // New format: { emailOrUsername, password }
    // Old format: { email, password }
    const { emailOrUsername, email, password } = req.body;
    
    const loginIdentifier = emailOrUsername || email;

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    const client = await pool.connect();

    try {
      // Try to find user by email OR username
      let query, params;
      if (isValidEmail(loginIdentifier)) {
        // Login with email
        query = 'SELECT * FROM users WHERE email = $1 AND (is_active IS NULL OR is_active = TRUE)';
        params = [loginIdentifier];
      } else {
        // Login with username
        query = 'SELECT * FROM users WHERE username = $1 AND (is_active IS NULL OR is_active = TRUE)';
        params = [loginIdentifier];
      }

      const result = await client.query(query, params);

      if (result.rows.length === 0) {
        client.release();
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        client.release();
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last login
      try {
        await client.query(
          'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
          [user.id]
        );
      } catch (updateError) {
        console.log('⚠️ Could not update last login:', updateError.message);
      }

      const userInfo = {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        userType: user.user_type || 'student',
        ageGroup: user.age_group
      };

      const token = generateToken(userInfo);

      client.release();

      console.log(`🔓 ${user.user_type || 'user'} logged in: ${loginIdentifier}`);
      
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

// Enhanced get user profile
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const client = await pool.connect();

    const result = await client.query(`
      SELECT id, email, username, display_name, user_type, age_group, created_at, last_login
      FROM users WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    client.release();
    
    res.json({
      user: {
        ...user,
        displayName: user.display_name,
        userType: user.user_type,
        ageGroup: user.age_group
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Database error occurred' });
  }
};

// Save conversation (existing functionality maintained)
const saveConversation = async (req, res) => {
  try {
    const { subject, messages, title } = req.body;
    const userId = req.user.id;

    const client = await pool.connect();
    
    try {
      const result = await client.query(
        `INSERT INTO conversations (user_id, subject, title, messages) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [userId, subject, title || `${subject} - ${new Date().toLocaleDateString()}`, JSON.stringify(messages)]
      );

      res.json({ 
        message: 'Conversation saved successfully',
        conversationId: result.rows[0].id 
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Save conversation error:', error);
    res.status(500).json({ error: 'Failed to save conversation' });
  }
};

// Get user conversations (existing functionality maintained)
const getUserConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const client = await pool.connect();

    try {
      const result = await client.query(
        `SELECT id, subject, title, created_at, updated_at 
         FROM conversations 
         WHERE user_id = $1 AND is_archived = FALSE 
         ORDER BY updated_at DESC`,
        [userId]
      );

      res.json({ conversations: result.rows });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
};

// Get specific conversation (existing functionality maintained)
const getConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const client = await pool.connect();

    try {
      const result = await client.query(
        'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const conversation = result.rows[0];
      conversation.messages = JSON.parse(conversation.messages);

      res.json(conversation);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};

// Update conversation (existing functionality maintained)
const updateConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { messages } = req.body;
    const userId = req.user.id;

    const client = await pool.connect();

    try {
      const result = await client.query(
        `UPDATE conversations 
         SET messages = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 AND user_id = $3 
         RETURNING id`,
        [JSON.stringify(messages), id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      res.json({ message: 'Conversation updated successfully' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
};

// Logout user (existing functionality maintained)
const logoutUser = async (req, res) => {
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
  logoutUser
};