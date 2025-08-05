// server.js - Updated with Authentication Integration
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

// Import authentication system
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
  logoutUser
} = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database on startup
initializeDatabase();

// Disable SSL verification for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    
    let extension = '.m4a';
    if (file.mimetype === 'audio/webm') {
      extension = '.webm';
    } else if (file.originalname && file.originalname.includes('.webm')) {
      extension = '.webm';
    }
    
    cb(null, 'audio-' + uniqueSuffix + extension);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'audio/m4a' || 
        file.mimetype === 'audio/mp4' || 
        file.mimetype === 'audio/x-m4a' ||
        file.mimetype === 'audio/webm' ||
        file.mimetype === 'audio/wav' ||
        file.originalname.toLowerCase().endsWith('.m4a') ||
        file.originalname.toLowerCase().endsWith('.webm') ||
        file.originalname.toLowerCase().endsWith('.wav')) {
      cb(null, true);
    } else {
      cb(new Error('Only M4A (mobile) and WebM (web) audio files are supported'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  httpAgent: new (require('https').Agent)({
    rejectUnauthorized: false
  })
});

// Initialize Claude
const initializeClaude = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('⚠️ Claude API key not found - Claude features will be disabled');
    return null;
  }
  
  try {
    const { Anthropic } = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    console.log('✅ Claude API initialized successfully');
    return anthropic;
  } catch (error) {
    console.log('⚠️ Anthropic SDK not installed - Claude features will be disabled');
    return null;
  }
};

const claude = initializeClaude();

// CORS configuration
const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:3000',
  'http://127.0.0.1:8081',
  'https://lilibet-mobile.vercel.app',
  'https://lilibet-mobile-git-main-jerry-condons-projects.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      console.log('❌ CORS blocked origin:', origin);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} from ${req.get('origin')}`);
  next();
});

// =================
// AUTHENTICATION ROUTES
// =================

// Register
app.post('/api/auth/register', registerUser);

// Login
app.post('/api/auth/login', loginUser);

// Get user profile (protected)
app.get('/api/auth/profile', authenticateToken, getUserProfile);

// Logout
app.post('/api/auth/logout', authenticateToken, logoutUser);

// =================
// CONVERSATION ROUTES (Protected)
// =================

// Save conversation
app.post('/api/conversations', authenticateToken, saveConversation);

// Get user's conversations
app.get('/api/conversations', authenticateToken, getUserConversations);

// Get specific conversation
app.get('/api/conversations/:id', authenticateToken, getConversation);

// Update conversation
app.put('/api/conversations/:id', authenticateToken, updateConversation);

// Delete conversation
app.delete('/api/conversations/:id', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const conversationId = req.params.id;

  db.run(
    'UPDATE conversations SET is_archived = 1 WHERE id = ? AND user_id = ?',
    [conversationId, userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete conversation' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      res.json({ message: 'Conversation deleted successfully' });
    }
  );
});

// =================
// EXISTING ROUTES (Enhanced with optional auth)
// =================

// Speech-to-text endpoint (enhanced with user tracking)
app.post('/api/speech-to-text', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Optional: Track usage if user is authenticated
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-key-change-in-production');
        userId = decoded.id;
      } catch (err) {
        // Not authenticated, but that's okay for this endpoint
      }
    }

    const audioPath = req.file.path;
    console.log(`🎤 Processing audio file: ${req.file.filename} ${userId ? `for user ${userId}` : '(anonymous)'}`);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
      language: 'en',
      response_format: 'text'
    });

    // Cleanup uploaded file
    fs.unlinkSync(audioPath);

    console.log(`📝 Transcription: "${transcription}"`);
    res.json({ 
      text: transcription,
      success: true,
      userId: userId // Include for client-side tracking
    });

  } catch (error) {
    console.error('❌ Speech-to-text error:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Could you try again?',
      success: false
    });
  }
});

// Enhanced tutor endpoint with conversation saving
app.post('/api/tutor', async (req, res) => {
  try {
    const { message, subject, conversationHistory = [], model = 'openai', saveToHistory = false } = req.body;

    if (!message || !subject) {
      return res.status(400).json({ error: 'Message and subject are required' });
    }

    // Check model availability
    if (model === 'claude' && !claude) {
      return res.status(400).json({ 
        error: 'Claude is not available',
        availableModels: ['openai']
      });
    }

    if (model === 'openai' && !process.env.OPENAI_API_KEY) {
      return res.status(400).json({ 
        error: 'OpenAI is not available',
        availableModels: claude ? ['claude'] : []
      });
    }

    // Detect intent and level (existing logic)
    const intent = detectIntent(message);
    const level = analyzeQuestionComplexity(message, subject);

    // Get system prompt (existing logic)
    let systemPrompt = getSystemPrompt(intent, subject, level);

    let response;

    if (model === 'claude') {
      const messages = [
        { role: 'user', content: `${systemPrompt}\n\nStudent question: ${message}` },
        ...conversationHistory.slice(-8).map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        }))
      ];

      const completion = await claude.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 200,
        temperature: 0.7,
        messages: messages
      });

      response = completion.content[0].text;
    } else {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-10),
        { role: 'user', content: message }
      ];

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        max_tokens: 200,
        temperature: 0.7,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      });

      response = completion.choices[0].message.content;
    }

    console.log(`[${new Date().toISOString()}] Model: ${model}, Subject: ${subject}, Intent: ${intent}, Level: ${level}`);

    // If user is authenticated and wants to save, auto-save the conversation
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && saveToHistory) {
      try {
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-key-change-in-production');
        userId = decoded.id;

        // Auto-save conversation with the new message and response
        const updatedHistory = [
          ...conversationHistory,
          { id: Date.now(), text: message, sender: 'user', timestamp: new Date().toISOString() },
          { id: Date.now() + 1, text: response, sender: 'tutor', timestamp: new Date().toISOString() }
        ];

        // Save asynchronously (don't wait for it)
        setTimeout(() => {
          const { saveConversation } = require('./auth');
          const mockReq = { user: { id: userId }, body: {
            subject,
            messages: updatedHistory,
            detectedLevel: level,
            modelUsed: model
          }};
          const mockRes = { json: () => {}, status: () => ({ json: () => {} }) };
          saveConversation(mockReq, mockRes);
        }, 100);

      } catch (err) {
        console.log('Token verification failed for auto-save:', err.message);
      }
    }

    res.json({ 
      response, 
      detectedLevel: level,
      detectedIntent: intent,
      modelUsed: model,
      userId: userId
    });

  } catch (error) {
    console.error('Error calling AI API:', error);
    res.status(500).json({ 
      error: 'Sorry, I\'m having trouble thinking right now. Could you try again?',
      details: error.message 
    });
  }
});

// =================
// EXISTING ENDPOINTS
// =================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Lilibet backend is running!',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    models: {
      openai: !!process.env.OPENAI_API_KEY,
      claude: !!claude
    },
    features: {
      authentication: true,
      conversationPersistence: true
    }
  });
});

// Model availability
app.get('/api/models', (req, res) => {
  const models = {
    openai: {
      available: !!process.env.OPENAI_API_KEY,
      name: 'OpenAI GPT-4o-mini',
      description: 'Advanced AI with broad knowledge'
    },
    claude: {
      available: !!claude,
      name: 'Anthropic Claude',
      description: 'Thoughtful AI excellent at reasoning'
    }
  };
  
  res.json({ models });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Lilibet Tutor API',
    version: '2.0.0', // Updated version with auth
    status: 'healthy',
    endpoints: {
      health: '/health',
      speechToText: '/api/speech-to-text',
      tutor: '/api/tutor',
      models: '/api/models',
      // New auth endpoints
      register: '/api/auth/register',
      login: '/api/auth/login',
      profile: '/api/auth/profile',
      conversations: '/api/conversations'
    },
    features: {
      openai: !!process.env.OPENAI_API_KEY,
      claude: !!claude,
      speechToText: true,
      adaptiveResponses: true,
      userAuthentication: true,
      conversationPersistence: true
    }
  });
});

// =================
// HELPER FUNCTIONS (from your existing code)
// =================

function detectIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  const conceptPatterns = [
    /^(what is|what are|can you describe|can you explain|tell me about|explain|describe)/,
    /^(how does|how do|why does|why do)/,
    /\b(what.*mean|define|definition)\b/,
    /\b(concept of|theory of|principle of)\b/,
    /^(i don't understand|i'm confused about)/
  ];
  
  if (conceptPatterns.some(pattern => pattern.test(lowerMessage))) {
    return 'concept_explanation';
  }
  
  if (/\b(homework|assignment|problem|exercise|question \d+|chapter \d+|page \d+)\b/.test(lowerMessage)) {
    return 'homework_help';
  }
  
  return 'general_tutoring';
}

function analyzeQuestionComplexity(message, subject) {
  const lowerMessage = message.toLowerCase();
  
  // Math complexity indicators
  if (subject === 'math') {
    if (/\b(add|subtract|plus|minus|count|simple|basic)\b/.test(lowerMessage) ||
        /^\d+[\s\+\-\*\/]\d+/.test(lowerMessage) ||
        lowerMessage.length < 30) {
      return 'elementary';
    }
    
    if (/\b(multiply|divide|fraction|decimal|percent)\b/.test(lowerMessage)) {
      return 'elementary-middle';
    }
    
    if (/\b(algebra|equation|solve for|variable)\b/.test(lowerMessage)) {
      return 'middle';
    }
    
    if (/\b(calculus|derivative|integral|function|polynomial)\b/.test(lowerMessage)) {
      return 'high';
    }
  }
  
  // Reading complexity indicators  
  if (subject === 'reading') {
    if (/\b(what happen|who is|story about|character|simple)\b/.test(lowerMessage) ||
        lowerMessage.length < 50) {
      return 'elementary';
    }
    
    if (/\b(theme|character development|metaphor|symbolism)\b/.test(lowerMessage)) {
      return 'middle';
    }
    
    if (/\b(literary device|allegory|irony|satire)\b/.test(lowerMessage)) {
      return 'high';
    }
  }
  
  return 'middle'; // Default
}

function getSystemPrompt(intent, subject, level) {
  // Your existing ADAPTIVE_SYSTEM_PROMPTS and INTENT_BASED_PROMPTS logic here
  // This is simplified for brevity - use your existing implementation
  return `You are Lilibet, a helpful British tutor. Adapt your response to be appropriate for ${level} level ${subject} tutoring using ${intent} approach.`;
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌟 Lilibet backend running on port ${PORT}`);
  console.log(`🎯 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`🤖 Claude API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`🔐 Authentication: ✅ Enabled`);
  console.log(`💾 Database: ✅ SQLite initialized`);
  console.log(`📱 Supports M4A (mobile) and WebM (web) audio formats`);
  console.log(`🌐 CORS configured for frontend URLs`);
  
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
});

module.exports = app;