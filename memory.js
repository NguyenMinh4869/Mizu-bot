const fs = require('fs');
const path = require('path');

class MemoryManager {
    constructor() {
        this.memoryFile = 'bot_memory.json';
        this.memory = this.loadMemory();
        this.autoSaveInterval = setInterval(() => this.saveMemory(), 30000); // Auto-save every 30 seconds
    }

    loadMemory() {
        try {
            if (fs.existsSync(this.memoryFile)) {
                const data = fs.readFileSync(this.memoryFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading memory:', error);
        }
        return {};
    }

    saveMemory() {
        try {
            fs.writeFileSync(this.memoryFile, JSON.stringify(this.memory, null, 2));
            console.log('💾 Memory saved successfully');
        } catch (error) {
            console.error('Error saving memory:', error);
        }
    }

    // Store user information
    setUserInfo(userId, key, value) {
        if (!this.memory[userId]) {
            this.memory[userId] = {};
        }
        this.memory[userId][key] = {
            value: value,
            timestamp: Date.now()
        };
        console.log(`[MEMORY] Stored ${key} for user ${userId}: ${value}`);
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
        
        // Let AI figure out what's important instead of hard-coded extraction
        console.log(`[MEMORY] Stored message for user ${userId}: ${message.substring(0, 50)}...`);
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

    // Shutdown and save memory
    shutdown() {
        clearInterval(this.autoSaveInterval);
        this.saveMemory();
        console.log('💾 Memory manager shutdown, memory saved');
    }
}

module.exports = MemoryManager;
