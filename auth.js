// auth.js - Complete Authentication with Mentor-Learner Linking (Fixed)
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

/**
 * Database initialization
 * Tables:
 *  - users
 *  - conversations
 *  - user_sessions
 *  - mentor_learner_links
 */
const initializeDatabase = async () => {
  try {
    const client = await pool.connect();

    // USERS
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          display_name VARCHAR(255),
          skill_level VARCHAR(50) DEFAULT 'intermediate',
          preferred_subjects TEXT DEFAULT '[]',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Basic users table ready');

      // Add app-specific columns if not present
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS username VARCHAR(50),
        ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'learner',
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS last_login TIMESTAMP
      `);
      console.log('✅ Enhanced users table (username/user_type/is_active/last_login)');

      // Remove legacy mentor_id column if it exists
      try {
        await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS mentor_id`);
        console.log('✅ Removed legacy mentor_id column');
      } catch (e) {
        // Column might not exist, that's fine
      }

      // Unique username
      try {
        await client.query(`
          ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username)
        `);
      } catch (constraintError) {
        if (!String(constraintError?.message || '').includes('already exists')) {
          console.log('⚠️ Username constraint issue:', constraintError.message);
        }
      }
    } catch (userTableError) {
      console.error('Error with users table:', userTableError);
    }

    // CONVERSATIONS
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        subject VARCHAR(100) NOT NULL,
        title VARCHAR(255),
        messages TEXT NOT NULL DEFAULT '[]',
        detected_level VARCHAR(50),
        model_used VARCHAR(50) DEFAULT 'openai',
        learning_mode VARCHAR(50),
        is_archived BOOLEAN DEFAULT FALSE,
        tags TEXT DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Conversations table ready');

    // SESSIONS
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
    console.log('✅ Sessions table ready');

    // MENTOR-LEARNER LINKING
    await client.query(`
      CREATE TABLE IF NOT EXISTS mentor_learner_links (
        id SERIAL PRIMARY KEY,
        mentor_id INTEGER REFERENCES users(id),
        learner_id INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        invitation_code VARCHAR(10) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP,
        UNIQUE(mentor_id, learner_id)
      )
    `);
    console.log('✅ Mentor-Learner linking table ready');

    // Indexes
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_links_mentor ON mentor_learner_links(mentor_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_links_learner ON mentor_learner_links(learner_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_links_code ON mentor_learner_links(invitation_code)`);
      console.log('✅ Database indexes created successfully');
    } catch (indexError) {
      console.log('⚠️ Some indexes may already exist, continuing...');
    }

    client.release();
    console.log('🎉 Database initialized successfully with mentor-learner linking!');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    console.log('⚠️ Database initialization had issues but app will continue');
  }
};

// FIXED: JWT secret - require in production
const getJWTSecret = () => {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET must be set in production environment');
    process.exit(1);
  }
  return process.env.JWT_SECRET || 'lilibet-dev-secret-only';
};

const JWT_SECRET = getJWTSecret();

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('🔐 Invalid token attempt');
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Token generator
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      username: user.username,
      displayName: user.display_name || user.displayName,
      userType: user.user_type,
      skillLevel: user.skill_level
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Helpers
const hashPassword = async (password) => {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidUsername = (u) => /^[a-zA-Z0-9_]{3,20}$/.test(u);

// FIXED: Register user without logging sensitive data
const registerUser = async (req, res) => {
  try {
    console.log('📝 Registration attempt started');
    // FIXED: Don't log the entire request body with password!
    console.log('📦 Registration for email:', req.body.email);
    
    const { 
      email, 
      username, 
      password, 
      displayName, 
      userType = 'learner',
      skillLevel = 'intermediate',
      mentorInviteCode
    } = req.body;

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
      // Email uniqueness
      const existingEmail = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      if (existingEmail.rows.length > 0) {
        console.log('❌ Email already exists:', email);
        client.release();
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Username uniqueness
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
      
      const finalSkillLevel = userType === 'mentor' ? 'expert' : (skillLevel || 'intermediate');
      
      console.log('📝 Creating user with:', {
        email,
        username: username || null,
        displayName: displayName || email.split('@')[0],
        userType,
        skillLevel: finalSkillLevel
      });
      
      const result = await client.query(`
        INSERT INTO users (email, username, password_hash, display_name, user_type, skill_level) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING id, email, username, display_name, user_type, skill_level
      `, [
        email.toLowerCase(),
        username ? username.toLowerCase() : null,
        passwordHash, 
        displayName || email.split('@')[0], 
        userType,
        finalSkillLevel
      ]);

      const newUser = result.rows[0];

      // If mentor registering with invite code, link to learner
      if (userType === 'mentor' && mentorInviteCode) {
        console.log('🔗 Linking mentor to learner with code:', mentorInviteCode);
        
        const linkResult = await client.query(`
          UPDATE mentor_learner_links 
          SET mentor_id = $1, status = 'active', accepted_at = CURRENT_TIMESTAMP
          WHERE invitation_code = $2 AND mentor_id IS NULL
          RETURNING learner_id
        `, [newUser.id, mentorInviteCode.toUpperCase()]);

        if (linkResult.rows.length > 0) {
          console.log('✅ Successfully linked to learner:', linkResult.rows[0].learner_id);
        } else {
          console.log('⚠️ Invalid or already used invitation code');
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
        message: userType === 'mentor' ? 'New mentor registered' : 'New learner registered',
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          displayName: newUser.display_name,
          userType: newUser.user_type,
          skillLevel: newUser.skill_level
        }
      });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Registration database error:', dbErr);
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  } catch (error) {
    console.error('🚨 Registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

// Login (email or username)
const loginUser = async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    const client = await pool.connect();
    try {
      const u = emailOrUsername.trim();
      const isEmail = u.includes('@');

      const query = isEmail
        ? 'SELECT * FROM users WHERE LOWER(email) = LOWER($1)'
        : 'SELECT * FROM users WHERE LOWER(username) = LOWER($1)';

      const result = await client.query(query, [u.toLowerCase()]);
      if (result.rows.length === 0) {
        client.release();
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = result.rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        client.release();
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last_login
      await client.query(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);

      const token = generateToken(user);

      // Optional: persist session token hash
      const tokenHash = await hashPassword(token);
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days

      await client.query(`
        INSERT INTO user_sessions (user_id, token_hash, device_info, ip_address, expires_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        user.id,
        tokenHash,
        req.headers['user-agent'] || null,
        req.ip || null,
        expiresAt
      ]);

      client.release();

      console.log(`✅ ${user.user_type === 'mentor' ? 'Mentor' : 'Learner'} logged in: ${user.email}`);
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          userType: user.user_type,
          skillLevel: user.skill_level
        }
      });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Login database error:', dbErr);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  } catch (error) {
    console.error('🚨 Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT id, email, username, display_name, user_type, skill_level, 
               preferred_subjects, created_at, last_login
        FROM users 
        WHERE id = $1
      `, [req.user.id]);

      client.release();

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ user: result.rows[0] });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Get profile error:', dbErr);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  } catch (e) {
    console.error('🚨 Get profile error:', e);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

// FIXED: Actually save conversation
const saveConversation = async (req, res) => {
  try {
    const { subject, title, messages, detected_level, model_used, learning_mode, tags } = req.body;

    if (!subject || !messages) {
      return res.status(400).json({ error: 'Subject and messages are required' });
    }

    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO conversations (
          user_id, subject, title, messages, detected_level, model_used, learning_mode, tags
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, created_at
      `, [
        req.user.id,
        subject,
        title || `${subject} - ${new Date().toLocaleDateString()}`,
        typeof messages === 'string' ? messages : JSON.stringify(messages),
        detected_level || null,
        model_used || 'openai',
        learning_mode || null,
        JSON.stringify(tags || [])
      ]);
      
      client.release();
      res.status(201).json({ 
        id: result.rows[0].id, 
        createdAt: result.rows[0].created_at,
        message: 'Conversation saved successfully'
      });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Save conversation error:', dbErr);
      res.status(500).json({ error: 'Failed to save conversation' });
    }
  } catch (e) {
    console.error('🚨 Save conversation error:', e);
    res.status(500).json({ error: 'Failed to save conversation' });
  }
};

// List user's own conversations
const getUserConversations = async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT id, subject, title, detected_level, model_used, learning_mode, 
               is_archived, tags, created_at, updated_at
        FROM conversations
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [req.user.id]);
      client.release();
      res.json({ conversations: result.rows });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Get conversations error:', dbErr);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  } catch (e) {
    console.error('🚨 Get conversations error:', e);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
};

// Get single conversation (owner or linked mentor)
const getConversation = async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    if (Number.isNaN(conversationId)) return res.status(400).json({ error: 'Invalid conversation id' });

    const client = await pool.connect();
    try {
      const convRes = await client.query(`SELECT * FROM conversations WHERE id = $1`, [conversationId]);
      if (convRes.rows.length === 0) {
        client.release();
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const convo = convRes.rows[0];

      // Owner
      if (convo.user_id === req.user.id) {
        client.release();
        return res.json({ conversation: convo });
      }

      // If requester is a mentor, they must be linked to the learner who owns this conversation
      if (req.user.userType === 'mentor') {
        const linkRes = await client.query(`
          SELECT 1
          FROM mentor_learner_links
          WHERE mentor_id = $1 AND learner_id = $2 AND status = 'active'
        `, [req.user.id, convo.user_id]);

        client.release();

        if (linkRes.rows.length === 0) {
          return res.status(403).json({ error: 'No access to this learner' });
        }
        return res.json({ conversation: convo });
      }

      client.release();
      return res.status(403).json({ error: 'Access denied' });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Get conversation error:', dbErr);
      res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  } catch (e) {
    console.error('🚨 Get conversation error:', e);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
};

// Update conversation (owner only)
const updateConversation = async (req, res) => {
  try {
    const conversationId = parseInt(req.params.id, 10);
    if (Number.isNaN(conversationId)) return res.status(400).json({ error: 'Invalid conversation id' });

    const { title, messages, is_archived, tags } = req.body;

    const client = await pool.connect();
    try {
      const ownerRes = await client.query(`SELECT user_id FROM conversations WHERE id = $1`, [conversationId]);
      if (ownerRes.rows.length === 0) {
        client.release();
        return res.status(404).json({ error: 'Conversation not found' });
      }
      if (ownerRes.rows[0].user_id !== req.user.id) {
        client.release();
        return res.status(403).json({ error: 'Access denied' });
      }

      const fields = [];
      const vals = [];
      let idx = 1;

      if (typeof title === 'string') { fields.push(`title = $${idx++}`); vals.push(title); }
      if (typeof messages !== 'undefined') { 
        fields.push(`messages = $${idx++}`); 
        vals.push(typeof messages === 'string' ? messages : JSON.stringify(messages)); 
      }
      if (typeof is_archived === 'boolean') { fields.push(`is_archived = $${idx++}`); vals.push(is_archived); }
      if (typeof tags !== 'undefined') { fields.push(`tags = $${idx++}`); vals.push(JSON.stringify(tags)); }

      if (fields.length === 0) {
        client.release();
        return res.status(400).json({ error: 'No changes provided' });
      }

      vals.push(conversationId);
      await client.query(`
        UPDATE conversations
        SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${idx}
      `, vals);

      client.release();
      res.json({ message: 'Conversation updated' });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Update conversation error:', dbErr);
      res.status(500).json({ error: 'Failed to update conversation' });
    }
  } catch (e) {
    console.error('🚨 Update conversation error:', e);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
};

// Logout (invalidate current token by recording a "used" hash—best effort)
const logoutUser = async (req, res) => {
  try {
    // Best-effort: no server-side token blacklist here (JWT stateless).
    // If you maintain sessions, you could mark session expired here.
    res.json({ message: 'Logged out successfully' });
  } catch (e) {
    console.error('🚨 Logout error:', e);
    res.status(500).json({ error: 'Failed to logout' });
  }
};

/**
 * Mentor/Learner utilities
 */

// Get linked mentors for a learner
const getLinkedMentors = async (req, res) => {
  try {
    const learnerId = req.user.id;

    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT u.id, u.email, u.username, u.display_name, u.user_type, u.skill_level
        FROM mentor_learner_links mll
        JOIN users u ON u.id = mll.mentor_id
        WHERE mll.learner_id = $1 AND mll.status = 'active'
        ORDER BY u.display_name ASC NULLS LAST, u.email ASC
      `, [learnerId]);

      client.release();
      res.json({ mentors: result.rows });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Failed to get linked mentors:', dbErr);
      res.status(500).json({ error: 'Failed to get linked mentors' });
    }
  } catch (e) {
    console.error('🚨 Failed to get linked mentors:', e);
    res.status(500).json({ error: 'Failed to get linked mentors' });
  }
};

// Get linked learners for a mentor
const getLinkedLearners = async (req, res) => {
  try {
    const mentorId = req.user.id;

    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT u.id, u.email, u.username, u.display_name, u.user_type, u.skill_level
        FROM mentor_learner_links mll
        JOIN users u ON u.id = mll.learner_id
        WHERE mll.mentor_id = $1 AND mll.status = 'active'
        ORDER BY u.display_name ASC NULLS LAST, u.email ASC
      `, [mentorId]);

      client.release();
      res.json({ learners: result.rows });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Failed to get linked learners:', dbErr);
      res.status(500).json({ error: 'Failed to get linked learners' });
    }
  } catch (e) {
    console.error('🚨 Failed to get linked learners:', e);
    res.status(500).json({ error: 'Failed to get linked learners' });
  }
};

// Utility to generate short uppercase codes
const genCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// Create mentor invitation (learner creates a code to share with a mentor)
const createMentorInvitation = async (req, res) => {
  try {
    // Only learners should be allowed to create an invite code that mentors can redeem
    if (req.user.userType !== 'learner') {
      return res.status(403).json({ error: 'Only learners can create mentor invitations' });
    }

    const learnerId = req.user.id;
    const code = genCode();

    const client = await pool.connect();
    try {
      // Insert a pending link with code
      const result = await client.query(`
        INSERT INTO mentor_learner_links (mentor_id, learner_id, status, invitation_code)
        VALUES (NULL, $1, 'pending', $2)
        RETURNING id, invitation_code, created_at
      `, [learnerId, code]);

      client.release();
      res.status(201).json({
        invitationCode: result.rows[0].invitation_code,
        createdAt: result.rows[0].created_at
      });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Create mentor invitation error:', dbErr);
      res.status(500).json({ error: 'Failed to create mentor invitation' });
    }
  } catch (e) {
    console.error('🚨 Create mentor invitation error:', e);
    res.status(500).json({ error: 'Failed to create mentor invitation' });
  }
};

// Remove mentor-learner link
const unlinkMentor = async (req, res) => {
  try {
    const requestedMentorId = parseInt(req.params.mentorId, 10);
    if (Number.isNaN(requestedMentorId)) {
      return res.status(400).json({ error: 'Invalid mentor id' });
    }

    // Typically, learners call this endpoint to remove a mentor
    const learnerId = req.user.id;

    const client = await pool.connect();
    try {
      const del = await client.query(`
        DELETE FROM mentor_learner_links
        WHERE learner_id = $1 AND mentor_id = $2
        RETURNING id
      `, [learnerId, requestedMentorId]);

      client.release();

      if (del.rows.length === 0) {
        return res.status(404).json({ error: 'Link not found or already removed' });
      }

      res.json({ message: 'Successfully unlinked mentor' });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Failed to unlink mentor:', dbErr);
      res.status(500).json({ error: 'Failed to unlink mentor' });
    }
  } catch (e) {
    console.error('🚨 Failed to unlink mentor:', e);
    res.status(500).json({ error: 'Failed to unlink mentor' });
  }
};

// Get conversations for linked learners (for mentors)
const getLearnerConversations = async (req, res) => {
  try {
    if (req.user.userType !== 'mentor') {
      return res.status(403).json({ error: 'Only mentors can view learner conversations' });
    }

    const mentorId = req.user.id;
    const learnerId = parseInt(req.params.learnerId, 10);
    if (Number.isNaN(learnerId)) return res.status(400).json({ error: 'Invalid learner id' });

    const client = await pool.connect();
    try {
      // Check link
      const linkRes = await client.query(`
        SELECT 1
        FROM mentor_learner_links
        WHERE mentor_id = $1 AND learner_id = $2 AND status = 'active'
      `, [mentorId, learnerId]);

      if (linkRes.rows.length === 0) {
        client.release();
        return res.status(403).json({ error: 'No access to this learner' });
      }

      // Fetch conversations
      const convos = await client.query(`
        SELECT id, subject, title, detected_level, model_used, learning_mode,
               is_archived, tags, created_at, updated_at
        FROM conversations
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [learnerId]);

      client.release();
      res.json({ conversations: convos.rows });
    } catch (dbErr) {
      client.release();
      console.error('🚨 Failed to get learner conversations:', dbErr);
      res.status(500).json({ error: 'Failed to get learner conversations' });
    }
  } catch (e) {
    console.error('🚨 Failed to get learner conversations:', e);
    res.status(500).json({ error: 'Failed to get learner conversations' });
  }
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
  // Updated exports for mentor-learner linking
  getLinkedMentors,
  getLinkedLearners,
  createMentorInvitation,
  unlinkMentor,
  getLearnerConversations,
  pool // Export pool for use in server.js
};