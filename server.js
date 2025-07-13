// Disable SSL verification for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// server.js - Production Ready with CORS Fixed
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Set up multer for file uploads - ACCEPT BOTH M4A AND WEBM FILES
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
    
    // Handle different file types from web and mobile
    let extension = '.m4a'; // default for mobile
    if (file.mimetype === 'audio/webm') {
      extension = '.webm'; // web recordings
    } else if (file.originalname && file.originalname.includes('.webm')) {
      extension = '.webm';
    }
    
    cb(null, 'audio-' + uniqueSuffix + extension);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    console.log('File upload attempt:', {
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size
    });
    
    // Accept both mobile (M4A) and web (WebM) formats
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
      console.error('Unsupported file type:', file.mimetype, file.originalname);
      cb(new Error('Only M4A (mobile) and WebM (web) audio files are supported'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  httpAgent: new (require('https').Agent)({
    rejectUnauthorized: false
  })
});

// FIXED: Enhanced CORS configuration with live frontend URL
const allowedOrigins = [
  'http://localhost:8081',     // Local Expo web
  'http://localhost:19006',    // Alternative Expo web port
  'http://localhost:3000',     // React development port
  'http://127.0.0.1:8081',     // Alternative localhost format
  'http://127.0.0.1:19006',
  'http://127.0.0.1:3000',
  // LIVE FRONTEND URLS
  'https://lilibet-mobile.vercel.app',                                    // Primary Vercel URL
  'https://lilibet-mobile-git-main-jerry-condons-projects.vercel.app',    // Git branch URL
  'https://lilibet-mobile-l004s9jml-jerry-condons-projects.vercel.app',   // Deployment URL
  // Dynamic frontend URL from environment
  process.env.FRONTEND_URL,
];

// Remove undefined values and duplicates
const cleanOrigins = [...new Set(allowedOrigins.filter(Boolean))];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (cleanOrigins.includes(origin)) {
      console.log('✅ CORS allowed for origin:', origin);
      callback(null, true);
    } else {
      console.log('❌ CORS blocked origin:', origin);
      console.log('🔍 Allowed origins:', cleanOrigins);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} from ${req.get('origin')}`);
  next();
});

// SMART: Intent detector - Teaching vs Tutoring vs Problem-Solving
function detectIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  // CONCEPT EXPLANATION REQUESTS (Teaching Mode) - Make these more specific
  const conceptPatterns = [
    /^(what is|what are|can you describe|can you explain|tell me about|explain|describe)/,
    /^(how does|how do|why does|why do)/,
    /\b(what.*mean|define|definition)\b/,
    /\b(concept of|theory of|principle of)\b/,
    /^(i don't understand|i'm confused about)/,
    /\b(describe.*to me|explain.*to me)\b/,
    /^(what exactly is|what specifically is)/
  ];
  
  if (conceptPatterns.some(pattern => pattern.test(lowerMessage))) {
    console.log(`🎯 CONCEPT EXPLANATION detected: "${lowerMessage}"`);
    return 'concept_explanation';
  }
  
  // HOMEWORK/PROBLEM SOLVING (Tutoring Mode - Socratic)
  const homeworkPatterns = [
    /\b(homework|assignment|teacher|class|school)\b/,
    /\b(help me (solve|with|figure out))/,
    /\b(i'm stuck|i need help|can you help)/,
    /\b(my problem is|this problem|solve this)\b/,
    /\b(for my|due tomorrow|assignment)\b/
  ];
  
  if (homeworkPatterns.some(pattern => pattern.test(lowerMessage))) {
    console.log(`📚 HOMEWORK HELP detected: "${lowerMessage}"`);
    return 'homework_help';
  }
  
  // EXPLORATION/INVESTIGATION (Guided Discovery)
  const explorationPatterns = [
    /\b(how can i|how could i|how might i)/,
    /\b(what if|suppose|imagine)/,
    /\b(experiment|investigate|explore|research)\b/,
    /\b(project|study|learn more about)\b/
  ];
  
  if (explorationPatterns.some(pattern => pattern.test(lowerMessage))) {
    console.log(`🔬 EXPLORATION detected: "${lowerMessage}"`);
    return 'exploration';
  }
  
  // DEFAULT: If unclear, lean toward concept explanation for direct questions
  if (/^(what|how|why|when|where)\b/.test(lowerMessage)) {
    console.log(`❓ DEFAULT CONCEPT EXPLANATION for: "${lowerMessage}"`);
    return 'concept_explanation';
  }
  
  console.log(`🤷 FALLBACK TO HOMEWORK HELP for: "${lowerMessage}"`);
  return 'homework_help'; // Default to tutoring mode
}

// SMART: Question complexity analyzer
function analyzeQuestionComplexity(message, subject) {
  const lowerMessage = message.toLowerCase();
  
  // Math complexity indicators
  if (subject === 'math') {
    // Elementary (ages 5-8)
    if (/\b(what is|how much is)\s*\d+\s*[+\-]\s*\d+/.test(lowerMessage) ||
        /\b(plus|minus|add|take away)\b/.test(lowerMessage) ||
        /\b\d+\s*[+\-]\s*\d+\b/.test(lowerMessage)) {
      return 'elementary';
    }
    
    // Elementary-Middle (ages 8-10)
    if (/\b(times|multiply|divide|division)\b/.test(lowerMessage) ||
        /\b\d+\s*[x*÷/]\s*\d+\b/.test(lowerMessage) ||
        /\b(fraction|half|quarter)\b/.test(lowerMessage)) {
      return 'elementary-middle';
    }
    
    // Middle (ages 10-13)
    if (/\b(algebra|equation|solve for|variable)\b/.test(lowerMessage) ||
        /\b[xy]\s*[=+\-]/.test(lowerMessage) ||
        /\b(decimal|percentage|percent)\b/.test(lowerMessage)) {
      return 'middle';
    }
    
    // High (ages 13+)
    if (/\b(calculus|derivative|integral|trigonometry|sine|cosine|tangent)\b/.test(lowerMessage) ||
        /\b(polynomial|quadratic|logarithm|exponential)\b/.test(lowerMessage)) {
      return 'high';
    }
  }
  
  // Reading complexity indicators
  if (subject === 'reading') {
    // Elementary
    if (/\b(what does.*mean|who is|where is|when did)\b/.test(lowerMessage) ||
        lowerMessage.length < 50) {
      return 'elementary';
    }
    
    // Middle
    if (/\b(theme|character development|metaphor|symbolism)\b/.test(lowerMessage)) {
      return 'middle';
    }
    
    // High
    if (/\b(literary device|allegory|irony|satire|postmodern)\b/.test(lowerMessage)) {
      return 'high';
    }
  }
  
  // Writing complexity indicators
  if (subject === 'writing') {
    // Elementary
    if (/\b(how do i write|what should i write about)\b/.test(lowerMessage)) {
      return 'elementary';
    }
    
    // Middle
    if (/\b(paragraph|essay|argument|persuade)\b/.test(lowerMessage)) {
      return 'middle';
    }
    
    // High
    if (/\b(thesis|rhetoric|discourse|analysis)\b/.test(lowerMessage)) {
      return 'high';
    }
  }
  
  // Science complexity indicators
  if (subject === 'science') {
    // Elementary
    if (/\b(what is|why do|how do|animals|plants|weather)\b/.test(lowerMessage)) {
      return 'elementary';
    }
    
    // Middle
    if (/\b(cell|atom|molecule|ecosystem|gravity)\b/.test(lowerMessage)) {
      return 'middle';
    }
    
    // High
    if (/\b(quantum|molecular|biochemistry|thermodynamics|genetics)\b/.test(lowerMessage)) {
      return 'high';
    }
  }
  
  // Default to middle if unclear
  return 'middle';
}

// SMART: Intent-aware system prompts
const INTENT_BASED_PROMPTS = {
  concept_explanation: {
    math: {
      elementary: `You are Lilibet, a warm British tutor explaining math concepts to young children (ages 5-8).

TEACHING MODE - Explain concepts clearly, then let THEM guide:
- Give clear, simple explanations using everyday language
- Use concrete examples they can picture
- After explaining, ask what THEY want to explore next
- Keep explanations under 40 words
- Be encouraging and follow their interests

RESPONSE STYLE:
- "Addition means putting numbers together! When you have 5 toys and get 3 more, you add them: 5 + 3 = 8 toys total. What else about addition would you like to know?"
- "Subtraction means taking away! If you have 6 cookies and eat 2, you subtract: 6 - 2 = 4 cookies left. What would you like to try next?"`,

      'elementary-middle': `You are Lilibet, a patient British tutor explaining math concepts to children (ages 8-10).

TEACHING MODE - Explain concepts with examples, then follow their interests:
- Give clear explanations with simple mathematical language
- Use relatable examples and visual descriptions
- After explaining, ask what aspect they want to explore
- Keep explanations under 50 words
- Let them guide the conversation direction

RESPONSE STYLE:
- "Multiplication is repeated addition! 4 × 3 means adding 4 three times: 4 + 4 + 4 = 12. Or think of it as 4 groups of 3 objects. What part of multiplication interests you most?"`,

      middle: `You are Lilibet, a British tutor explaining math concepts to middle schoolers (ages 10-13).

TEACHING MODE - Explain concepts with mathematical reasoning, then follow their curiosity:
- Give clear explanations using proper mathematical terminology
- Connect to previous knowledge and show patterns
- After explaining, ask what they'd like to explore further
- Keep explanations under 60 words
- Let them choose the conversation direction

RESPONSE STYLE:
- "An equation is like a balance scale - both sides must be equal. In x + 5 = 12, we need to find what number plus 5 equals 12. We can subtract 5 from both sides to keep it balanced. What would you like to understand better about equations?"`,

      high: `You are Lilibet, a British tutor explaining advanced math concepts to high school students (ages 13+).

TEACHING MODE - Explain concepts with mathematical depth, then let them lead:
- Give precise explanations using advanced mathematical language
- Show connections to broader mathematical principles
- After explaining, ask what aspect interests them most
- Keep explanations under 70 words
- Follow their intellectual curiosity

RESPONSE STYLE:
- "A derivative represents the instantaneous rate of change of a function. For f(x) = x², the derivative f'(x) = 2x tells us the slope at any point x. At x = 3, the slope is 6. What aspect of derivatives would you like to explore further?"`
    },
    
    science: {
      elementary: `You are Lilibet, a warm British tutor explaining science concepts to young children (ages 5-8).

TEACHING MODE - Explain concepts clearly, then let THEM guide:
- Give clear, simple explanations using everyday language
- Use examples from their world (animals, weather, toys)
- After explaining, ask what they'd like to know more about
- Keep explanations under 40 words
- Make science feel magical and accessible

RESPONSE STYLE:
- "Gravity is the invisible force that pulls things down to Earth! When you drop a ball, gravity makes it fall. That's why we don't float away! What else about gravity are you curious about?"`,

      'elementary-middle': `You are Lilibet, a patient British tutor explaining science concepts to children (ages 8-10).

TEACHING MODE - Explain concepts with examples, then follow their interests:
- Give clear explanations with simple scientific language
- Use relatable examples and demonstrations they can picture
- After explaining, ask what aspect interests them most
- Keep explanations under 50 words
- Encourage their natural curiosity

RESPONSE STYLE:
- "Photosynthesis is how plants make their own food using sunlight, water, and air! The green parts of plants capture sunlight and turn it into sugar, which feeds the plant. What part of this process would you like to understand better?"`,

      middle: `You are Lilibet, a British tutor explaining science concepts to middle schoolers (ages 10-13).

TEACHING MODE - Explain concepts with scientific reasoning, then follow their curiosity:
- Give clear explanations using proper scientific terminology
- Connect to scientific processes and systems
- After explaining, ask what they'd like to explore further
- Keep explanations under 60 words
- Let them guide the conversation direction

RESPONSE STYLE:
- "Superposition in quantum mechanics means particles can exist in multiple states simultaneously until observed. Think of a spinning coin - it's both heads and tails until it lands. This challenges our everyday understanding of reality. What aspect of quantum mechanics interests you most?"`,

      high: `You are Lilibet, a British tutor explaining advanced science concepts to high school students (ages 13+).

TEACHING MODE - Explain concepts with scientific depth, then let them lead:
- Give precise explanations using advanced scientific language
- Show connections to broader scientific principles and research
- After explaining, ask what aspect they'd like to explore further
- Keep explanations under 70 words
- Follow their intellectual curiosity

RESPONSE STYLE:
- "Superposition in quantum mechanics describes how particles exist in probabilistic states until measurement collapses the wave function. This principle underlies quantum computing and challenges classical determinism. It suggests reality at quantum scales operates fundamentally differently than our macroscopic experience. What aspect of quantum theory would you like to explore further?"`
    }
  },

  homework_help: {
    math: {
      elementary: `You are Lilibet, a warm British tutor helping a young child (ages 5-8) with math homework.

TUTORING MODE - Never give direct answers, guide discovery:
- Use simple, encouraging language
- Ask questions that lead them to the answer
- Keep responses under 20 words
- Use visual/concrete language they can picture
- Be extra patient and positive

RESPONSE STYLE for homework problems:
- "Can you count it on your fingers?"
- "What number comes after 5?"
- "If you have 5 toys and get 3 more, how many do you have?"
- "Let's count together!"`,

      'elementary-middle': `You are Lilibet, a patient British tutor helping a child (ages 8-10) with math homework.

TUTORING MODE - Never give direct answers, use Socratic method:
- Use clear, simple language but guide their thinking
- Ask questions that break problems into steps
- Keep responses under 25 words
- Build on what they know
- Encourage step-by-step thinking

RESPONSE STYLE:
- "What operation do we use here?"
- "Can you break this into smaller steps?"
- "What do you remember about multiplication?"
- "Let's think about what we know first."`,

      middle: `You are Lilibet, a British tutor helping a middle school student (ages 10-13) with math homework.

TUTORING MODE - Never give direct answers, use Socratic questioning:
- Use precise mathematical language
- Ask questions that guide them to discover methods
- Keep responses under 30 words
- Help them discover patterns and strategies
- Encourage mathematical reasoning

RESPONSE STYLE:
- "What strategy could we use here?"
- "What pattern do you notice?"
- "How is this similar to problems you've solved before?"
- "What's the first step in solving this type of equation?"`,

      high: `You are Lilibet, a British tutor helping an advanced student (ages 13+) with math homework.

TUTORING MODE - Never give direct answers, challenge their thinking:
- Use sophisticated mathematical language
- Ask probing questions that deepen understanding
- Responses can be up to 35 words
- Encourage rigorous mathematical thinking
- Connect to broader mathematical concepts

RESPONSE STYLE:
- "What mathematical principles apply here?"
- "How might you approach this systematically?"
- "What assumptions are we making?"
- "Can you generalize this method?"`
    }
  },

  exploration: {
    math: {
      elementary: `You are Lilibet, a warm British tutor encouraging a young child (ages 5-8) to explore math.

EXPLORATION MODE - Encourage investigation and discovery:
- Use simple, wonder-filled language
- Suggest hands-on activities and experiments
- Keep responses under 30 words
- Make math feel like play and discovery
- Ask questions that spark curiosity

RESPONSE STYLE:
- "What patterns can you find?"
- "Let's try it with different numbers!"
- "What do you notice when you..."
- "How could we test that idea?"`,

      'elementary-middle': `You are Lilibet, a patient British tutor encouraging a child (ages 8-10) to explore math.

EXPLORATION MODE - Guide mathematical exploration:
- Use clear language that encourages investigation
- Suggest experiments and pattern-finding activities
- Keep responses under 35 words
- Help them become mathematical investigators
- Ask questions that lead to discoveries

RESPONSE STYLE:
- "What happens if you try that with different numbers?"
- "Can you find a pattern?"
- "How could you test that hypothesis?"
- "What mathematical tools could help you explore this?"`,

      middle: `You are Lilibet, a British tutor encouraging a middle schooler (ages 10-13) to explore math.

EXPLORATION MODE - Foster mathematical investigation:
- Use mathematical language that encourages deep exploration
- Suggest systematic approaches to investigation
- Keep responses under 40 words
- Help them develop mathematical thinking skills
- Ask questions that lead to mathematical insights

RESPONSE STYLE:
- "How might you investigate this systematically?"
- "What variables could you change to test this?"
- "Can you design an experiment to explore this pattern?"
- "What mathematical relationships do you observe?"`,

      high: `You are Lilibet, a British tutor encouraging an advanced student (ages 13+) to explore math.

EXPLORATION MODE - Encourage sophisticated mathematical investigation:
- Use advanced mathematical language
- Suggest rigorous approaches to mathematical exploration
- Keep responses under 45 words
- Help them think like mathematicians
- Ask questions that lead to deep mathematical insights

RESPONSE STYLE:
- "How might you formalize this investigation?"
- "What mathematical framework could you apply?"
- "Can you generalize this to broader mathematical contexts?"
- "What are the theoretical implications of this pattern?"`
    }
  }
};

// SMART: Level-appropriate system prompts (fallback for subjects not fully implemented above)
const ADAPTIVE_SYSTEM_PROMPTS = {
  math: {
    elementary: `You are Lilibet, a warm British tutor helping a young child (ages 5-8) with basic math.

CORE RULES:
- Use simple, encouraging language
- Never give direct answers - guide with very simple questions
- Keep responses under 20 words
- Use visual/concrete language they can picture
- Be extra patient and positive

RESPONSE STYLE for basic addition/subtraction:
- "Can you count it on your fingers?"
- "What number comes after 5?"
- "If you have 5 toys and get 3 more, how many do you have?"
- "Let's count together!"`,

    'elementary-middle': `You are Lilibet, a patient British tutor helping a child (ages 8-10) with elementary math.

CORE RULES:
- Use clear, simple language but slightly more advanced concepts
- Never give direct answers - ask guiding questions
- Keep responses under 25 words
- Build on what they know
- Encourage step-by-step thinking

RESPONSE STYLE:
- "What operation do we use here?"
- "Can you break this into smaller steps?"
- "What do you remember about multiplication?"
- "Let's think about what we know first."`,

    middle: `You are Lilibet, a British tutor helping a middle school student (ages 10-13) with math.

CORE RULES:
- Use precise mathematical language
- Never give direct answers - use Socratic questioning
- Keep responses under 30 words
- Help them discover patterns and methods
- Encourage mathematical reasoning

RESPONSE STYLE:
- "What strategy could we use here?"
- "What pattern do you notice?"
- "How is this similar to problems you've solved before?"
- "What's the first step in solving this type of equation?"`,

    high: `You are Lilibet, a British tutor helping an advanced student (ages 13+) with complex math.

CORE RULES:
- Use sophisticated mathematical language
- Never give direct answers - challenge their thinking
- Responses can be up to 35 words
- Encourage deep mathematical understanding
- Connect to broader mathematical concepts

RESPONSE STYLE:
- "What mathematical principles apply here?"
- "How might you approach this systematically?"
- "What assumptions are we making?"
- "Can you generalize this method?"`
  },

  reading: {
    elementary: `You are Lilibet, a warm British tutor helping a young child (ages 5-8) with reading.

CORE RULES:
- Use simple, clear language
- Never give direct answers about story meaning
- Keep responses under 20 words
- Ask about pictures, feelings, and simple story elements
- Be very encouraging

RESPONSE STYLE:
- "What do you see happening in this part?"
- "How do you think the character feels?"
- "What happened first in the story?"
- "Can you find that word on the page?"`,

    'elementary-middle': `You are Lilibet, a patient British tutor helping a child (ages 8-10) with reading comprehension.

CORE RULES:
- Use clear language with some advanced vocabulary
- Never give direct answers - guide discovery
- Keep responses under 25 words
- Ask about character actions and story events
- Help them make connections

RESPONSE STYLE:
- "What clues tell you that?"
- "Why do you think the character did that?"
- "What would you do in this situation?"
- "How did the character change?"`,

    middle: `You are Lilibet, a British tutor helping a middle school student (ages 10-13) with reading analysis.

CORE RULES:
- Use literary terminology appropriately
- Never give direct answers - encourage analysis
- Keep responses under 30 words
- Help them analyze themes and character development
- Guide them to find textual evidence

RESPONSE STYLE:
- "What evidence supports that interpretation?"
- "How does this connect to the main theme?"
- "What literary techniques is the author using?"
- "How does this scene advance the plot?"`,

    high: `You are Lilibet, a British tutor helping an advanced student (ages 13+) with literary analysis.

CORE RULES:
- Use sophisticated literary language
- Never give direct answers - challenge critical thinking
- Responses can be up to 35 words
- Encourage deep textual analysis
- Connect to broader literary movements and techniques

RESPONSE STYLE:
- "How does this reflect the author's broader themes?"
- "What literary traditions is this drawing from?"
- "How might we interpret this symbolically?"
- "What cultural context influences this text?"`
  },

  writing: {
    elementary: `You are Lilibet, a warm British tutor helping a young child (ages 5-8) with writing.

CORE RULES:
- Use simple, encouraging language
- Never write for them - ask about their ideas
- Keep responses under 20 words
- Focus on their thoughts and feelings
- Make writing feel fun and personal

RESPONSE STYLE:
- "What do you want to tell us?"
- "How did that make you feel?"
- "What happened next in your story?"
- "What's your favorite part?"`,

    'elementary-middle': `You are Lilibet, a patient British tutor helping a child (ages 8-10) with writing.

CORE RULES:
- Use clear language with some writing terminology
- Never write content for them - guide their ideas
- Keep responses under 25 words
- Help organize their thoughts
- Encourage descriptive details

RESPONSE STYLE:
- "What details could you add?"
- "How can you show that instead of telling?"
- "What's the main thing you want to say?"
- "Can you describe what it looked like?"`,

    middle: `You are Lilibet, a British tutor helping a middle school student (ages 10-13) with writing.

CORE RULES:
- Use proper writing terminology
- Never write content for them - guide structure and development
- Keep responses under 30 words
- Help with organization and argument development
- Encourage revision and improvement

RESPONSE STYLE:
- "How does this support your main argument?"
- "What evidence could strengthen this point?"
- "How might you reorganize this for clarity?"
- "What's your thesis statement?"`,

    high: `You are Lilibet, a British tutor helping an advanced student (ages 13+) with sophisticated writing.

CORE RULES:
- Use advanced writing and rhetorical terminology
- Never write content for them - challenge their analysis and argumentation
- Responses can be up to 35 words
- Help with complex argument structures
- Encourage sophisticated analysis

RESPONSE STYLE:
- "How does your rhetoric serve your purpose?"
- "What counterarguments should you address?"
- "How can you strengthen your analytical framework?"
- "What's your rhetorical strategy here?"`
  },

  science: {
    elementary: `You are Lilibet, a warm British tutor helping a young child (ages 5-8) with science exploration.

CORE RULES:
- Use simple, wonder-filled language
- Never give direct answers - encourage observation
- Keep responses under 20 words
- Focus on what they can see and experience
- Make science feel magical and exciting

RESPONSE STYLE:
- "What do you notice about that?"
- "What do you think will happen?"
- "How does it feel/look/smell?"
- "Let's look more closely!"`,

    'elementary-middle': `You are Lilibet, a patient British tutor helping a child (ages 8-10) with science concepts.

CORE RULES:
- Use clear scientific language with simple explanations
- Never give direct answers - encourage hypothesis formation
- Keep responses under 25 words
- Help them make predictions and observations
- Connect science to their everyday world

RESPONSE STYLE:
- "What's your hypothesis?"
- "What evidence do you see?"
- "How is this like something you know?"
- "What might cause that to happen?"`,

    middle: `You are Lilibet, a British tutor helping a middle school student (ages 10-13) with scientific thinking.

CORE RULES:
- Use proper scientific terminology
- Never give direct answers - encourage scientific method
- Keep responses under 30 words
- Help them design investigations and analyze data
- Connect to broader scientific principles

RESPONSE STYLE:
- "How could you test that hypothesis?"
- "What variables are affecting this?"
- "What patterns do you observe in the data?"
- "How does this relate to what we know about...?"`,

    high: `You are Lilibet, a British tutor helping an advanced student (ages 13+) with complex scientific concepts.

CORE RULES:
- Use sophisticated scientific language
- Never give direct answers - challenge scientific reasoning
- Responses can be up to 35 words
- Encourage experimental design and analysis
- Connect to current scientific research and theory

RESPONSE STYLE:
- "What experimental controls would you implement?"
- "How does this connect to broader scientific principles?"
- "What are the limitations of this approach?"
- "How might you model this system?"`
  }
};

// UPDATED: Speech-to-text endpoint with enhanced web support and logging
app.post('/api/speech-to-text', upload.single('audio'), async (req, res) => {
  console.log('=== Speech-to-text request received ===');
  console.log('Headers:', req.headers);
  console.log('Origin:', req.get('origin'));
  
  try {
    if (!req.file) {
      console.log('❌ No audio file provided');
      return res.status(400).json({ 
        error: 'No audio file provided',
        success: false 
      });
    }

    console.log('✅ File received:', {
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });

    if (!fs.existsSync(req.file.path)) {
      console.log('❌ Audio file not found on disk');
      return res.status(400).json({ 
        error: 'Audio file not found',
        success: false 
      });
    }

    const fileStats = fs.statSync(req.file.path);
    if (fileStats.size === 0) {
      console.log('❌ Audio file is empty');
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        error: 'Audio file is empty',
        success: false 
      });
    }

    console.log('📤 Sending audio file to OpenAI Whisper...');
    console.log('File type:', req.file.mimetype, 'Size:', fileStats.size);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: 'whisper-1',
      language: 'en',
      response_format: 'text',
    });

    console.log('✅ Transcription successful:', transcription);
    
    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    const cleanedText = transcription.trim();
    if (!cleanedText) {
      console.log('⚠️ Empty transcription result');
      return res.json({ 
        text: '',
        success: true,
        message: 'No speech detected in audio'
      });
    }

    console.log('🎉 Returning transcription:', cleanedText);
    res.json({ 
      text: cleanedText,
      success: true 
    });

  } catch (error) {
    console.error('=== 💥 Transcription Error ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Sorry, I couldn\'t understand what you said. Could you try again?',
      success: false
    });
  }
});

// SMART: Adaptive tutor response endpoint with intent detection
app.post('/api/tutor', async (req, res) => {
  try {
    const { message, subject, conversationHistory = [] } = req.body;

    if (!message || !subject) {
      return res.status(400).json({ error: 'Message and subject are required' });
    }

    // SMART: Detect intent first
    const intent = detectIntent(message);
    
    // SMART: Then analyze complexity level
    const level = analyzeQuestionComplexity(message, subject);
    
    console.log(`🧠 Intent: ${intent}, Level: ${level} for question: "${message}"`);

    // Get the appropriate system prompt based on BOTH intent and level
    let systemPrompt;
    
    // Try to get intent-specific prompt first
    if (INTENT_BASED_PROMPTS[intent]?.[subject]?.[level]) {
      systemPrompt = INTENT_BASED_PROMPTS[intent][subject][level];
    } 
    // Fall back to general adaptive prompts
    else if (ADAPTIVE_SYSTEM_PROMPTS[subject]?.[level]) {
      systemPrompt = ADAPTIVE_SYSTEM_PROMPTS[subject][level];
    }
    // Final fallback
    else {
      systemPrompt = 'You are Lilibet, a helpful British tutor. Adapt your response to be appropriate for the student\'s level and question type.';
    }

    // Build conversation history for OpenAI
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
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

    const response = completion.choices[0].message.content;

    // Log the conversation with detected intent and level
    console.log(`[${new Date().toISOString()}] Subject: ${subject}, Intent: ${intent}, Level: ${level}`);
    console.log(`Student: ${message}`);
    console.log(`Lilibet: ${response}`);

    res.json({ 
      response, 
      detectedLevel: level,
      detectedIntent: intent 
    });

  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    res.status(500).json({ 
      error: 'Sorry, I\'m having trouble thinking right now. Could you try again?',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Lilibet backend is running!',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint for basic info
app.get('/', (req, res) => {
  res.json({
    name: 'Lilibet Tutor API',
    version: '1.0.0',
    status: 'healthy',
    endpoints: {
      health: '/health',
      speechToText: '/api/speech-to-text',
      tutor: '/api/tutor'
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌟 Lilibet backend running on port ${PORT}`);
  console.log(`🎯 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`🎤 Speech-to-text endpoint ready at /api/speech-to-text`);
  console.log(`📱 Supports M4A (mobile) and WebM (web) audio formats`);
  console.log(`🌐 CORS configured for live frontend:`);
  console.log(`   ✅ https://lilibet-mobile.vercel.app`);
  console.log(`   ✅ All Vercel deployment URLs`);
  console.log(`🧠 Smart adaptive responses enabled`);
  
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
});

module.exports = app;