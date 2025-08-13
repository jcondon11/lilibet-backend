// auth_simple.js - Simplified working version
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

// Initialize database
const initializeDatabase = async () => {
  try {
    const client = await pool.connect();
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(50) UNIQUE,
        display_name VARCHAR(100),
        password_hash VARCHAR(255) NOT NULL,
        age_group VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create conversations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        subject VARCHAR(50),
        messages JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();
    console.log('✅ Database initialized');
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

// Register user - SIMPLIFIED
const registerUser = async (req, res) => {
  try {
    const { email, password, displayName, ageGroup } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const client = await pool.connect();

    try {
      const result = await client.query(
        `INSERT INTO users (email, display_name, password_hash, age_group) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, email, display_name, age_group`,
        [email, displayName || email.split('@')[0], hashedPassword, ageGroup || 'general']
      );

      const newUser = result.rows[0];
      const token = generateToken(newUser);

      res.status(201).json({
        message: 'Registration successful!',
        user: newUser,
        token
      });
    } catch (err) {
      if (err.code === '23505') { // Unique violation
        res.status(400).json({ error: 'Email already exists' });
      } else {
        throw err;
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// Login user - SIMPLIFIED
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const client = await pool.connect();

    try {
      const result = await client.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = generateToken(user);

      res.json({
        message: 'Login successful!',
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          ageGroup: user.age_group
        },
        token
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// Get user profile
const getUserProfile = async (req, res) => {
  res.json({ user: req.user });
};

// Save conversation
const saveConversation = async (req, res) => {
  try {
    const { subject, messages } = req.body;
    const userId = req.user.id;

    const client = await pool.connect();
    
    try {
      const result = await client.query(
        `INSERT INTO conversations (user_id, subject, messages) 
         VALUES ($1, $2, $3) 
         RETURNING id`,
        [userId, subject, JSON.stringify(messages)]
      );

      res.json({ conversationId: result.rows[0].id });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Save conversation error:', error);
    res.status(500).json({ error: 'Failed to save conversation' });
  }
};

// Get user conversations
const getUserConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const client = await pool.connect();

    try {
      const result = await client.query(
        'SELECT * FROM conversations WHERE user_id = $1 ORDER BY created_at DESC',
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

// Get single conversation
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

      res.json({ conversation: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};

// Update conversation
const updateConversation = async (req, res) => {
  res.json({ message: 'Update conversation not implemented yet' });
};

// Logout
const logoutUser = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};

// MAKE SURE ALL EXPORTS ARE DEFINED
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