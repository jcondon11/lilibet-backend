// learningEngine.js - Smart Learning Intelligence System (Fixed)
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize AI clients
let openaiClient = null;
let claudeClient = null;

// Initialize clients only if API keys are present
if (process.env.OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('✅ OpenAI client initialized');
} else {
  console.log('⚠️ OpenAI API Key: Not configured');
}

if (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY) {
  // Try both possible env variable names
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  claudeClient = new Anthropic({
    apiKey: apiKey
  });
  console.log('✅ Claude client initialized');
} else {
  console.log('⚠️ Claude API Key: Not configured');
}

// Learning Mode Detection
const detectLearningMode = (message) => {
  const msg = message.toLowerCase();
  
  // Discovery Mode - Questions and curiosity
  if (msg.includes('what is') || msg.includes('how does') || msg.includes('why') || 
      msg.includes('tell me about') || msg.includes('explain')) {
    return 'explanation';
  }
  
  // Practice Mode - Exercises and problems
  if (msg.includes('practice') || msg.includes('solve') || msg.includes('calculate') ||
      msg.includes('exercise') || msg.includes('problem') || msg.includes('work through')) {
    return 'practice';
  }
  
  // Discovery Mode - Open exploration
  if (msg.includes('wonder') || msg.includes('curious') || msg.includes('explore') ||
      msg.includes('discover') || msg.includes('learn about')) {
    return 'discovery';
  }
  
  // Challenge Mode - Testing knowledge
  if (msg.includes('challenge') || msg.includes('test') || msg.includes('quiz') ||
      msg.includes('hard') || msg.includes('difficult')) {
    return 'challenge';
  }
  
  // Review Mode - Reinforcement
  if (msg.includes('review') || msg.includes('remember') || msg.includes('recap') ||
      msg.includes('summarize') || msg.includes('go over')) {
    return 'review';
  }
  
  // Default to discovery for open-ended questions
  return 'discovery';
};

// Intelligent Model Selection
const selectOptimalModel = (mode, hasOpenAI, hasClaude) => {
  // If only one API is available, use it
  if (!hasOpenAI && hasClaude) return 'claude';
  if (hasOpenAI && !hasClaude) return 'openai';
  if (!hasOpenAI && !hasClaude) return 'none';
  
  // Both available - choose based on mode
  switch(mode) {
    case 'explanation':
    case 'discovery':
      return 'claude'; // Claude excels at explanations and Socratic method
    case 'practice':
    case 'challenge':
    case 'review':
      return 'openai'; // GPT-4 better for structured exercises
    default:
      return 'openai';
  }
};

// Enhanced prompts for each learning mode
const getLearningPrompt = (mode, subject, skillLevel, message) => {
  const levelContext = {
    beginner: "Explain simply for a beginner learner. Use fun examples and avoid complex terms.",
    intermediate: "Explain for an intermediate learner. Balance detail with clarity.",
    advanced: "Explain for an advanced learner. Include more depth and connections.",
    expert: "Provide a comprehensive explanation with full context and nuance."
  };

  const baseContext = `You are Lilibet, an encouraging AI tutor helping a ${skillLevel} level learner with ${subject}. ${levelContext[skillLevel] || levelContext.intermediate}`;

  const modePrompts = {
    discovery: `${baseContext}
Use the Socratic method - ask guiding questions to help the learner discover the answer themselves.
Don't give direct answers immediately. Instead:
1. Ask what they already know
2. Guide them with hints
3. Encourage their thinking process
4. Celebrate their discoveries`,

    practice: `${baseContext}
Create a step-by-step practice exercise. 
1. Start with a simple example
2. Break it into manageable steps
3. Provide immediate feedback
4. Gradually increase difficulty
5. Celebrate progress`,

    explanation: `${baseContext}
Provide a clear, engaging explanation.
1. Start with the basic concept
2. Use relatable examples
3. Build complexity gradually
4. Check understanding with questions
5. Encourage questions`,

    challenge: `${baseContext}
Present an engaging challenge that tests understanding.
1. Start with an interesting problem
2. Encourage problem-solving strategies
3. Provide hints if needed
4. Celebrate creative thinking
5. Explain the solution thoroughly`,

    review: `${baseContext}
Help reinforce and review the concept.
1. Summarize key points
2. Check understanding with questions
3. Clarify any confusion
4. Connect to previous learning
5. Suggest next steps`
  };

  return modePrompts[mode] || modePrompts.discovery;
};

// FIXED: Call OpenAI with correct parameter
const callOpenAILearningMode = async (message, subject, skillLevel, mode) => {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const systemPrompt = getLearningPrompt(mode, subject, skillLevel, message);
  
  try {
    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_tokens: 500,  // FIXED: Using correct parameter name
      temperature: mode === 'practice' ? 0.3 : 0.7,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI Learning Mode Error:', error.message);
    
    // Try fallback model if main model fails
    try {
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        max_tokens: 500,
        temperature: mode === 'practice' ? 0.3 : 0.7,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      });
      return completion.choices[0].message.content;
    } catch (fallbackError) {
      console.error('OpenAI fallback also failed:', fallbackError.message);
      throw fallbackError;
    }
  }
};

// Call Claude with learning optimization and fallback
const callClaudeLearningMode = async (message, subject, skillLevel, mode) => {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const systemPrompt = getLearningPrompt(mode, subject, skillLevel, message);
  
  try {
    const response = await claudeClient.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      temperature: mode === 'practice' ? 0.3 : 0.7,
      system: systemPrompt,
      messages: [
        { role: "user", content: message }
      ]
    });

    return response.content[0].text;
  } catch (error) {
    console.error('Claude Learning Mode Error:', error.message);
    
    // Try fallback to sonnet if haiku fails
    try {
      const response = await claudeClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        temperature: mode === 'practice' ? 0.3 : 0.7,
        system: systemPrompt,
        messages: [
          { role: "user", content: message }
        ]
      });
      return response.content[0].text;
    } catch (fallbackError) {
      console.error('Claude fallback also failed:', fallbackError.message);
      throw fallbackError;
    }
  }
};

// Fallback response when both APIs fail
const getFallbackResponse = (mode, message) => {
  const fallbacks = {
    discovery: "That's a great question! Let me help you explore this. What do you already know about this topic? What makes you curious about it?",
    practice: "Let's work through this step by step. First, can you tell me what part you'd like to practice? We'll start simple and build up your skills!",
    explanation: "I'd love to explain this to you! While I'm having some technical difficulties, let's think about it together. What specific part would you like to understand better?",
    challenge: "You're ready for a challenge! Here's something to think about: How would you approach solving this type of problem? What strategies have worked for you before?",
    review: "Let's review what we've learned. Can you tell me what you remember about this topic? What parts were most interesting or confusing?"
  };
  
  return fallbacks[mode] || "I'm here to help you learn! Can you tell me more about what you'd like to know?";
};

// Main processing function
const processLearningInteraction = async (message, subject, skillLevel, hasOpenAI, hasClaude) => {
  const mode = detectLearningMode(message);
  const model = selectOptimalModel(mode, hasOpenAI, hasClaude);
  
  console.log(`🎯 Learning Mode: ${mode}, Selected Model: ${model}`);
  
  let response;
  let actualModel = model;
  
  try {
    if (model === 'openai' && hasOpenAI) {
      response = await callOpenAILearningMode(message, subject, skillLevel, mode);
    } else if (model === 'claude' && hasClaude) {
      response = await callClaudeLearningMode(message, subject, skillLevel, mode);
    } else if (model !== 'none') {
      // Fallback to available model
      if (hasOpenAI) {
        response = await callOpenAILearningMode(message, subject, skillLevel, mode);
        actualModel = 'openai';
      } else if (hasClaude) {
        response = await callClaudeLearningMode(message, subject, skillLevel, mode);
        actualModel = 'claude';
      }
    }
    
    if (!response) {
      response = getFallbackResponse(mode, message);
      actualModel = 'fallback';
    }
    
  } catch (error) {
    console.error('Error in learning interaction:', error);
    response = getFallbackResponse(mode, message);
    actualModel = 'fallback';
  }
  
  return {
    response,
    metadata: {
      mode,
      model: actualModel,
      subject,
      skillLevel
    }
  };
};

// Check API availability
const checkAPIStatus = () => {
  return {
    openai: !!openaiClient,
    claude: !!claudeClient,
    ready: !!(openaiClient || claudeClient)
  };
};

module.exports = {
  processLearningInteraction,
  checkAPIStatus,
  detectLearningMode
};