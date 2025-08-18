const fs = require('fs');
const path = require('path');
const { InferenceClient } = require('@huggingface/inference');

class MemoryManager {
    constructor() {
        this.memory = {}; // Start with empty memory, no file loading
        this.hf = new InferenceClient(process.env.HF_TOKEN);
        // No auto-save interval since we're not saving to file
    }

    // loadMemory() - removed, no file loading
    // saveMemory() - removed, no file saving

    // Store user information
    setUserInfo(userId, key, value) {
        if (!this.memory[userId]) {
            this.memory[userId] = {};
        }
        this.memory[userId][key] = {
            value: value,
            timestamp: Date.now()
        };
        if (process.env.DEBUG_MEMORY === '1') {
            console.log(`[MEMORY] Stored ${key} for user ${userId}: ${value}`);
        }
        // No dirty flag since we're not saving to file
    }

    // Get user information
    getUserInfo(userId, key) {
        if (!this.memory[userId] || !this.memory[userId][key]) {
            return null;
        }
        return this.memory[userId][key].value;
    }

    // Get all user information
    getAllUserInfo(userId) {
        return this.memory[userId] || {};
    }

    // Store conversation context
    addConversation(userId, message, response) {
        if (!this.memory[userId]) {
            this.memory[userId] = {};
        }
        if (!this.memory[userId].conversations) {
            this.memory[userId].conversations = [];
        }
        
        this.memory[userId].conversations.push({
            message: message,
            response: response,
            timestamp: Date.now()
        });

        // Keep only last 20 conversations
        if (this.memory[userId].conversations.length > 20) {
            this.memory[userId].conversations.shift();
        }

        // Also store the AI's response for learning
        if (!this.memory[userId].aiResponses) {
            this.memory[userId].aiResponses = [];
        }
        
        this.memory[userId].aiResponses.push({
            response: response,
            timestamp: Date.now()
        });

        // Keep only last 20 AI responses
        if (this.memory[userId].aiResponses.length > 20) {
            this.memory[userId].aiResponses.shift();
        }
        // No dirty flag since we're not saving to file
    }

    // Get recent conversations
    getRecentConversations(userId, count = 5) {
        if (!this.memory[userId] || !this.memory[userId].conversations) {
            return [];
        }
        return this.memory[userId].conversations.slice(-count);
    }

    // Store all messages for AI to learn naturally
    processMessage(userId, message) {
        // Store the raw message for AI context
        if (!this.memory[userId]) {
            this.memory[userId] = {};
        }
        if (!this.memory[userId].rawMessages) {
            this.memory[userId].rawMessages = [];
        }
        
        // Keep last 50 raw messages for AI to learn from
        this.memory[userId].rawMessages.push({
            content: message,
            timestamp: Date.now()
        });
        
        if (this.memory[userId].rawMessages.length > 50) {
            this.memory[userId].rawMessages.shift();
        }
        
        // Track profile update cadence
        if (!this.memory[userId].profileUpdate) {
            this.memory[userId].profileUpdate = { lastUpdated: 0, messagesSinceUpdate: 0 };
        }
        this.memory[userId].profileUpdate.messagesSinceUpdate += 1;

        // Let AI figure out what's important instead of hard-coded extraction
        if (process.env.DEBUG_MEMORY === '1') {
            console.log(`[MEMORY] Stored message for user ${userId}: ${message.substring(0, 50)}...`);
        }
        // No dirty flag since we're not saving to file
    }

    // Get conversation summary for AI context
    getConversationSummary(userId) {
        const rawMessages = this.memory[userId]?.rawMessages || [];
        const recentConversations = this.getRecentConversations(userId, 5);
        
        let summary = '';
        
        // Add recent raw messages for AI to learn from naturally
        if (rawMessages.length > 0) {
            summary += `Recent user messages (learn from these to understand the user): `;
            rawMessages.slice(-10).forEach((msg, index) => {
                summary += `[${index + 1}] "${msg.content}". `;
            });
        }

        // Add recent conversation context
        if (recentConversations.length > 0) {
            summary += `Recent conversation flow: `;
            recentConversations.forEach((conv, index) => {
                summary += `[${index + 1}] User: "${conv.message}" → Chizuru: "${conv.response}". `;
            });
        }

        return summary;
    }

    // --- Embeddings & Retrieval ---
    async embedText(text) {
        try {
            const output = await this.hf.featureExtraction({
                model: 'sentence-transformers/all-MiniLM-L6-v2',
                inputs: text
            });

            // Normalize output to 1D vector
            if (Array.isArray(output) && Array.isArray(output[0])) {
                // If it's token-level, average pool
                const tokenVectors = output;
                const dim = tokenVectors[0].length;
                const sum = new Array(dim).fill(0);
                for (const vec of tokenVectors) {
                    for (let i = 0; i < dim; i++) sum[i] += vec[i];
                }
                return sum.map(v => v / tokenVectors.length);
            }
            return output;
        } catch (e) {
            console.error('Embedding error:', e.message);
            return null;
        }
    }

    async addEmbedding(userId, text) {
        if (!this.memory[userId]) {
            this.memory[userId] = {};
        }
        if (!this.memory[userId].embeddings) {
            this.memory[userId].embeddings = [];
        }
        const vector = await this.embedText(text);
        if (!vector) return;
        this.memory[userId].embeddings.push({
            vector,
            text,
            timestamp: Date.now()
        });
        // Cap to last 200 entries
        if (this.memory[userId].embeddings.length > 200) {
            this.memory[userId].embeddings.shift();
        }
        // No dirty flag since we're not saving to file
    }

    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return -1;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
        return dot / denom;
    }

    async searchRelevantContext(userId, query, topK = 3) {
        const store = this.memory[userId];
        if (!store || !store.embeddings || store.embeddings.length === 0) return [];
        const qv = await this.embedText(query);
        if (!qv) return [];
        const scored = store.embeddings.map(item => ({
            text: item.text,
            score: this.cosineSimilarity(qv, item.vector),
            timestamp: item.timestamp
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK).map(s => s.text);
    }

    // --- User Profile Summarization ---
    getUserProfile(userId) {
        return this.memory[userId]?.userProfile || null;
    }

    async updateUserProfileFromLLM(userId) {
        try {
            if (!this.memory[userId]) this.memory[userId] = {};
            const raw = (this.memory[userId].rawMessages || []).slice(-20);
            const conv = this.getRecentConversations(userId, 10);
            const prompt = `You are an assistant that extracts a persistent user profile from chat logs.\n` +
                `Return strict JSON only. Keys: name (string|null), preferences (string[]), dislikes (string[]), facts (string[]), toneTips (string[]), summary (string).\n` +
                `Be concise and avoid guessing. If unknown, use null or empty array.\n\n` +
                `Recent user messages:\n` + raw.map((m, i) => `[${i+1}] ${m.content}`).join('\n') + `\n\n` +
                `Recent conversation turns:\n` + conv.map((c, i) => `[${i+1}] U: ${c.message} | A: ${c.response}`).join('\n');

            const completion = await this.hf.chatCompletion({
                provider: 'fireworks-ai',
                model: 'openai/gpt-oss-120b',
                messages: [{ role: 'user', content: prompt }]
            });
            let content = completion.choices?.[0]?.message?.content || '';
            // Extract JSON
            let jsonStr = content;
            const first = content.indexOf('{');
            const last = content.lastIndexOf('}');
            if (first !== -1 && last !== -1) {
                jsonStr = content.substring(first, last + 1);
            }
            let profile = null;
            try { profile = JSON.parse(jsonStr); } catch (e) {
                console.error('Failed to parse profile JSON');
                return;
            }
            this.memory[userId].userProfile = {
                ...profile,
                lastUpdated: Date.now()
            };
            if (!this.memory[userId].profileUpdate) {
                this.memory[userId].profileUpdate = { lastUpdated: 0, messagesSinceUpdate: 0 };
            }
            this.memory[userId].profileUpdate.lastUpdated = Date.now();
            this.memory[userId].profileUpdate.messagesSinceUpdate = 0;
            console.log(`[MEMORY] Updated user profile for ${userId}`);
            // No dirty flag since we're not saving to file
        } catch (e) {
            console.error('Profile update error:', e.message);
        }
    }

    async maybeUpdateUserProfile(userId) {
        const info = this.memory[userId]?.profileUpdate;
        const now = Date.now();
        const dueByCount = (info?.messagesSinceUpdate || 0) >= 5;
        const dueByTime = !info || (now - (info.lastUpdated || 0)) > (15 * 60 * 1000);
        if (dueByCount || dueByTime) {
            await this.updateUserProfileFromLLM(userId);
        }
    }

    // --- Profile helpers & data management ---
    getUserProfileText(userId) {
        const p = this.getUserProfile(userId);
        if (!p) return 'No profile stored yet.';
        const name = p.name || 'Unknown';
        const prefs = Array.isArray(p.preferences) && p.preferences.length > 0 ? p.preferences.join(', ') : '—';
        const dislikes = Array.isArray(p.dislikes) && p.dislikes.length > 0 ? p.dislikes.join(', ') : '—';
        const facts = Array.isArray(p.facts) && p.facts.length > 0 ? p.facts.join(', ') : '—';
        const tips = Array.isArray(p.toneTips) && p.toneTips.length > 0 ? p.toneTips.join(', ') : '—';
        const summary = p.summary || '—';
        return `Name: ${name}\nPreferences: ${prefs}\nDislikes: ${dislikes}\nFacts: ${facts}\nTone tips: ${tips}\nSummary: ${summary}`;
    }

    deleteUserMemory(userId) {
        if (this.memory[userId]) {
            delete this.memory[userId];
            // No dirty flag since we're not saving to file
            console.log(`[MEMORY] Deleted memory for user ${userId}`);
        }
    }

    // Cleanup old data (older than 30 days)
    cleanup() {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        let cleanedCount = 0;

        for (const userId in this.memory) {
            const userData = this.memory[userId];
            let hasRecentData = false;

            // Check if user has recent activity
            if (userData.conversations && userData.conversations.length > 0) {
                const lastActivity = userData.conversations[userData.conversations.length - 1].timestamp;
                if (lastActivity > thirtyDaysAgo) {
                    hasRecentData = true;
                }
            }

            // Check other user info timestamps
            for (const key in userData) {
                if (key !== 'conversations' && userData[key].timestamp > thirtyDaysAgo) {
                    hasRecentData = true;
                    break;
                }
            }

            // Remove user data if no recent activity
            if (!hasRecentData) {
                delete this.memory[userId];
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} inactive users from memory`);
        }
    }

    // Shutdown (no file saving)
    shutdown() {
        // No auto-save interval to clear
        // No file saving
        console.log('💾 Memory manager shutdown, memory cleared from RAM');
    }
}

module.exports = MemoryManager;
