const axios = require('axios');
class OpenAIClient {
  /**
   * Client for interacting with OpenAI's Chat API
   */
  
  constructor(apiKey = null) {
    /**
     * Initialize the OpenAI client.
     * 
     * @param {string} apiKey - OpenAI API key. If not provided, will look for OPENAI_API_KEY env variable.
     */
    this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required. Either pass it explicitly or set OPENAI_API_KEY environment variable.");
    }
    
    this.baseUrl = "https://api.openai.com/v1";
  }
  
  async chat(messages, model = "gpt-3.5-turbo", temperature = 0.7, maxTokens = null,
              topP = 1.0, frequencyPenalty = 0.0, presencePenalty = 0.0) {
    /**
     * Call OpenAI's chat completion API.
     * 
     * @param {Array<Object>} messages - List of message objects with 'role' and 'content' keys
     * @param {string} model - OpenAI model identifier to use
     * @param {number} temperature - Sampling temperature (0-2)
     * @param {number|null} maxTokens - Maximum tokens to generate
     * @param {number} topP - Nucleus sampling parameter
     * @param {number} frequencyPenalty - Penalty for token frequency
     * @param {number} presencePenalty - Penalty for token presence
     * 
     * @returns {Object} - Complete API response including content and metadata
     */
    const url = `${this.baseUrl}/chat/completions`;
    
    // Prepare request payload
    const payload = {
      model,
      messages,
      temperature,
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty
    };
    
    if (maxTokens) {
      payload.max_tokens = maxTokens;
    }
    
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
    
    try {
      // Make API request
      const response = await axios.post(url, payload, { headers });
      return response.data;
    } catch (error) {
      throw new Error(`OpenAI API request failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  formatMessages(systemPrompts, userPrompts) {
    /**
     * Format system and user prompts into the message format required by OpenAI API.
     * 
     * @param {Array<string>} systemPrompts - List of system prompts
     * @param {Array<string>} userPrompts - List of user prompts
     * 
     * @returns {Array<Object>} - List of formatted message objects
     */
    const messages = [];
    
    // Add system messages
    for (const systemPrompt of systemPrompts) {
      messages.push({ role: "system", content: systemPrompt });
    }
    
    // Add user messages
    for (const userPrompt of userPrompts) {
      messages.push({ role: "user", content: userPrompt });
    }
    
    return messages;
  }
}

exports.OpenAIClient = OpenAIClient;
