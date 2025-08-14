// server.js - Lilibet Backend with Smart Learning Engine (Fixed)
const express = require('express');
const cors = require('cors');
const { 
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
  getLinkedMentors,
  getLinkedLearners,
  createMentorInvitation,
  unlinkMentor,
  getLearnerConversations,
  pool
} = require('./auth');
const { 
  processLearningInteraction, 
  checkAPIStatus,
  detectLearningMode 
} = require('./learningEngine');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// FIXED: CORS configuration - strict in production
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8081',
      'http://localhost:19006',
      'https://lilibet-mobile.vercel.app',
      'https://lilibet-tutor.vercel.app',
      'exp://192.168.86.58:8081',
      /^exp:\/\/\d+\.\d+\.\d+\.\d+:\d+$/,
      /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/
    ];
    
    // In production, strictly enforce CORS
    if (process.env.NODE_ENV === 'production') {
      if (!origin || allowedOrigins.some(allowed => 
        allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
      )) {
        callback(null, true);
      } else {
        console.log('⚠️ CORS blocked origin in production:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // In development, be more permissive
      if (!origin || allowedOrigins.some(allowed => 
        allowed instanceof RegExp ? allowed.test(origin) : allowed === origin
      )) {
        callback(null, true);
      } else {
        console.log('⚠️ CORS warning - unknown origin in dev:', origin);
        callback(null, true); // Allow in development only
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Rate limiting middleware (basic implementation)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 100; // max requests per minute

const rateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  const ipData = requestCounts.get(ip);
  
  if (now > ipData.resetTime) {
    ipData.count = 1;
    ipData.resetTime = now + RATE_LIMIT_WINDOW;
    return next();
  }
  
  if (ipData.count >= MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  
  ipData.count++;
  next();
};

// Apply rate limiting to auth endpoints
app.use('/api/auth/register', rateLimiter);
app.use('/api/auth/login', rateLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  const apiStatus = checkAPIStatus();
  res.json({ 
    status: 'healthy',
    apis: apiStatus,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🌟 Lilibet Enhanced Learning Engine API',
    version: '2.1.0',
    endpoints: {
      health: '/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile',
        logout: 'POST /api/auth/logout'
      },
      tutor: 'POST /api/tutor',
      conversations: {
        list: 'GET /api/conversations',
        save: 'POST /api/conversations',
        get: 'GET /api/conversations/:id',
        update: 'PUT /api/conversations/:id'
      }
    }
  });
});

// Authentication routes
app.post('/api/auth/register', registerUser);
app.post('/api/auth/login', loginUser);
app.get('/api/auth/profile', authenticateToken, getUserProfile);
app.post('/api/auth/logout', authenticateToken, logoutUser);

// Conversation routes
app.get('/api/conversations', authenticateToken, getUserConversations);
app.post('/api/conversations', authenticateToken, saveConversation);
app.get('/api/conversations/:id', authenticateToken, getConversation);
app.put('/api/conversations/:id', authenticateToken, updateConversation);

// Mentor-Learner Linking routes
app.get('/api/mentors/linked', authenticateToken, getLinkedMentors);
app.get('/api/learners/linked', authenticateToken, getLinkedLearners);
app.post('/api/mentors/invite', authenticateToken, createMentorInvitation);
app.delete('/api/mentors/unlink/:mentorId', authenticateToken, unlinkMentor);
app.get('/api/learners/:learnerId/conversations', authenticateToken, getLearnerConversations);

// FIXED: Main tutoring endpoint with proper conversation saving
app.post('/api/tutor', authenticateToken, async (req, res) => {
  try {
    const { message, subject = 'General', skillLevel = 'intermediate' } = req.body;
    const userId = req.user.id;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`🎓 Learning request from user ${userId}: "${message.substring(0, 50)}..."`);

    // Check API availability
    const apiStatus = checkAPIStatus();
    console.log(`🔧 Debug - OpenAI available: ${apiStatus.openai}, Claude available: ${apiStatus.claude}`);

    if (!apiStatus.ready) {
      console.error('❌ No AI APIs configured');
      return res.status(503).json({ 
        error: 'AI service temporarily unavailable. Please check API configuration.' 
      });
    }

    // Process through learning engine
    console.log(`🔧 Passing to learning engine - OpenAI: ${apiStatus.openai}, Claude: ${apiStatus.claude}`);
    
    const learningResult = await processLearningInteraction(
      message, 
      subject, 
      skillLevel,
      apiStatus.openai,
      apiStatus.claude
    );

    // Create conversation messages array
    const messages = [
      {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      },
      {
        role: 'assistant',
        content: learningResult.response,
        timestamp: new Date().toISOString(),
        metadata: learningResult.metadata
      }
    ];

    // FIXED: Actually save the conversation to database
    try {
      const client = await pool.connect();
      
      const saveResult = await client.query(`
        INSERT INTO conversations (
          user_id, subject, title, messages, detected_level, model_used, learning_mode
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, created_at
      `, [
        userId,
        subject,
        `${subject} - ${new Date().toLocaleDateString()}`,
        JSON.stringify(messages),
        skillLevel,
        learningResult.metadata.model,
        learningResult.metadata.mode
      ]);
      
      client.release();
      
      console.log(`💾 Conversation saved with ID: ${saveResult.rows[0].id}`);
      
      // Send response with conversation ID
      res.json({
        response: learningResult.response,
        metadata: learningResult.metadata,
        conversationId: saveResult.rows[0].id
      });
      
    } catch (saveError) {
      console.error('⚠️ Could not save conversation:', saveError.message);
      // Don't fail the request, still return the response
      res.json({
        response: learningResult.response,
        metadata: learningResult.metadata,
        warning: 'Conversation was not saved'
      });
    }

  } catch (error) {
    console.error('🚨 Tutor endpoint error:', error);
    res.status(500).json({ 
      error: 'An error occurred while processing your request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🚨 Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize database and start server
const startServer = async () => {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`🌟 Lilibet Enhanced Learning Engine running on port ${PORT}`);
      console.log(`🎯 Environment: ${process.env.NODE_ENV || 'development'}`);
      
      const apiStatus = checkAPIStatus();
      console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set'}`);
      console.log(`🤖 Claude API Key: ${process.env.CLAUDE_API_KEY ? '✅ Set' : '❌ Not set'}`);
      console.log(`🔐 JWT Secret: ${process.env.JWT_SECRET ? '✅ Set' : '⚠️ Using dev default'}`);
      console.log(`🔒 Authentication: ✅ Enabled with rate limiting`);
      console.log(`💾 Database: ✅ PostgreSQL initialized`);
      console.log(`🧠 Smart Learning Engine: ${apiStatus.ready ? '✅ Active' : '⚠️ Limited'}`);
      console.log(`🎯 Learning Mode Detection: ✅ Active`);
      console.log(`🔀 Intelligent Model Routing: ${apiStatus.ready ? '✅ Active' : '⚠️ Limited'}`);
      console.log(`📊 Learning Analytics: ✅ Active`);
      console.log(`🌐 CORS: ${process.env.NODE_ENV === 'production' ? '🔒 Strict mode' : '🔓 Dev mode'}`);
      console.log(`⚡ Rate Limiting: ✅ Active (${MAX_REQUESTS} req/min)`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM signal received: closing HTTP server');
  app.close(() => {
    console.log('🛑 HTTP server closed');
    pool.end(() => {
      console.log('💾 Database pool closed');
      process.exit(0);
    });
  });
});

// Start the server
startServer();