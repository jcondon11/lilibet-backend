// learningEngine.js - Smart Learning Intelligence System for Lilibet
// Implements intelligent learning mode detection and routing
// Uses proven techniques from OpenAI Study Mode and Anthropic Learning Mode

/**
 * LEARNING MODES - Based on OpenAI Study Mode and Claude Learning Mode research
 */
const LEARNING_MODES = {
  DISCOVERY: 'discovery',      // Deep exploration with Socratic questioning (Claude best)
  PRACTICE: 'practice',        // Quick drills and skill building (OpenAI best)  
  EXPLANATION: 'explanation',  // Concept understanding with examples (Claude best)
  CHALLENGE: 'challenge',      // Problem-solving and application (OpenAI best)
  REVIEW: 'review'            // Knowledge checking and reinforcement (OpenAI best)
};

/**
 * Analyze student input to determine optimal learning mode
 */
const detectLearningMode = (userInput, conversationHistory = [], studentAge = 'middle') => {
  const input = userInput.toLowerCase();
  
  // Keywords that indicate different learning needs
  const discoveryKeywords = ['why', 'how does', 'what if', 'explain', 'understand', 'confused', "don't get"];
  const practiceKeywords = ['practice', 'drill', 'exercise', 'quiz', 'test me', 'more problems'];
  const explanationKeywords = ['what is', 'define', 'meaning', 'concept', 'theory', 'principle'];
  const challengeKeywords = ['solve', 'problem', 'challenge', 'harder', 'difficult', 'apply'];
  const reviewKeywords = ['review', 'check', 'correct', 'grade', 'feedback', 'did i get'];

  // Check for explicit mode requests
  if (discoveryKeywords.some(keyword => input.includes(keyword))) {
    return LEARNING_MODES.DISCOVERY;
  }
  if (practiceKeywords.some(keyword => input.includes(keyword))) {
    return LEARNING_MODES.PRACTICE;
  }
  if (explanationKeywords.some(keyword => input.includes(keyword))) {
    return LEARNING_MODES.EXPLANATION;
  }
  if (challengeKeywords.some(keyword => input.includes(keyword))) {
    return LEARNING_MODES.CHALLENGE;
  }
  if (reviewKeywords.some(keyword => input.includes(keyword))) {
    return LEARNING_MODES.REVIEW;
  }

  // Analyze conversation context
  if (conversationHistory.length > 3) {
    const recentMessages = conversationHistory.slice(-3);
    const hasQuestions = recentMessages.some(msg => 
      msg.role === 'assistant' && msg.content.includes('?')
    );
    
    if (hasQuestions) {
      return LEARNING_MODES.DISCOVERY; // Continue Socratic questioning
    }
  }

  // Default based on age and input complexity
  const wordCount = userInput.split(' ').length;
  if (wordCount > 15) {
    return LEARNING_MODES.EXPLANATION; // Long questions need explanation
  }
  
  return LEARNING_MODES.DISCOVERY; // Default to discovery learning
};

/**
 * Choose optimal AI model for the learning mode
 */
const chooseOptimalModel = (learningMode, availableModels = { openai: false, claude: false }) => {
  // Based on strengths observed in Study Mode vs Learning Mode
  switch (learningMode) {
    case LEARNING_MODES.DISCOVERY:
    case LEARNING_MODES.EXPLANATION:
      return availableModels.claude ? 'claude' : 'openai'; // Claude excels at reasoning and explanation
    
    case LEARNING_MODES.PRACTICE:
    case LEARNING_MODES.CHALLENGE:
    case LEARNING_MODES.REVIEW:
      return 'openai'; // OpenAI better for quick responses and problem-solving
    
    default:
      return availableModels.openai ? 'openai' : 'claude'; // Fallback to available model
  }
};

/**
 * Generate learning-optimized prompts based on mode
 */
const generateLearningPrompt = (learningMode, subject, ageGroup, userInput, conversationHistory = []) => {
  const ageContext = {
    'elementary': 'a curious elementary school student (ages 6-11)',
    'middle': 'an engaged middle school student (ages 11-14)', 
    'high': 'a motivated high school student (ages 14-18)',
    'adult': 'an adult learner'
  };

  const studentDescription = ageContext[ageGroup] || ageContext['middle'];
  
  // Base instruction that mimics Study Mode behavior
  const baseInstruction = `You are Lilibet, an educational AI tutor specializing in guided learning. You're helping ${studentDescription} learn ${subject}. Your goal is to guide learning through questioning and discovery, not just provide answers.`;

  const modeInstructions = {
    [LEARNING_MODES.DISCOVERY]: `
${baseInstruction}

DISCOVERY MODE - Use Socratic questioning:
- Ask 2-3 guiding questions that lead the student to discover the answer
- Use questions like "What do you think might happen if...?" or "How does this connect to what you already know?"
- If they're stuck, provide a small hint and ask another question
- Encourage critical thinking with "What evidence supports that?" or "Why do you think that's true?"
- Never give direct answers - always guide them to the solution

Current question: "${userInput}"
Guide them to discover the answer through thoughtful questions.`,

    [LEARNING_MODES.PRACTICE]: `
${baseInstruction}

PRACTICE MODE - Step-by-step skill building:
- Break the problem into smaller, manageable steps
- Provide one step at a time and wait for student response
- Offer gentle correction if they make mistakes
- Give encouragement and positive reinforcement
- Create similar practice problems to reinforce learning
- Ask "Can you try the next step?" or "What would you do next?"

Current practice request: "${userInput}"
Help them build skills through guided practice.`,

    [LEARNING_MODES.EXPLANATION]: `
${baseInstruction}

EXPLANATION MODE - Build understanding with connections:
- Start with what they already know and build from there
- Use analogies and real-world examples appropriate for their age
- Break complex concepts into digestible parts
- Connect new ideas to previously learned concepts
- Ask understanding checks like "Does this make sense so far?"
- Use visual descriptions and concrete examples

Current concept to explain: "${userInput}"
Help them understand by connecting to familiar ideas.`,

    [LEARNING_MODES.CHALLENGE]: `
${baseInstruction}

CHALLENGE MODE - Problem-solving application:
- Present the problem and ask how they would approach it
- Guide them through problem-solving strategies
- Ask "What's your first step?" or "What information do you need?"
- If stuck, provide strategic hints, not direct answers
- Encourage multiple solution approaches
- Celebrate problem-solving process, not just correct answers

Current challenge: "${userInput}"
Guide them through systematic problem-solving.`,

    [LEARNING_MODES.REVIEW]: `
${baseInstruction}

REVIEW MODE - Knowledge checking and reinforcement:
- Ask questions to check their understanding
- Provide immediate feedback on their responses
- Identify knowledge gaps and address them
- Create quick review questions based on the topic
- Summarize key points they've learned
- Build confidence through positive reinforcement

Current review topic: "${userInput}"
Check their understanding and reinforce learning.`
  };

  return modeInstructions[learningMode] || modeInstructions[LEARNING_MODES.DISCOVERY];
};

/**
 * Call OpenAI with learning-optimized prompt
 */
const callOpenAILearningMode = async (client, prompt, conversationHistory = []) => {
  if (!client) {
    throw new Error('OpenAI client not provided');
  }

  try {
    // Prepare messages with learning context
    const messages = [
      { role: 'system', content: prompt },
      ...conversationHistory.slice(-6), // Keep last 6 messages for context
    ];

    const response = await client.chat.completions.create({
      model: 'gpt-5-mini',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7, // Slightly creative but focused
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI learning mode error:', error);
    throw error;
  }
};

/**
 * Call Claude with learning-optimized prompt
 */
const callClaudeLearningMode = async (client, prompt, conversationHistory = []) => {
  if (!client) {
    throw new Error('Claude client not provided');
  }

  try {
    // Prepare conversation for Claude
    const messages = conversationHistory.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      system: prompt,
      messages: messages,
    });

    return response.content[0].text;
  } catch (error) {
    console.error('Claude learning mode error:', error);
    throw error;
  }
};

/**
 * Main learning engine function - intelligently routes to best learning approach
 */
const processLearningInteraction = async (userInput, options = {}) => {
  try {
    // Extract options with proper defaults
    const subject = options.subject || 'general';
    const ageGroup = options.ageGroup || 'middle';
    const conversationHistory = options.conversationHistory || [];
    const parentalSettings = options.parentalSettings || null;
    const openaiClient = options.openaiClient || null;
    const claudeClient = options.claudeClient || null;

    console.log(`🔧 Learning engine received - OpenAI: ${!!openaiClient}, Claude: ${!!claudeClient}`);

    // Step 1: Detect optimal learning mode
    const learningMode = detectLearningMode(userInput, conversationHistory, ageGroup);
    console.log(`🎯 Learning mode detected: ${learningMode}`);

    // Step 2: Check which models are available
    const availableModels = {
      openai: !!openaiClient,
      claude: !!claudeClient
    };

    // Step 3: Choose optimal AI model for this learning mode
    const optimalModel = chooseOptimalModel(learningMode, availableModels);
    console.log(`🤖 Using model: ${optimalModel} (OpenAI: ${availableModels.openai}, Claude: ${availableModels.claude})`);

    // Step 4: Validate we have at least one model available
    if (!openaiClient && !claudeClient) {
      throw new Error('No AI models available');
    }

    // Step 5: Generate learning-optimized prompt
    const learningPrompt = generateLearningPrompt(
      learningMode, 
      subject, 
      ageGroup, 
      userInput, 
      conversationHistory
    );

    // Step 6: Apply parental controls if needed
    let finalPrompt = learningPrompt;
    if (parentalSettings && parentalSettings.restrictedTopics) {
      finalPrompt += `\n\nIMPORTANT: Avoid these restricted topics: ${parentalSettings.restrictedTopics.join(', ')}. Keep content appropriate for ${ageGroup} age group.`;
    }

    // Step 7: Add user message to conversation
    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: userInput }
    ];

    // Step 8: Call optimal AI model with proper fallback
    let response;
    let actualModelUsed = optimalModel;
    
    if (optimalModel === 'claude' && claudeClient) {
      response = await callClaudeLearningMode(claudeClient, finalPrompt, updatedHistory);
    } else if (optimalModel === 'openai' && openaiClient) {
      response = await callOpenAILearningMode(openaiClient, finalPrompt, updatedHistory);
    } else if (openaiClient) {
      // Fallback to OpenAI if Claude was preferred but not available
      response = await callOpenAILearningMode(openaiClient, finalPrompt, updatedHistory);
      actualModelUsed = 'openai';
      console.log('🔄 Fell back to OpenAI');
    } else if (claudeClient) {
      // Fallback to Claude if OpenAI was preferred but not available
      response = await callClaudeLearningMode(claudeClient, finalPrompt, updatedHistory);
      actualModelUsed = 'claude';
      console.log('🔄 Fell back to Claude');
    } else {
      throw new Error('No AI models available');
    }

    // Step 9: Return enhanced response with metadata
    return {
      response,
      metadata: {
        learningMode,
        modelUsed: actualModelUsed,
        modelRequested: optimalModel,
        subject,
        ageGroup,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    console.error('Learning engine error:', error);
    
    // Fallback to basic response
    return {
      response: "I'm having trouble right now, but I'm here to help you learn! Could you ask your question in a different way?",
      metadata: {
        learningMode: 'fallback',
        modelUsed: 'none',
        error: error.message,
        timestamp: new Date().toISOString()
      }
    };
  }
};

/**
 * Analyze learning effectiveness from conversation
 */
const analyzeLearningEffectiveness = (conversationHistory) => {
  if (!conversationHistory || conversationHistory.length < 4) {
    return {
      engagement: 'insufficient_data',
      understanding: 'unknown',
      recommendations: ['Continue conversation to assess learning']
    };
  }

  const studentMessages = conversationHistory.filter(msg => msg.role === 'user');
  const tutorMessages = conversationHistory.filter(msg => msg.role === 'assistant');

  // Analyze engagement
  const avgStudentLength = studentMessages.reduce((sum, msg) => sum + msg.content.length, 0) / studentMessages.length;
  const engagement = avgStudentLength > 20 ? 'high' : avgStudentLength > 10 ? 'medium' : 'low';

  // Analyze understanding signals
  const understandingSignals = {
    questions: studentMessages.some(msg => msg.content.includes('?')),
    confusion: studentMessages.some(msg => 
      msg.content.toLowerCase().includes('confused') || 
      msg.content.toLowerCase().includes("don't understand")
    ),
    confidence: studentMessages.some(msg => 
      msg.content.toLowerCase().includes('i think') || 
      msg.content.toLowerCase().includes('maybe')
    )
  };

  let understanding = 'progressing';
  if (understandingSignals.confusion) understanding = 'struggling';
  if (understandingSignals.confidence && !understandingSignals.confusion) understanding = 'good';

  // Generate recommendations
  const recommendations = [];
  if (engagement === 'low') {
    recommendations.push('Try more interactive questions to increase engagement');
  }
  if (understanding === 'struggling') {
    recommendations.push('Break down concepts into smaller steps');
    recommendations.push('Use more concrete examples and analogies');
  }
  if (understanding === 'good') {
    recommendations.push('Ready for more challenging questions');
    recommendations.push('Consider introducing related concepts');
  }

  return {
    engagement,
    understanding,
    recommendations
  };
};

module.exports = {
  LEARNING_MODES,
  detectLearningMode,
  chooseOptimalModel,
  processLearningInteraction,
  analyzeLearningEffectiveness
};