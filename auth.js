// auth.js - Enhanced Hybrid Authentication System
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize database with enhanced schema
const initializeDatabase = async () => {
  try {
    const client = await pool.connect();
    
    // Create enhanced users table with username support
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(50) UNIQUE,
        display_name VARCHAR(100),
        password_hash VARCHAR(255) NOT NULL,
        account_type VARCHAR(20) DEFAULT 'student',
        age_group VARCHAR(20),
        parent_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        settings JSONB DEFAULT '{}',
        avatar_emoji VARCHAR(10) DEFAULT '🎓'
      );
    `);

    // Create conversations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject VARCHAR(50),
        messages JSONB,
        learning_mode VARCHAR(50),
        model_used VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_saved BOOLEAN DEFAULT false,
        title VARCHAR(255),
        summary TEXT,
        parent_viewed BOOLEAN DEFAULT false
      );
    `);

    // Create learning analytics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS learning_analytics (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        date DATE DEFAULT CURRENT_DATE,
        total_minutes INTEGER DEFAULT 0,
        messages_sent INTEGER DEFAULT 0,
        subjects JSONB DEFAULT '{}',
        learning_modes JSONB DEFAULT '{}',
        points_earned INTEGER DEFAULT 0,
        streak_days INTEGER DEFAULT 0
      );
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_username_lower ON users(LOWER(username));
      CREATE INDEX IF NOT EXISTS idx_email_lower ON users(LOWER(email));
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_user_date ON learning_analytics(user_id, date);
    `);

    client.release();
    console.log('✅ Database initialized with hybrid authentication support');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

// Generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      username: user.username,
      accountType: user.accountType,
      displayName: user.displayName 
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// Authenticate token middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Register new user (parent or student)
const registerUser = async (req, res) => {
  try {
    const { 
      email, 
      username,
      password, 
      displayName, 
      ageGroup,
      accountType = 'student',
      parentEmail = null 
    } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate username if provided
    if (username && !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ 
        error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores' 
      });
    }

    const client = await pool.connect();

    try {
      // Check if email already exists
      const emailCheck = await client.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );

      if (emailCheck.rows.length > 0) {
        client.release();
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Check if username already exists (if provided)
      if (username) {
        const usernameCheck = await client.query(
          'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
          [username]
        );

        if (usernameCheck.rows.length > 0) {
          client.release();
          return res.status(400).json({ error: 'Username already taken' });
        }
      }

      // Find parent ID if this is a student account with parent email
      let parentId = null;
      if (accountType === 'student' && parentEmail) {
        const parentResult = await client.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND account_type = $2',
          [parentEmail, 'parent']
        );
        if (parentResult.rows.length > 0) {
          parentId = parentResult.rows[0].id;
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert new user
      const result = await client.query(`
        INSERT INTO users (
          email, username, display_name, password_hash, 
          account_type, age_group, parent_id, avatar_emoji
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING id, email, username, display_name, account_type, age_group, avatar_emoji
      `, [
        email.toLowerCase(),
        username ? username.toLowerCase() : null,
        displayName || username || email.split('@')[0],
        hashedPassword,
        accountType,
        ageGroup,
        parentId,
        accountType === 'student' ? '🎓' : '👨‍👩‍👧‍👦'
      ]);

      const newUser = result.rows[0];
      client.release();

      // Generate token
      const token = generateToken(newUser);

      console.log(`✅ New ${accountType} registered: ${email} (${username || 'no username'})`);

      res.status(201).json({
        message: 'Registration successful!',
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          displayName: newUser.display_name,
          accountType: newUser.account_type,
          ageGroup: newUser.age_group,
          avatar: newUser.avatar_emoji
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

// Enhanced login - accepts email OR username
const loginUser = async (req, res) => {
  try {
    const { loginId, password } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({ error: 'Login ID and password are required' });
    }

    const client = await pool.connect();

    try {
      // Check if loginId is email (contains @) or username
      const isEmail = loginId.includes('@');
      
      // Query user by email or username
      const query = isEmail
        ? 'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true'
        : 'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND is_active = true';
      
      const result = await client.query(query, [loginId]);

      if (result.rows.length === 0) {
        client.release();
        return res.status(401).json({ error: 'Invalid login credentials' });
      }

      const user = result.rows[0];

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        client.release();
        return res.status(401).json({ error: 'Invalid login credentials' });
      }

      // Update last login
      await client.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      const userInfo = {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        accountType: user.account_type,
        ageGroup: user.age_group,
        avatar: user.avatar_emoji
      };

      const token = generateToken(userInfo);

      client.release();

      console.log(`🔓 User logged in: ${loginId} (${user.account_type})`);
      
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
      SELECT id, email, username, display_name, account_type, 
             age_group, avatar_emoji, created_at, last_login, settings
      FROM users 
      WHERE id = $1 AND is_active = true
    `, [userId]);

    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { displayName, ageGroup, avatarEmoji, settings } = req.body;
    
    const client = await pool.connect();

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (displayName !== undefined) {
      updates.push(`display_name = $${paramCount++}`);
      values.push(displayName);
    }
    if (ageGroup !== undefined) {
      updates.push(`age_group = $${paramCount++}`);
      values.push(ageGroup);
    }
    if (avatarEmoji !== undefined) {
      updates.push(`avatar_emoji = $${paramCount++}`);
      values.push(avatarEmoji);
    }
    if (settings !== undefined) {
      updates.push(`settings = $${paramCount++}`);
      values.push(JSON.stringify(settings));
    }

    if (updates.length === 0) {
      client.release();
      return res.status(400).json({ error: 'No updates provided' });
    }

    values.push(userId);

    const result = await client.query(`
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, email, username, display_name, account_type, age_group, avatar_emoji, settings
    `, values);

    client.release();

    res.json({ 
      message: 'Profile updated successfully',
      user: result.rows[0] 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// Check username availability
const checkUsername = async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ 
        available: false,
        error: 'Invalid username format' 
      });
    }

    const client = await pool.connect();
    
    const result = await client.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    
    client.release();
    
    res.json({ 
      available: result.rows.length === 0,
      username: username 
    });
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({ error: 'Failed to check username' });
  }
};

// Get linked students (for parent accounts)
const getLinkedStudents = async (req, res) => {
  try {
    const parentId = req.user.id;
    const client = await pool.connect();

    const result = await client.query(`
      SELECT id, email, username, display_name, age_group, 
             avatar_emoji, last_login, created_at
      FROM users 
      WHERE parent_id = $1 AND is_active = true
      ORDER BY display_name
    `, [parentId]);

    client.release();

    res.json({ students: result.rows });
  } catch (error) {
    console.error('Get linked students error:', error);
    res.status(500).json({ error: 'Failed to get linked students' });
  }
};

// Export all functions
module.exports = {
  initializeDatabase,
  authenticateToken,
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  checkUsername,
  getLinkedStudents,
  generateToken,
  pool
};