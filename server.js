// server.js - Enhanced with Smart Learning Engine
// Integrates intelligent learning mode detection and AI model routing
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

// Import existing authentication system
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

// Import NEW learning engine
const {
  LEARNING_MODES,
  detectLearningMode,
  chooseOptimalModel,
  processLearningInteraction,
  analyzeLearningEffectiveness
} = require('./learningEngine');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database on startup
initializeDatabase();

// Configure CORS for production and development
const corsOptions = {
  origin: [
    'http://localhost:8081',
    'http://localhost:19006', 
    'https://lilibet-mobile.vercel.app',
    /\.vercel\.app$/,
    /\.railway\.app$/
  ],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize OpenAI
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Initialize Claude (optional)
let claude = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { Anthropic } = require('@anthropic-ai/sdk');
    claude = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    console.log('🤖 Claude initialized successfully');
  } catch (error) {
    console.log('📝 Claude not available, using OpenAI only');
  }
}

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
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// =================
// AUTHENTICATION ENDPOINTS
// =================

app.post('/api/auth/register', registerUser);
app.post('/api/auth/login', loginUser);
app.get('/api/auth/profile', authenticateToken, getUserProfile);
app.post('/api/auth/logout', authenticateToken, logoutUser);

// =================
// CONVERSATION ENDPOINTS
// =================

app.get('/api/conversations', authenticateToken, getUserConversations);
app.get('/api/conversations/:id', authenticateToken, getConversation);
app.put('/api/conversations/:id', authenticateToken, updateConversation);

// =================
// ENHANCED LEARNING ENGINE ENDPOINTS
// =================

// Main tutoring endpoint with smart learning engine
app.post('/api/tutor', authenticateToken, async (req, res) => {
  try {
    const { 
      message, 
      subject = 'general', 
      conversationId = null,
      forceLearningMode = null // Optional: force specific learning mode
    } = req.body;
    
    const userId = req.user.id;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`🎓 Learning request from user ${userId}: "${message.substring(0, 50)}..."`);
    console.log(`🔧 Debug - OpenAI available: ${!!openai}, Claude available: ${!!claude}`);

    // Get user profile for age-appropriate responses
    let ageGroup = 'middle';
    try {
      // Create a mock response object that matches what getUserProfile expects
      const mockRes = {
        json: (data) => data,
        status: (code) => ({ json: (data) => data })
      };
      const userProfile = await getUserProfile(req, mockRes, () => {});
      ageGroup = userProfile?.user?.ageGroup || 'middle';
    } catch (error) {
      console.log('📝 Using default age group (middle) due to profile error');
      ageGroup = 'middle';
    }

    // Get conversation history if continuing existing conversation
    let conversationHistory = [];
    if (conversationId) {
      try {
        // Create mock response for getConversation
        const mockRes = {
          json: (data) => data,
          status: (code) => ({ json: (data) => data })
        };
        const conversation = await getConversation(
          { params: { id: conversationId }, user: req.user }, 
          mockRes, 
          () => {}
        );
        conversationHistory = conversation?.messages || [];
      } catch (error) {
        console.log('📝 Starting new conversation (could not load existing)');
      }
    }

    // Optional: Get parental settings (if implemented)
    let parentalSettings = null;
    // TODO: Implement parental settings retrieval
    // parentalSettings = await getParentalSettings(userId);

    // Process through smart learning engine
    console.log(`🔧 Passing to learning engine - OpenAI: ${!!openai}, Claude: ${!!claude}`);
    
    const learningResult = await processLearningInteraction(message, {
      subject,
      ageGroup,
      conversationHistory,
      parentalSettings,
      forceLearningMode,
      openaiClient: openai,  // Pass the clients to avoid circular dependency
      claudeClient: claude
    });

    const response = learningResult.response;
    const metadata = learningResult.metadata;

    console.log(`🤖 Learning response generated using ${metadata.modelUsed} in ${metadata.learningMode} mode`);

    // Save conversation with enhanced metadata
    try {
      const newMessages = [
        ...conversationHistory,
        { role: 'user', content: message, timestamp: new Date().toISOString() },
        { 
          role: 'assistant', 
          content: response, 
          timestamp: new Date().toISOString(),
          metadata: metadata // Store learning metadata
        }
      ];

      let saveResult;
      if (conversationId) {
        // Update existing conversation - create proper mock response
        const mockRes = {
          json: (data) => {
            console.log('💾 Conversation updated successfully');
            return data;
          },
          status: (code) => ({ 
            json: (data) => {
              console.log('💾 Conversation update response:', data);
              return data;
            }
          })
        };
        
        await updateConversation(
          { 
            params: { id: conversationId }, 
            body: { messages: newMessages }, 
            user: req.user 
          },
          mockRes,
          () => {}
        );
      } else {
        // Create new conversation - create proper mock response  
        const mockRes = {
          json: (data) => {
            console.log('💾 New conversation created successfully');
            return data;
          },
          status: (code) => ({ 
            json: (data) => {
              console.log('💾 New conversation response:', data);
              return data;
            }
          })
        };
        
        await saveConversation(
          {
            body: {
              subject,
              messages: newMessages,
              title: `${subject} - ${new Date().toLocaleDateString()}`
            },
            user: req.user
          },
          mockRes,
          () => {}
        );
      }

      console.log('💾 Enhanced conversation saved with learning metadata');
    } catch (saveError) {
      console.error('💾 Error saving conversation:', saveError);
      // Continue even if save fails
    }

    // Analyze learning effectiveness
    const learningAnalysis = analyzeLearningEffectiveness([
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    ]);

    // Send enhanced response
    res.json({
      response,
      metadata: {
        ...metadata,
        learningAnalysis,
        conversationId: conversationId || 'new',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('🚨 Learning engine error:', error);
    
    // Fallback to basic response
    res.status(500).json({
      error: 'Something went wrong with the learning engine',
      response: "I'm having some technical difficulties, but I'm still here to help you learn! Could you try asking your question again?",
      metadata: {
        learningMode: 'fallback',
        modelUsed: 'none',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Learning mode detection endpoint
app.post('/api/learning/detect-mode', authenticateToken, async (req, res) => {
  try {
    const { message, conversationHistory = [], ageGroup = 'middle' } = req.body;
    
    const availableModels = {
      openai: !!openai,
      claude: !!claude
    };
    
    const detectedMode = detectLearningMode(message, conversationHistory, ageGroup);
    const optimalModel = chooseOptimalModel(detectedMode, availableModels);
    
    res.json({
      detectedMode,
      optimalModel,
      availableModels,
      availableModes: Object.values(LEARNING_MODES),
      recommendation: `Best approach: ${detectedMode} mode using ${optimalModel}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to detect learning mode' });
  }
});

// Learning analytics endpoint
app.get('/api/learning/analytics/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Get conversation
    const conversation = await getConversation(
      { params: { id: conversationId }, user: req.user },
      { json: (data) => data },
      () => {}
    );
    
    if (!conversation?.messages) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Analyze learning effectiveness
    const analysis = analyzeLearningEffectiveness(conversation.messages);
    
    // Extract learning modes used
    const modesUsed = conversation.messages
      .filter(msg => msg.role === 'assistant' && msg.metadata?.learningMode)
      .map(msg => msg.metadata.learningMode);
    
    const modeStats = modesUsed.reduce((acc, mode) => {
      acc[mode] = (acc[mode] || 0) + 1;
      return acc;
    }, {});
    
    res.json({
      conversationId,
      learningAnalysis: analysis,
      modesUsed: modeStats,
      totalInteractions: conversation.messages.filter(msg => msg.role === 'user').length,
      subject: conversation.subject,
      createdAt: conversation.created_at
    });
    
  } catch (error) {
    console.error('Learning analytics error:', error);
    res.status(500).json({ error: 'Failed to generate learning analytics' });
  }
});

// =================
// EXISTING ENDPOINTS (unchanged)
// =================

// Speech to text endpoint
app.post('/api/speech-to-text', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!openai) {
      return res.status(503).json({ error: 'OpenAI not configured' });
    }

    console.log(`🎤 Processing audio file: ${req.file.filename}`);
    
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: 'whisper-1',
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    console.log(`🎯 Transcribed: "${transcription.text}"`);
    res.json({ transcription: transcription.text });

  } catch (error) {
    console.error('🎤 Speech-to-text error:', error);
    
    // Clean up file if error occurred
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Speech recognition failed. Could you try again?',
      details: error.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Lilibet Enhanced Learning Engine is running!',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    models: {
      openai: !!process.env.OPENAI_API_KEY,
      claude: !!claude
    },
    features: {
      authentication: true,
      conversationPersistence: true,
      smartLearningEngine: true,
      learningModeDetection: true,
      intelligentModelRouting: true,
      learningAnalytics: true
    }
  });
});

// Model availability
app.get('/api/models', (req, res) => {
  const models = {
    openai: {
      available: !!process.env.OPENAI_API_KEY,
      name: 'OpenAI GPT-5-mini',
      description: 'Latest advanced AI optimized for educational tasks with improved reasoning',
      bestFor: ['practice', 'challenge', 'review']
    },
    claude: {
      available: !!claude,
      name: 'Anthropic Claude 3.5 Haiku',
      description: 'Thoughtful AI excellent at reasoning and Socratic questioning',
      bestFor: ['discovery', 'explanation']
    }
  };
  
  res.json({ 
    models,
    learningModes: Object.values(LEARNING_MODES),
    smartRouting: true
  });
});

// Learning modes info endpoint
app.get('/api/learning/modes', (req, res) => {
  res.json({
    modes: {
      [LEARNING_MODES.DISCOVERY]: {
        name: 'Discovery Learning',
        description: 'Socratic questioning to guide discovery',
        bestModel: 'claude',
        icon: '🔍',
        example: 'Asking "Why do you think that happens?" to explore concepts'
      },
      [LEARNING_MODES.PRACTICE]: {
        name: 'Practice Mode',
        description: 'Step-by-step skill building and drills',
        bestModel: 'openai',
        icon: '💪',
        example: 'Breaking down math problems into manageable steps'
      },
      [LEARNING_MODES.EXPLANATION]: {
        name: 'Explanation Mode',
        description: 'Clear explanations with examples and analogies',
        bestModel: 'claude',
        icon: '💡',
        example: 'Explaining photosynthesis using familiar analogies'
      },
      [LEARNING_MODES.CHALLENGE]: {
        name: 'Challenge Mode',
        description: 'Problem-solving and application of knowledge',
        bestModel: 'openai',
        icon: '🎯',
        example: 'Guiding through complex word problems'
      },
      [LEARNING_MODES.REVIEW]: {
        name: 'Review Mode',
        description: 'Knowledge checking and reinforcement',
        bestModel: 'openai',
        icon: '📋',
        example: 'Quick quiz questions to check understanding'
      }
    },
    autoDetection: true,
    manualOverride: true
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Lilibet Enhanced Learning Engine',
    version: '2.1.0',
    status: 'healthy',
    description: 'AI tutor with intelligent learning mode detection and optimal model routing',
    endpoints: {
      health: '/health',
      speechToText: '/api/speech-to-text',
      tutor: '/api/tutor',
      models: '/api/models',
      learningModes: '/api/learning/modes',
      detectMode: '/api/learning/detect-mode',
      analytics: '/api/learning/analytics/:conversationId',
      register: '/api/auth/register',
      login: '/api/auth/login',
      profile: '/api/auth/profile',
      conversations: '/api/conversations'
    },
    features: {
      openai: !!process.env.OPENAI_API_KEY,
      claude: !!claude,
      speechToText: true,
      smartLearningEngine: true,
      learningModeDetection: true,
      intelligentModelRouting: true,
      learningAnalytics: true,
      userAuthentication: true,
      conversationPersistence: true
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌟 Lilibet Enhanced Learning Engine running on port ${PORT}`);
  console.log(`🎯 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`🤖 Claude API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`🔐 Authentication: ✅ Enabled`);
  console.log(`💾 Database: ✅ PostgreSQL initialized`);
  console.log(`🧠 Smart Learning Engine: ✅ Active`);
  console.log(`🎯 Learning Mode Detection: ✅ Active`);
  console.log(`🔀 Intelligent Model Routing: ✅ Active`);
  console.log(`📊 Learning Analytics: ✅ Active`);
  console.log(`📱 Supports M4A (mobile) and WebM (web) audio formats`);
  console.log(`🌐 CORS configured for frontend URLs`);
  
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
});

module.exports = app;