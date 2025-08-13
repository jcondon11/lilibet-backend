// auth.js - Enhanced with Hybrid Authentication (Email/Username) and Parent/Student Support
// FIXED: Proper database migration handling
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

// Enhanced database initialization with proper migration handling
const initializeDatabase = async () => {
  try {
    const client = await pool.connect();

    // Step 1: Create or alter users table with proper migration
    try {
      // First, create the basic users table if it doesn't exist
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

      // Now add new columns if they don't exist
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS username VARCHAR(50),
        ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'student',
        ADD COLUMN IF NOT EXISTS parent_id INTEGER,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS last_login TIMESTAMP
      `);
      console.log('✅ Enhanced users table with new columns');

      // Add constraints after columns exist
      await client.query(`
        ALTER TABLE users 
        ADD CONSTRAINT IF NOT EXISTS users_username_unique UNIQUE (username),
        ADD CONSTRAINT IF NOT EXISTS users_user_type_check CHECK (user_type IN ('student', 'parent'))
      `);
      console.log('✅ User table constraints added');

      // Add foreign key constraint if it doesn't exist
      try {
        await client.query(`
          ALTER TABLE users 
          ADD CONSTRAINT IF NOT EXISTS users_parent_id_fkey 
          FOREIGN KEY (parent_id) REFERENCES users(id)
        `);
      } catch (fkError) {
        // Foreign key might already exist, that's ok
        console.log('⚠️ Parent foreign key constraint may already exist');
      }

    } catch (userTableError) {
      console.error('Error with users table:', userTableError);
    }

    // Step 2: Enhanced conversations table
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
    
    // Add new conversation columns if they don't exist
    await client.query(`
      ALTER TABLE conversations 
      ADD COLUMN IF NOT EXISTS parent_visible BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS safety_reviewed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS content_rating VARCHAR(10) DEFAULT 'safe'
    `);
    console.log('✅ Enhanced conversations table ready');

    // Step 3: Parental settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS parental_settings (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES users(id),
        parent_id INTEGER NOT NULL REFERENCES users(id),
        daily_time_limit INTEGER DEFAULT 60,
        subject_restrictions TEXT DEFAULT '[]',
        content_filtering BOOLEAN DEFAULT TRUE,
        require_approval BOOLEAN DEFAULT FALSE,
        blocked_topics TEXT DEFAULT '[]',
        allowed_time_start TIME DEFAULT '06:00:00',
        allowed_time_end TIME DEFAULT '21:00:00',
        weekend_different BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, parent_id)
      )
    `);
    console.log('✅ Parental settings table ready');

    // Step 4: Activity tracking for learning analytics
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_activity (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        session_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_end TIMESTAMP,
        subject VARCHAR(100),
        learning_mode VARCHAR(50),
        messages_sent INTEGER DEFAULT 0,
        topics_explored TEXT DEFAULT '[]',
        time_spent_minutes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ User activity tracking table ready');

    // Step 5: User sessions table
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

    // Step 6: Create indexes ONLY after columns exist
    try {
      // Check if columns exist before creating indexes
      const emailIndex = await client.query(`
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'email'
      `);
      
      if (emailIndex.rows.length > 0) {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
      }

      const usernameIndex = await client.query(`
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'username'
      `);
      
      if (usernameIndex.rows.length > 0) {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
      }

      const parentIndex = await client.query(`
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'parent_id'
      `);
      
      if (parentIndex.rows.length > 0) {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_parent_id ON users(parent_id)`);
      }

      // Other indexes
      await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_parental_settings_student ON parental_settings(student_id)`);
      
      console.log('✅ Database indexes created successfully');
    } catch (indexError) {
      console.log('⚠️ Some indexes may already exist, continuing...');
    }

    client.release();
    console.log('🎉 Enhanced database initialized successfully with hybrid auth and parent/student support!');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    // Don't throw error, let app continue
    console.log('⚠️ Database initialization had issues but app will continue');
  }
};

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'lilibet-hybrid-auth-secret-change-in-production';

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

// Enhanced token generation with user type support
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      username: user.username,
      displayName: user.display_name || user.displayName,
      userType: user.user_type,
      ageGroup: user.age_group,
      parentId: user.parent_id
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
  // Username: 3-20 chars, letters, numbers, underscore, no spaces
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
};

// ENHANCED: Register user with user type selection
const registerUser = async (req, res) => {
  try {
    const { 
      email, 
      username, 
      password, 
      displayName, 
      userType = 'student', // 'student' or 'parent'
      ageGroup,
      parentEmail 
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

    if (!['student', 'parent'].includes(userType)) {
      return res.status(400).json({ error: 'User type must be either student or parent' });
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

      // Find parent if parent email provided (for student accounts)
      let parentId = null;
      if (userType === 'student' && parentEmail) {
        const parentResult = await client.query(
          'SELECT id FROM users WHERE email = $1 AND user_type = $2', 
          [parentEmail, 'parent']
        );
        if (parentResult.rows.length > 0) {
          parentId = parentResult.rows[0].id;
        }
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      
      const result = await client.query(`
        INSERT INTO users (email, username, password_hash, display_name, user_type, age_group, parent_id) 
        VALUES ($1, $2, $3, $4, $5, $6, $7) 
        RETURNING id, email, username, display_name, user_type, age_group, parent_id
      `, [
        email, 
        username || null,
        passwordHash, 
        displayName || email.split('@')[0], 
        userType,
        userType === 'parent' ? 'adult' : (ageGroup || 'middle'),
        parentId
      ]);

      const newUser = result.rows[0];

      // Create default parental settings if student is linked to parent
      if (parentId) {
        try {
          await client.query(`
            INSERT INTO parental_settings (student_id, parent_id) 
            VALUES ($1, $2)
          `, [newUser.id, parentId]);
        } catch (parentalError) {
          console.log('⚠️ Could not create parental settings:', parentalError.message);
        }
      }

      const token = generateToken(newUser);

      client.release();

      console.log(`🎉 New ${userType} registered: ${email}${username ? ` (username: ${username})` : ''}${parentId ? ' (linked to parent)' : ''}`);
      
      res.status(201).json({
        message: `${userType === 'parent' ? 'Parent' : 'Student'} account created successfully!`,
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          displayName: newUser.display_name,
          userType: newUser.user_type,
          ageGroup: newUser.age_group,
          hasParent: !!newUser.parent_id
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
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    const client = await pool.connect();

    try {
      // Try to find user by email OR username
      let query, params;
      if (isValidEmail(emailOrUsername)) {
        // Login with email
        query = 'SELECT * FROM users WHERE email = $1 AND is_active = TRUE';
        params = [emailOrUsername];
      } else {
        // Login with username
        query = 'SELECT * FROM users WHERE username = $1 AND is_active = TRUE';
        params = [emailOrUsername];
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
        userType: user.user_type,
        ageGroup: user.age_group,
        parentId: user.parent_id
      };

      const token = generateToken(userInfo);

      client.release();

      console.log(`🔓 ${user.user_type || 'user'} logged in: ${emailOrUsername}`);
      
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
      SELECT id, email, username, display_name, user_type, age_group, parent_id, created_at, last_login
      FROM users WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    // If this is a parent, get their students
    let students = [];
    if (user.user_type === 'parent') {
      try {
        const studentsResult = await client.query(`
          SELECT id, email, username, display_name, age_group, created_at, last_login
          FROM users WHERE parent_id = $1 AND user_type = 'student' AND is_active = TRUE
        `, [userId]);
        students = studentsResult.rows;
      } catch (studentsError) {
        console.log('⚠️ Could not fetch students:', studentsError.message);
      }
    }

    client.release();
    
    res.json({
      user: {
        ...user,
        displayName: user.display_name,
        userType: user.user_type,
        ageGroup: user.age_group,
        parentId: user.parent_id,
        students: students // Only populated for parent accounts
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Database error occurred' });
  }
};

// NEW: Link existing student to parent account
const linkStudentToParent = async (req, res) => {
  try {
    const parentId = req.user.id;
    const { studentEmail, studentUsername } = req.body;

    if (req.user.userType !== 'parent') {
      return res.status(403).json({ error: 'Only parent accounts can link students' });
    }

    if (!studentEmail && !studentUsername) {
      return res.status(400).json({ error: 'Student email or username is required' });
    }

    const client = await pool.connect();

    try {
      // Find student by email or username
      let query, params;
      if (studentEmail) {
        query = 'SELECT id, email, username, display_name, parent_id FROM users WHERE email = $1 AND user_type = $2';
        params = [studentEmail, 'student'];
      } else {
        query = 'SELECT id, email, username, display_name, parent_id FROM users WHERE username = $1 AND user_type = $2';
        params = [studentUsername, 'student'];
      }

      const studentResult = await client.query(query, params);

      if (studentResult.rows.length === 0) {
        client.release();
        return res.status(404).json({ error: 'Student account not found' });
      }

      const student = studentResult.rows[0];

      // Check if already linked to a parent
      if (student.parent_id) {
        client.release();
        return res.status(409).json({ error: 'Student is already linked to a parent account' });
      }

      // Link student to parent
      await client.query(
        'UPDATE users SET parent_id = $1 WHERE id = $2',
        [parentId, student.id]
      );

      // Create default parental settings
      try {
        await client.query(`
          INSERT INTO parental_settings (student_id, parent_id) 
          VALUES ($1, $2)
        `, [student.id, parentId]);
      } catch (parentalError) {
        console.log('⚠️ Could not create parental settings:', parentalError.message);
      }

      client.release();

      console.log(`👨‍👩‍👧‍👦 Student ${student.email} linked to parent ${req.user.email}`);
      
      res.json({
        message: 'Student successfully linked to your account!',
        student: {
          id: student.id,
          email: student.email,
          username: student.username,
          displayName: student.display_name
        }
      });

    } catch (dbError) {
      client.release();
      console.error('Database error:', dbError);
      res.status(500).json({ error: 'Database error occurred' });
    }

  } catch (error) {
    console.error('Link student error:', error);
    res.status(500).json({ error: 'Failed to link student' });
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
  linkStudentToParent,
  saveConversation,
  getUserConversations,
  getConversation,
  updateConversation,
  logoutUser
};