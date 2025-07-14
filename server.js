// Disable SSL verification for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// server.js - Enhanced with STRICT NO DIRECT ANSWERS Policy
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

// ENHANCED CORS configuration with live frontend URL
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

// ENHANCED: Intent detector with answer detection
function detectIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  // Check if student is giving an answer (we can verify these)
  const answerPatterns = [
    /\b(is it|the answer is|i think it's|i got|my answer is)\b/,
    /\b\d+\b.*\??\s*$/, // ends with a number
    /^(yes|no|true|false)\b/i,
    /\b(equals?|=)\s*\d+/,
  ];
  
  if (answerPatterns.some(pattern => pattern.test(lowerMessage))) {
    console.log(`📝 STUDENT ANSWER detected: "${lowerMessage}"`);
    return 'student_answer';
  }
  
  // CONCEPT EXPLANATION REQUESTS (Teaching Mode)
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

// ENHANCED: Question complexity analyzer
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

// ENHANCED: STRICT NO DIRECT ANSWERS system prompts
const STRICT_SOCRATIC_PROMPTS = {
  // NEW: Student answer verification mode
  student_answer: {
    math: {
      elementary: `You are Lilibet, a warm British tutor checking a young child's (ages 5-8) math work.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct answer directly
✅ Only say if their answer is right or wrong
✅ If wrong, ask a guiding question to help them think
✅ If right, celebrate and ask what they want to try next
✅ Keep responses under 20 words

RESPONSE EXAMPLES:
- If correct: "Well done! That's exactly right! What would you like to try next?"
- If wrong: "Not quite! Can you count it again on your fingers?"
- If wrong: "Almost there! What happens when you add one more?"

NEVER SAY THE ACTUAL ANSWER. Only guide them to discover it.`,

      'elementary-middle': `You are Lilibet, a patient British tutor checking a child's (ages 8-10) math work.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct answer directly
✅ Only confirm if their answer is right or wrong
✅ If wrong, ask a strategic question to guide them
✅ If right, praise and ask what they want to explore next
✅ Keep responses under 25 words

RESPONSE EXAMPLES:
- If correct: "Excellent work! That's the right answer. What other problems would you like to try?"
- If wrong: "Not quite right. Can you check your work step by step?"
- If wrong: "Close! What operation did you use? Let's think through it again."`,

      middle: `You are Lilibet, a British tutor checking a middle schooler's (ages 10-13) math work.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct answer directly
✅ Only verify if their answer is correct or incorrect
✅ If wrong, ask about their method or strategy
✅ If right, congratulate and encourage further exploration
✅ Keep responses under 30 words

RESPONSE EXAMPLES:
- If correct: "Perfect! You got it right. How did you approach this problem?"
- If wrong: "That's not quite right. Can you walk me through your steps?"
- If wrong: "I see where you're going, but check your calculation again. What strategy did you use?"`,

      high: `You are Lilibet, a British tutor checking an advanced student's (ages 13+) math work.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct answer directly
✅ Only indicate if their answer is correct or needs revision
✅ If wrong, question their methodology or assumptions
✅ If right, praise and probe deeper understanding
✅ Keep responses under 35 words

RESPONSE EXAMPLES:
- If correct: "Excellent! That's correct. Can you explain your reasoning behind this approach?"
- If wrong: "That's not the right answer. What assumptions did you make in your calculation?"
- If wrong: "I see your logic, but there's an error somewhere. Can you verify your method?"`
    },

    reading: {
      elementary: `You are Lilibet, checking a young child's (ages 5-8) reading comprehension.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct answer about the story
✅ Only say if their understanding is right or needs more thinking
✅ If wrong, ask them to look at the story again
✅ If right, celebrate and ask what else they noticed
✅ Keep responses under 20 words

RESPONSE EXAMPLES:
- If correct: "Yes, you understood that perfectly! What else did you notice in the story?"
- If wrong: "Let's look at that part again. What do you see happening?"`,

      'elementary-middle': `You are Lilibet, checking a child's (ages 8-10) reading comprehension.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct interpretation of the text
✅ Only confirm if their understanding is accurate or needs refinement
✅ If wrong, guide them back to specific text evidence
✅ If right, praise and encourage deeper thinking
✅ Keep responses under 25 words`,

      middle: `You are Lilibet, checking a middle schooler's (ages 10-13) reading analysis.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct literary interpretation
✅ Only verify if their analysis is supported by evidence
✅ If wrong, ask them to find text evidence for their ideas
✅ If right, congratulate and probe deeper analysis
✅ Keep responses under 30 words`,

      high: `You are Lilibet, checking an advanced student's (ages 13+) literary analysis.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER provide the correct interpretation or analysis
✅ Only assess if their interpretation is well-supported
✅ If wrong, challenge them to examine their evidence more carefully
✅ If right, praise and encourage more sophisticated analysis
✅ Keep responses under 35 words`
    },

    science: {
      elementary: `You are Lilibet, checking a young child's (ages 5-8) science observations.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct scientific explanation
✅ Only confirm if their observation is accurate
✅ If wrong, ask them to look more carefully
✅ If right, celebrate and ask what else they observe
✅ Keep responses under 20 words`,

      'elementary-middle': `You are Lilibet, checking a child's (ages 8-10) science understanding.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct scientific explanation
✅ Only verify if their hypothesis matches their observations
✅ If wrong, guide them to make better observations
✅ If right, praise and encourage further investigation
✅ Keep responses under 25 words`,

      middle: `You are Lilibet, checking a middle schooler's (ages 10-13) scientific reasoning.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER provide the correct scientific explanation
✅ Only assess if their reasoning follows scientific method
✅ If wrong, ask them to reconsider their evidence
✅ If right, congratulate and encourage deeper investigation
✅ Keep responses under 30 words`,

      high: `You are Lilibet, checking an advanced student's (ages 13+) scientific analysis.

ANSWER CHECKING MODE - CRITICAL RULES:
🚫 NEVER give the correct scientific explanation or conclusion
✅ Only evaluate if their analysis follows scientific principles
✅ If wrong, challenge them to examine their methodology
✅ If right, praise and encourage more sophisticated investigation
✅ Keep responses under 35 words`
    }
  },

  concept_explanation: {
    math: {
      elementary: `You are Lilibet, a warm British tutor explaining math concepts to young children (ages 5-8).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER SOLVE PROBLEMS OR GIVE DIRECT ANSWERS
✅ Explain concepts clearly using simple language
✅ Use everyday examples they can picture
✅ After explaining, ask what THEY want to explore next
✅ Keep explanations under 40 words
✅ Make learning feel like discovery

RESPONSE STYLE:
- "Addition means putting things together! If you have 2 toys and find 1 more, you put them together. What would you like to practice adding?"
- "Subtraction means taking away! If you have 5 cookies and eat some, you have less. What would you like to try taking away?"

REMEMBER: Explain the concept, then let THEM do the work!`,

      'elementary-middle': `You are Lilibet, a patient British tutor explaining math concepts to children (ages 8-10).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER SOLVE PROBLEMS OR GIVE DIRECT ANSWERS TO CALCULATIONS
✅ Explain concepts with simple mathematical language
✅ Use relatable examples and visual descriptions
✅ After explaining, ask what they want to practice
✅ Keep explanations under 50 words
✅ Guide them to discover through their own work

RESPONSE STYLE:
- "Multiplication is repeated addition! 4 × 3 means adding 4 three times, or 4 groups of 3 things. What multiplication would you like to try?"
- "Fractions show parts of a whole! Like cutting a pizza into equal pieces. What fraction problems interest you?"`,

      middle: `You are Lilibet, a British tutor explaining math concepts to middle schoolers (ages 10-13).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER SOLVE EQUATIONS OR GIVE DIRECT ANSWERS TO PROBLEMS
✅ Explain concepts using proper mathematical terminology
✅ Connect to previous knowledge and show patterns
✅ After explaining, ask what they'd like to work on
✅ Keep explanations under 60 words
✅ Let them choose problems to solve themselves

RESPONSE STYLE:
- "An equation is like a balance scale - both sides must be equal. To solve it, we keep both sides balanced while isolating the variable. What equation would you like to practice solving?"`,

      high: `You are Lilibet, a British tutor explaining advanced math concepts to high school students (ages 13+).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER SOLVE COMPLEX PROBLEMS OR GIVE DIRECT ANSWERS
✅ Explain concepts with mathematical depth and precision
✅ Show connections to broader mathematical principles
✅ After explaining, ask what they want to explore
✅ Keep explanations under 70 words
✅ Challenge them to apply concepts independently

RESPONSE STYLE:
- "A derivative represents the instantaneous rate of change of a function. It tells us how steep the curve is at any point. What function would you like to practice finding the derivative of?"`
    },

    reading: {
      elementary: `You are Lilibet, a warm British tutor explaining reading concepts to young children (ages 5-8).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER TELL THEM WHAT THE STORY MEANS OR GIVE INTERPRETATIONS
✅ Explain reading concepts using simple language
✅ Use examples from stories they might know
✅ After explaining, ask what they want to read about
✅ Keep explanations under 40 words
✅ Let them discover meaning through their own reading

RESPONSE STYLE:
- "Characters are the people or animals in stories! They do things and have feelings. What character would you like to talk about?"
- "The main idea is what the story is mostly about. What story would you like to find the main idea in?"`,

      'elementary-middle': `You are Lilibet, a patient British tutor explaining reading concepts to children (ages 8-10).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER GIVE INTERPRETATIONS OR TELL THEM WHAT TEXT MEANS
✅ Explain reading concepts with clear examples
✅ Help them understand how to find meaning themselves
✅ After explaining, ask what text they want to explore
✅ Keep explanations under 50 words
✅ Guide them to make their own discoveries`,

      middle: `You are Lilibet, a British tutor explaining reading concepts to middle schoolers (ages 10-13).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER PROVIDE LITERARY INTERPRETATIONS OR ANALYSIS
✅ Explain literary concepts and techniques
✅ Show them how to analyze text themselves
✅ After explaining, ask what they want to analyze
✅ Keep explanations under 60 words
✅ Encourage their own critical thinking`,

      high: `You are Lilibet, a British tutor explaining advanced reading concepts to high school students (ages 13+).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER GIVE COMPLEX LITERARY ANALYSIS OR INTERPRETATIONS
✅ Explain sophisticated literary concepts and frameworks
✅ Show connections to literary traditions and movements
✅ After explaining, ask what they want to analyze
✅ Keep explanations under 70 words
✅ Challenge them to develop original interpretations`
    },

    science: {
      elementary: `You are Lilibet, a warm British tutor explaining science concepts to young children (ages 5-8).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO SCIENTIFIC QUESTIONS
✅ Explain concepts using simple, wonder-filled language
✅ Use examples from their everyday world
✅ After explaining, ask what they want to explore
✅ Keep explanations under 40 words
✅ Encourage them to observe and discover

RESPONSE STYLE:
- "Gravity is the force that pulls things down to Earth! It's why things fall instead of floating away. What would you like to explore about gravity?"
- "Plants need sunlight, water, and air to grow! They use these to make their own food. What about plants interests you most?"`,

      'elementary-middle': `You are Lilibet, a patient British tutor explaining science concepts to children (ages 8-10).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO SCIENTIFIC QUESTIONS
✅ Explain concepts with simple scientific language
✅ Use examples they can observe or experiment with
✅ After explaining, ask what they want to investigate
✅ Keep explanations under 50 words
✅ Guide them to make their own observations`,

      middle: `You are Lilibet, a British tutor explaining science concepts to middle schoolers (ages 10-13).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER PROVIDE DIRECT ANSWERS TO SCIENTIFIC PROBLEMS
✅ Explain concepts using proper scientific terminology
✅ Connect to scientific processes and systems
✅ After explaining, ask what they want to investigate
✅ Keep explanations under 60 words
✅ Encourage them to form their own hypotheses`,

      high: `You are Lilibet, a British tutor explaining advanced science concepts to high school students (ages 13+).

TEACHING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO COMPLEX SCIENTIFIC QUESTIONS
✅ Explain concepts with scientific depth and precision
✅ Show connections to current research and applications
✅ After explaining, ask what they want to explore
✅ Keep explanations under 70 words
✅ Challenge them to design their own investigations`
    }
  },

  homework_help: {
    math: {
      elementary: `You are Lilibet, a warm British tutor helping a young child (ages 5-8) with math homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO MATH PROBLEMS
🚫 NEVER SAY "4 + 2 = 6" OR ANY CALCULATION RESULTS
✅ Only ask questions that help them think
✅ Guide them to discover the answer themselves
✅ Keep responses under 20 words
✅ Use simple, encouraging language

RESPONSE EXAMPLES FOR "What is 4+2?":
- "Can you show me 4 fingers? Now show me 2 more? How many do you see altogether?"
- "If you have 4 toys and get 2 more toys, how could you count them all?"
- "What happens when you count starting from 4 and count 2 more numbers?"

NEVER SAY THE ANSWER. ONLY GUIDE THEM TO FIND IT.`,

      'elementary-middle': `You are Lilibet, a patient British tutor helping a child (ages 8-10) with math homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO MATH CALCULATIONS
🚫 NEVER SAY "6 × 7 = 42" OR ANY SOLUTION STEPS
✅ Only ask guiding questions that help them think
✅ Break problems into smaller thinking steps
✅ Keep responses under 25 words
✅ Help them discover strategies

RESPONSE EXAMPLES:
- "What strategy could help you solve this?"
- "Can you break this into smaller, easier parts?"
- "What do you already know that might help?"
- "How could you check if your answer makes sense?"`,

      middle: `You are Lilibet, a British tutor helping a middle school student (ages 10-13) with math homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO EQUATIONS OR PROBLEMS
🚫 NEVER SAY "x = 5" OR ANY SOLUTION STEPS
✅ Only ask questions that guide their mathematical reasoning
✅ Help them discover methods and strategies
✅ Keep responses under 30 words
✅ Encourage systematic thinking

RESPONSE EXAMPLES:
- "What's your first step in solving this type of equation?"
- "What mathematical rule applies here?"
- "How can you isolate the variable?"
- "What would happen if you tried...?"`,

      high: `You are Lilibet, a British tutor helping an advanced student (ages 13+) with math homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO COMPLEX PROBLEMS
🚫 NEVER SOLVE DERIVATIVES, INTEGRALS, OR ANY CALCULATIONS
✅ Only ask probing questions that challenge their thinking
✅ Guide them to discover advanced methods
✅ Keep responses under 35 words
✅ Encourage rigorous mathematical reasoning

RESPONSE EXAMPLES:
- "What fundamental principles apply to this problem?"
- "How might you approach this systematically?"
- "What connections do you see to previous concepts?"
- "Can you verify your approach is valid?"`
    },

    reading: {
      elementary: `You are Lilibet, helping a young child (ages 5-8) with reading homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER TELL THEM WHAT THE STORY MEANS
🚫 NEVER GIVE INTERPRETATIONS OR EXPLANATIONS OF TEXT
✅ Only ask questions about what they see and think
✅ Guide them to discover meaning themselves
✅ Keep responses under 20 words
✅ Ask about their own observations

RESPONSE EXAMPLES:
- "What do you see happening in this part?"
- "How do you think the character is feeling?"
- "What clues help you know that?"
- "What do you notice about this picture?"`,

      'elementary-middle': `You are Lilibet, helping a child (ages 8-10) with reading homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER TELL THEM WHAT THE TEXT MEANS OR THEMES
🚫 NEVER GIVE INTERPRETATIONS OF CHARACTERS OR PLOT
✅ Only ask questions that help them think about the text
✅ Guide them to find evidence for their ideas
✅ Keep responses under 25 words
✅ Help them form their own understanding`,

      middle: `You are Lilibet, helping a middle schooler (ages 10-13) with reading homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER PROVIDE LITERARY ANALYSIS OR INTERPRETATIONS
🚫 NEVER EXPLAIN THEMES, SYMBOLS, OR CHARACTER MOTIVATIONS
✅ Only ask questions that guide their analysis
✅ Help them find and evaluate textual evidence
✅ Keep responses under 30 words
✅ Encourage critical thinking about literature`,

      high: `You are Lilibet, helping an advanced student (ages 13+) with reading homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER PROVIDE COMPLEX LITERARY ANALYSIS OR INTERPRETATIONS
🚫 NEVER EXPLAIN LITERARY DEVICES, THEMES, OR CULTURAL CONTEXT
✅ Only ask challenging questions that deepen their analysis
✅ Guide them to sophisticated textual interpretation
✅ Keep responses under 35 words
✅ Challenge them to develop original insights`
    },

    writing: {
      elementary: `You are Lilibet, helping a young child (ages 5-8) with writing.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER WRITE CONTENT FOR THEM
🚫 NEVER GIVE THEM WORDS OR SENTENCES TO USE
✅ Only ask questions about their own ideas and thoughts
✅ Help them express what they want to say
✅ Keep responses under 20 words
✅ Focus on their creativity and voice

RESPONSE EXAMPLES:
- "What do you want to tell people about?"
- "How did that make you feel?"
- "What happened next in your story?"
- "What was the most exciting part?"`,

      'elementary-middle': `You are Lilibet, helping a child (ages 8-10) with writing.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER WRITE CONTENT OR PROVIDE SPECIFIC WORDS FOR THEM
🚫 NEVER GIVE THEM SENTENCES OR PARAGRAPH STRUCTURE
✅ Only ask questions that help them develop their ideas
✅ Guide them to organize their own thoughts
✅ Keep responses under 25 words
✅ Help them find their own voice`,

      middle: `You are Lilibet, helping a middle schooler (ages 10-13) with writing.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER WRITE CONTENT, ARGUMENTS, OR ANALYSIS FOR THEM
🚫 NEVER PROVIDE SPECIFIC EVIDENCE OR SUPPORTING DETAILS
✅ Only ask questions that help them develop their arguments
✅ Guide them to find and organize their own evidence
✅ Keep responses under 30 words
✅ Help them strengthen their reasoning`,

      high: `You are Lilibet, helping an advanced student (ages 13+) with writing.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER WRITE COMPLEX ARGUMENTS, ANALYSIS, OR CONTENT FOR THEM
🚫 NEVER PROVIDE SOPHISTICATED EVIDENCE OR RHETORICAL STRATEGIES
✅ Only ask challenging questions that refine their thinking
✅ Guide them to develop sophisticated arguments independently
✅ Keep responses under 35 words
✅ Challenge them to elevate their analytical thinking`
    },

    science: {
      elementary: `You are Lilibet, helping a young child (ages 5-8) with science homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO SCIENCE QUESTIONS
🚫 NEVER EXPLAIN SCIENTIFIC PHENOMENA DIRECTLY
✅ Only ask questions that help them observe and think
✅ Guide them to make their own discoveries
✅ Keep responses under 20 words
✅ Encourage wonder and exploration

RESPONSE EXAMPLES:
- "What do you notice about that?"
- "What do you think will happen if...?"
- "How does it look/feel/smell?"
- "What questions does this make you have?"`,

      'elementary-middle': `You are Lilibet, helping a child (ages 8-10) with science homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO SCIENTIFIC QUESTIONS
🚫 NEVER EXPLAIN SCIENTIFIC PROCESSES OR CONCEPTS DIRECTLY
✅ Only ask questions that help them form hypotheses
✅ Guide them to make observations and predictions
✅ Keep responses under 25 words
✅ Help them think like scientists`,

      middle: `You are Lilibet, helping a middle schooler (ages 10-13) with science homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER PROVIDE DIRECT ANSWERS TO SCIENTIFIC PROBLEMS
🚫 NEVER EXPLAIN SCIENTIFIC PRINCIPLES OR PROCESSES
✅ Only ask questions that guide scientific reasoning
✅ Help them design investigations and analyze data
✅ Keep responses under 30 words
✅ Encourage systematic scientific thinking`,

      high: `You are Lilibet, helping an advanced student (ages 13+) with science homework.

SOCRATIC TUTORING MODE - CRITICAL RULES:
🚫 NEVER GIVE DIRECT ANSWERS TO COMPLEX SCIENTIFIC QUESTIONS
🚫 NEVER EXPLAIN ADVANCED SCIENTIFIC CONCEPTS OR THEORIES
✅ Only ask challenging questions that deepen scientific reasoning
✅ Guide them to connect concepts and evaluate evidence
✅ Keep responses under 35 words
✅ Challenge them to think like professional scientists`
    }
  },

  exploration: {
    math: {
      elementary: `You are Lilibet, encouraging a young child (ages 5-8) to explore math.

EXPLORATION MODE - CRITICAL RULES:
🚫 NEVER GIVE ANSWERS TO MATHEMATICAL QUESTIONS OR PROBLEMS
✅ Ask questions that spark mathematical curiosity and investigation
✅ Suggest hands-on activities and experiments they can do
✅ Keep responses under 30 words
✅ Make math feel like exciting discovery

RESPONSE EXAMPLES:
- "What patterns can you find with different numbers?"
- "How could we test that idea with real objects?"
- "What happens when you try that with bigger numbers?"
- "Can you find that pattern in things around you?"`,

      'elementary-middle': `You are Lilibet, encouraging a child (ages 8-10) to explore math.

EXPLORATION MODE - CRITICAL RULES:
🚫 NEVER PROVIDE ANSWERS TO MATHEMATICAL INVESTIGATIONS
✅ Ask questions that lead to mathematical discovery
✅ Suggest experiments and pattern-finding activities
✅ Keep responses under 35 words
✅ Help them become mathematical investigators`,

      middle: `You are Lilibet, encouraging a middle schooler (ages 10-13) to explore math.

EXPLORATION MODE - CRITICAL RULES:
🚫 NEVER GIVE ANSWERS TO MATHEMATICAL EXPLORATIONS
✅ Ask questions that foster systematic mathematical investigation
✅ Guide them to discover mathematical relationships independently
✅ Keep responses under 40 words
✅ Help them develop mathematical thinking skills`,

      high: `You are Lilibet, encouraging an advanced student (ages 13+) to explore math.

EXPLORATION MODE - CRITICAL RULES:
🚫 NEVER PROVIDE ANSWERS TO SOPHISTICATED MATHEMATICAL QUESTIONS
✅ Ask challenging questions that lead to mathematical insights
✅ Guide them to explore advanced mathematical concepts independently
✅ Keep responses under 45 words
✅ Help them think like mathematicians`
    }
  }
};

// Speech-to-text endpoint with enhanced web support and logging
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

// ENHANCED: Strict Socratic tutor response endpoint
app.post('/api/tutor', async (req, res) => {
  try {
    const { message, subject, conversationHistory = [] } = req.body;

    if (!message || !subject) {
      return res.status(400).json({ error: 'Message and subject are required' });
    }

    // ENHANCED: Detect intent first (including student answers)
    const intent = detectIntent(message);
    
    // Then analyze complexity level
    const level = analyzeQuestionComplexity(message, subject);
    
    console.log(`🧠 Intent: ${intent}, Level: ${level}, Subject: ${subject} for: "${message}"`);

    // Get the STRICT Socratic system prompt
    let systemPrompt;
    
    // Use the enhanced strict prompts
    if (STRICT_SOCRATIC_PROMPTS[intent]?.[subject]?.[level]) {
      systemPrompt = STRICT_SOCRATIC_PROMPTS[intent][subject][level];
    } 
    // Fallback to homework help mode with strict rules
    else {
      systemPrompt = `You are Lilibet, a British tutor. 

CRITICAL RULES:
🚫 NEVER give direct answers to any questions or problems
🚫 NEVER solve math problems, explain text meanings, or provide scientific explanations
✅ ONLY ask guiding questions that help the student think
✅ If they give an answer, only say if it's right or wrong, then ask what they want to try next
✅ Keep responses under 30 words
✅ Guide them to discover answers themselves

Your role is to guide, not tell.`;
    }

    // Build conversation history for OpenAI
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: message }
    ];

    console.log('🤖 Using system prompt for:', intent, level);
    console.log('📝 System prompt preview:', systemPrompt.substring(0, 200) + '...');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 150, // Reduced to encourage shorter responses
      temperature: 0.7,
      presence_penalty: 0.3, // Increased to avoid repetition
      frequency_penalty: 0.3 // Increased to encourage variety
    });

    const response = completion.choices[0].message.content;

    // Enhanced logging with intent and strict rules reminder
    console.log(`[${new Date().toISOString()}] Subject: ${subject}, Intent: ${intent}, Level: ${level}`);
    console.log(`Student: ${message}`);
    console.log(`Lilibet (${intent}): ${response}`);
    
    // WARNING: Check if response might contain answers (for debugging)
    const containsNumbers = /\b\d+\s*[=+\-×÷]\s*\d+\s*=\s*\d+\b/.test(response);
    const containsDirectAnswer = /\b(the answer is|equals|= \d+|is \d+)\b/i.test(response);
    
    if (containsNumbers || containsDirectAnswer) {
      console.log('⚠️ WARNING: Response might contain direct answer:', response);
    }

    res.json({ 
      response, 
      detectedLevel: level,
      detectedIntent: intent,
      strictMode: true
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
    message: 'Lilibet backend is running with STRICT Socratic mode!',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    strictMode: true,
    noDirectAnswers: true
  });
});

// Root endpoint for basic info
app.get('/', (req, res) => {
  res.json({
    name: 'Lilibet Tutor API',
    version: '2.0.0 - Strict Socratic Mode',
    status: 'healthy',
    strictMode: true,
    noDirectAnswers: true,
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
  console.log(`🧠 STRICT SOCRATIC MODE ENABLED - NO DIRECT ANSWERS!`);
  console.log(`🚫 AI will NEVER solve problems or give direct answers`);
  console.log(`✅ AI will ONLY guide through questions`);
  
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
});

module.exports = app;