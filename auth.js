// auth.js - Complete Authentication with Parent-Student Linking
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

// Enhanced database initialization with parent-student linking
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

    // NEW: Parent-Student Linking Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS parent_student_links (
        id SERIAL PRIMARY KEY,
        parent_id INTEGER REFERENCES users(id),
        student_id INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        invitation_code VARCHAR(10) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP,
        UNIQUE(parent_id, student_id)
      )
    `);
    console.log('✅ Parent-Student linking table ready');

    // Create indexes safely
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON parent_student_links(parent_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_parent_links_student ON parent_student_links(student_id)`);
      console.log('✅ Database indexes created successfully');
    } catch (indexError) {
      console.log('⚠️ Some indexes may already exist, continuing...');
    }

    client.release();
    console.log('🎉 Enhanced database initialized successfully with parent-student linking!');
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
      console.log('🔑 Invalid token attempt');
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

// ENHANCED: Register user with optional parent invitation code
const registerUser = async (req, res) => {
  try {
    console.log('📝 Registration attempt started');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    
    const { 
      email, 
      username, 
      password, 
      displayName, 
      userType = 'student',
      ageGroup = 'middle',
      parentInviteCode // NEW: Optional parent invitation code
    } = req.body;

    // Validation
    if (!email || !password) {
      console.log('❌ Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!isValidEmail(email)) {
      console.log('❌ Invalid email format:', email);
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    if (username && !isValidUsername(username)) {
      console.log('❌ Invalid username format:', username);
      return res.status(400).json({ 
        error: 'Username must be 3-20 characters and contain only letters, numbers, and underscores' 
      });
    }

    if (password.length < 6) {
      console.log('❌ Password too short');
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const client = await pool.connect();

    try {
      // Check if email already exists
      const existingEmail = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      if (existingEmail.rows.length > 0) {
        console.log('❌ Email already exists:', email);
        client.release();
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Check if username already exists (if provided)
      if (username) {
        const existingUsername = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        if (existingUsername.rows.length > 0) {
          console.log('❌ Username already exists:', username);
          client.release();
          return res.status(409).json({ error: 'This username is already taken' });
        }
      }

      // Hash password and create user
      const passwordHash = await hashPassword(password);
      console.log('🔐 Password hashed successfully');
      
      const finalAgeGroup = userType === 'parent' ? 'adult' : (ageGroup || 'middle');
      
      console.log('📝 Creating user with:', {
        email,
        username: username || null,
        displayName: displayName || email.split('@')[0],
        userType,
        ageGroup: finalAgeGroup
      });
      
      const result = await client.query(`
        INSERT INTO users (email, username, password_hash, display_name, user_type, age_group) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id, email, username, display_name, user_type, age_group
      `, [
        email.toLowerCase(),
        username ? username.toLowerCase() : null,
        passwordHash, 
        displayName || email.split('@')[0], 
        userType,
        finalAgeGroup
      ]);

      const newUser = result.rows[0];

      // NEW: If parent registering with invite code, link to student
      if (userType === 'parent' && parentInviteCode) {
        console.log('🔗 Linking parent to student with code:', parentInviteCode);
        
        // Find the student with this invitation code
        const linkResult = await client.query(`
          UPDATE parent_student_links 
          SET parent_id = $1, status = 'active', accepted_at = CURRENT_TIMESTAMP
          WHERE invitation_code = $2 AND parent_id IS NULL
          RETURNING student_id
        `, [newUser.id, parentInviteCode.toUpperCase()]);

        if (linkResult.rows.length > 0) {
          console.log('✅ Successfully linked to student:', linkResult.rows[0].student_id);
        } else {
          console.log('⚠️ Invalid or already used invitation code');
          // Don't fail registration, just note that linking didn't work
        }
      }

      const token = generateToken(newUser);

      client.release();

      console.log(`✅ New ${userType} registered successfully:`, {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username
      });
      
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
      console.error('❌ Database error during registration:', dbError);
      res.status(500).json({ error: 'Database error occurred: ' + dbError.message });
    }

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
};

// Login user (no changes needed)
const loginUser = async (req, res) => {
  try {
    console.log('🔐 Login attempt started');
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    
    const { emailOrUsername, email, password } = req.body;
    const loginIdentifier = emailOrUsername || email;

    console.log('🔍 Login identifier:', loginIdentifier);
    console.log('🔑 Password length:', password ? password.length : 0);

    if (!loginIdentifier || !password) {
      console.log('❌ Missing credentials');
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    const client = await pool.connect();

    try {
      let query, params;
      if (isValidEmail(loginIdentifier)) {
        console.log('📧 Attempting email login');
        query = 'SELECT * FROM users WHERE LOWER(email) = LOWER($1)';
        params = [loginIdentifier];
      } else {
        console.log('👤 Attempting username login');
        query = 'SELECT * FROM users WHERE LOWER(username) = LOWER($1)';
        params = [loginIdentifier];
      }

      console.log('🔍 Executing query:', query);
      console.log('🔍 With params:', params);

      const result = await client.query(query, params);

      if (result.rows.length === 0) {
        console.log('❌ No user found with identifier:', loginIdentifier);
        client.release();
        return res.status(401).json({ error: 'Invalid credentials - user not found' });
      }

      const user = result.rows[0];
      console.log('✅ User found:', {
        id: user.id,
        email: user.email,
        username: user.username,
        hasPassword: !!user.password_hash
      });

      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      console.log('🔐 Password match result:', passwordMatch);
      
      if (!passwordMatch) {
        console.log('❌ Password mismatch for user:', user.email);
        client.release();
        return res.status(401).json({ error: 'Invalid credentials - wrong password' });
      }

      try {
        await client.query(
          'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
          [user.id]
        );
        console.log('✅ Updated last login timestamp');
      } catch (updateError) {
        console.log('⚠️ Could not update last login:', updateError.message);
      }

      const userInfo = {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.display_name || user.email.split('@')[0],
        userType: user.user_type || 'student',
        ageGroup: user.age_group || 'middle'
      };

      const token = generateToken(userInfo);

      client.release();

      console.log(`✅ ${user.user_type || 'user'} logged in successfully:`, loginIdentifier);
      
      res.json({
        message: 'Login successful!',
        user: userInfo,
        token
      });

    } catch (dbError) {
      client.release();
      console.error('❌ Database error during login:', dbError);
      res.status(500).json({ error: 'Database error occurred: ' + dbError.message });
    }

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
};

// Get user profile
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

// NEW: Get linked parents for a student
const getLinkedParents = async (req, res) => {
  try {
    const studentId = req.user.id;
    const client = await pool.connect();

    const result = await client.query(`
      SELECT u.id, u.email, u.display_name, psl.status, psl.created_at
      FROM parent_student_links psl
      JOIN users u ON u.id = psl.parent_id
      WHERE psl.student_id = $1
      ORDER BY psl.created_at DESC
    `, [studentId]);

    client.release();
    
    res.json({ parents: result.rows });

  } catch (error) {
    console.error('Get linked parents error:', error);
    res.status(500).json({ error: 'Failed to get linked parents' });
  }
};

// NEW: Get linked students for a parent
const getLinkedStudents = async (req, res) => {
  try {
    const parentId = req.user.id;
    const client = await pool.connect();

    const result = await client.query(`
      SELECT u.id, u.email, u.display_name, u.age_group, psl.status, psl.created_at
      FROM parent_student_links psl
      JOIN users u ON u.id = psl.student_id
      WHERE psl.parent_id = $1 AND psl.status = 'active'
      ORDER BY psl.created_at DESC
    `, [parentId]);

    client.release();
    
    res.json({ students: result.rows });

  } catch (error) {
    console.error('Get linked students error:', error);
    res.status(500).json({ error: 'Failed to get linked students' });
  }
};

// NEW: Create parent invitation
const createParentInvitation = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { parentEmail, invitationCode } = req.body;

    const client = await pool.connect();

    // Create or update invitation record
    const result = await client.query(`
      INSERT INTO parent_student_links (student_id, invitation_code, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT (invitation_code) DO UPDATE
      SET student_id = $1
      RETURNING id
    `, [studentId, invitationCode.toUpperCase()]);

    client.release();

    // In a real app, you'd send an email here
    console.log(`📧 Would send invitation email to ${parentEmail} with code ${invitationCode}`);
    
    res.json({ 
      success: true, 
      message: 'Invitation created',
      invitationCode: invitationCode 
    });

  } catch (error) {
    console.error('Create invitation error:', error);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
};

// NEW: Remove parent-student link
const unlinkParent = async (req, res) => {
  try {
    const studentId = req.user.id;
    const { parentId } = req.params;

    const client = await pool.connect();

    await client.query(`
      UPDATE parent_student_links 
      SET status = 'revoked'
      WHERE student_id = $1 AND parent_id = $2
    `, [studentId, parentId]);

    client.release();
    
    res.json({ success: true, message: 'Parent access removed' });

  } catch (error) {
    console.error('Unlink parent error:', error);
    res.status(500).json({ error: 'Failed to unlink parent' });
  }
};

// NEW: Get conversations for linked students (for parents)
const getStudentConversations = async (req, res) => {
  try {
    const parentId = req.user.id;
    const { studentId } = req.params;
    
    const client = await pool.connect();

    // Verify parent has access to this student
    const accessCheck = await client.query(`
      SELECT 1 FROM parent_student_links 
      WHERE parent_id = $1 AND student_id = $2 AND status = 'active'
    `, [parentId, studentId]);

    if (accessCheck.rows.length === 0) {
      client.release();
      return res.status(403).json({ error: 'No access to this student' });
    }

    // Get student's conversations (without actual messages for privacy)
    const result = await client.query(`
      SELECT id, subject, title, created_at, updated_at, detected_level, model_used
      FROM conversations 
      WHERE user_id = $1 
      ORDER BY updated_at DESC
    `, [studentId]);

    client.release();
    
    res.json({ conversations: result.rows });

  } catch (error) {
    console.error('Get student conversations error:', error);
    res.status(500).json({ error: 'Failed to get student conversations' });
  }
};

// Save conversation
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

// Get user conversations
const getUserConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const client = await pool.connect();

    try {
      const result = await client.query(
        `SELECT id, subject, title, created_at, updated_at 
         FROM conversations 
         WHERE user_id = $1 AND (is_archived = FALSE OR is_archived IS NULL)
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

// Get specific conversation
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

// Update conversation
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

// Logout user
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
  logoutUser,
  // NEW exports for parent-student linking
  getLinkedParents,
  getLinkedStudents,
  createParentInvitation,
  unlinkParent,
  getStudentConversations
};