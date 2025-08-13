// learningEngine.js - Smart Learning Intelligence System (Fixed for new OpenAI API)
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
const getLearningPrompt = (mode, subject, ageGroup, message) => {
  const ageContext = {
    elementary: "Explain simply for a young student (ages 5-10). Use fun examples and avoid complex terms.",
    middle: "Explain for a middle school student (ages 10-14). Balance detail with clarity.",
    high: "Explain for a high school student (ages 14-18). Include more depth and connections.",
    adult: "Provide a comprehensive explanation with full context and nuance."
  };

  const baseContext = `You are Lilibet, an encouraging AI tutor helping a ${ageGroup} student with ${subject}. ${ageContext[ageGroup] || ageContext.middle}`;

  const modePrompts = {
    discovery: `${baseContext}
Use the Socratic method - ask guiding questions to help the student discover the answer themselves.
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

// Call OpenAI with learning optimization (FIXED FOR NEW API)
const callOpenAILearningMode = async (message, subject, ageGroup, mode) => {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const systemPrompt = getLearningPrompt(mode, subject, ageGroup, message);
  
  try {
    // Determine which model to use based on what's available
    let modelToUse = 'gpt-4o-mini'; // Default model
    
    // Try to use better models if available
    try {
      // Check if GPT-4o is available (it should be with most API keys)
      modelToUse = 'gpt-4o-mini'; // Using mini for cost efficiency
    } catch (e) {
      console.log('Using default model: gpt-4o-mini');
    }

    const completion = await openaiClient.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      max_completion_tokens: 500,  // FIXED: Using max_completion_tokens instead of max_tokens
      temperature: mode === 'practice' ? 0.3 : 0.7,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI Learning Mode Error:', error);
    
    // If the error is about the parameter, try with older parameter name
    if (error.message && error.message.includes('max_completion_tokens')) {
      try {
        const completion = await openaiClient.chat.completions.create({
          model: 'gpt-3.5-turbo', // Fall back to older model
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ],
          max_tokens: 500,  // Use old parameter for older model
          temperature: mode === 'practice' ? 0.3 : 0.7,
          presence_penalty: 0.1,
          frequency_penalty: 0.1
        });
        return completion.choices[0].message.content;
      } catch (fallbackError) {
        console.error('Fallback to GPT-3.5 also failed:', fallbackError);
        throw fallbackError;
      }
    }
    
    throw error;
  }
};

// Call Claude with learning optimization
const callClaudeLearningMode = async (message, subject, ageGroup, mode) => {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const systemPrompt = getLearningPrompt(mode, subject, ageGroup, message);
  
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
    console.error('Claude Learning Mode Error:', error);
    throw error;
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

// Main learning interaction processor
const processLearningInteraction = async (message, subject, ageGroup, hasOpenAI = true, hasClaude = true) => {
  try {
    // Detect learning mode
    const mode = detectLearningMode(message);
    console.log(`🎯 Learning mode detected: ${mode}`);
    
    // Select optimal model
    const selectedModel = selectOptimalModel(mode, hasOpenAI, hasClaude);
    console.log(`🤖 Using model: ${selectedModel} (OpenAI: ${hasOpenAI}, Claude: ${hasClaude})`);
    
    let response;
    
    // Try primary model
    try {
      if (selectedModel === 'openai') {
        response = await callOpenAILearningMode(message, subject, ageGroup, mode);
      } else if (selectedModel === 'claude') {
        response = await callClaudeLearningMode(message, subject, ageGroup, mode);
      } else {
        response = getFallbackResponse(mode, message);
      }
    } catch (primaryError) {
      console.error(`Primary model (${selectedModel}) failed:`, primaryError);
      
      // Try alternate model
      try {
        if (selectedModel === 'openai' && hasClaude) {
          console.log('Falling back to Claude...');
          response = await callClaudeLearningMode(message, subject, ageGroup, mode);
        } else if (selectedModel === 'claude' && hasOpenAI) {
          console.log('Falling back to OpenAI...');
          response = await callOpenAILearningMode(message, subject, ageGroup, mode);
        } else {
          response = getFallbackResponse(mode, message);
        }
      } catch (secondaryError) {
        console.error('Secondary model also failed:', secondaryError);
        response = getFallbackResponse(mode, message);
      }
    }
    
    console.log(`🤖 Learning response generated using ${selectedModel} in ${mode} mode`);
    
    // Return response with metadata
    return {
      response,
      metadata: {
        mode,
        model: selectedModel,
        subject,
        ageGroup,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Learning engine error:', error);
    // Always return something educational
    return {
      response: getFallbackResponse('discovery', message),
      metadata: {
        mode: 'discovery',
        model: 'fallback',
        subject,
        ageGroup,
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
};

// Check if APIs are properly configured
const checkAPIStatus = () => {
  return {
    openai: !!openaiClient,
    claude: !!claudeClient,
    ready: !!openaiClient || !!claudeClient
  };
};

module.exports = {
  detectLearningMode,
  selectOptimalModel,
  processLearningInteraction,
  checkAPIStatus,
  getLearningPrompt
};