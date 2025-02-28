const axios = require('axios');

class InMemoryVectorDB {
  constructor(apiKey = null) {
    this.vectors = {};
    this.metadata = {};
    this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    this.embeddingEndpoint = "https://api.openai.com/v1/embeddings";
    this.model = "text-embedding-ada-002";
    
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required. Either pass it explicitly or set OPENAI_API_KEY environment variable.");
    }
  }

  async _getEmbedding(text) {
    /**
     * Get embeddings from OpenAI API using direct HTTP request
     */
    try {
      const response = await axios.post(
        this.embeddingEndpoint,
        {
          input: text,
          model: this.model
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return response.data.data[0].embedding;
    } catch (error) {
      throw new Error(`API request failed: ${error.response?.data || error.message}`);
    }
  }

  async storeText(id, text, metadata = null) {
    /**
     * Store text by converting it to a vector first
     */
    const vector = await this._getEmbedding(text);
    this.vectors[id] = vector;
    
    if (metadata) {
      this.metadata[id] = metadata;
    } else {
      this.metadata[id] = this.metadata[id] || {};
    }
    
    this.metadata[id].text = text;
  }

  async searchByText(queryText, topK = 5) {
    /**
     * Search using text query
     */
    const queryVector = await this._getEmbedding(queryText);
    return this.search(queryVector, topK);
  }

  store(id, vector, metadata = null) {
    /**
     * Store a vector with optional metadata
     */
    this.vectors[id] = vector;
    if (metadata) {
      this.metadata[id] = metadata;
    }
  }

  search(queryVector, topK = 5) {
    /**
     * Search for similar vectors using cosine similarity
     */
    if (Object.keys(this.vectors).length === 0) {
      return [];
    }
    
    const similarities = {};
    
    for (const [id, vec] of Object.entries(this.vectors)) {
      const similarity = this._cosineSimilarity(queryVector, vec);
      similarities[id] = similarity;
    }
    
    // Sort results by similarity score in descending order
    const sortedResults = Object.entries(similarities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);
    
    return sortedResults.map(([id, score]) => ({
      id,
      similarity: score,
      metadata: this.metadata[id] || {}
    }));
  }

  _cosineSimilarity(vec1, vec2) {
    /**
     * Calculate cosine similarity between two vectors
     */
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }
}

module.exports = InMemoryVectorDB;
