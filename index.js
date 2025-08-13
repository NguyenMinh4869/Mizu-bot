require('dotenv/config');
const { Client, IntentsBitField } = require('discord.js');
const { InferenceClient } = require('@huggingface/inference');
const MemoryManager = require('./memory.js');
const fs = require('fs');
const path = require('path');

// Configuration constants
const CONFIG = {
    DAILY_LIMIT: 999999, // Unlimited for Hugging Face
    COOLDOWN_TIME: 3000,
    TYPING_INTERVAL: 5000,
    MEMORY_CLEANUP_INTERVAL: 5 * 60 * 1000,
    STATS_LOG_INTERVAL: 60 * 60 * 1000,
    MAX_MESSAGE_HISTORY: 10,
    DUPLICATE_MESSAGE_TTL: 10000,
    RESPONDED_MESSAGE_TTL: 30000,
    IGNORE_PREFIX: "!",
    CHANNELS: ['1289441625399099392'],
    PID_FILE: 'bot.pid'
};

// Environment validation
const validateEnvironment = () => {
    const requiredVars = ['HF_TOKEN', 'TOKEN'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
        console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
};

// Process management
class ProcessManager {
    constructor(pidFile) {
        this.pidFile = pidFile;
        this.setupProcessHandlers();
    }

    checkExistingInstance() {
        if (!fs.existsSync(this.pidFile)) return false;
        
        try {
            const existingPid = fs.readFileSync(this.pidFile, 'utf8');
            process.kill(existingPid, 0);
            console.error(`❌ Another bot instance is already running with PID ${existingPid}`);
            console.error('Please stop the existing instance first or delete bot.pid file');
            console.error(`To stop existing instance, run: taskkill /PID ${existingPid} /F`);
            process.exit(1);
        } catch (e) {
            console.log('✅ Previous instance not found, continuing...');
            return false;
        }
    }

    writePid() {
        fs.writeFileSync(this.pidFile, process.pid.toString());
        console.log(`🚀 Bot PID: ${process.pid}`);
        console.log(`📁 PID file: ${this.pidFile}`);
    }

    cleanup() {
        if (fs.existsSync(this.pidFile)) {
            fs.unlinkSync(this.pidFile);
            console.log('✅ PID file cleaned up');
        }
    }

    setupProcessHandlers() {
        const cleanupAndExit = () => {
            console.log('🔄 Shutting down gracefully...');
            this.cleanup();
            if (this.memoryManager) {
                this.memoryManager.shutdown();
            }
            if (global.mizuBotInstance === this) {
                global.mizuBotInstance = null;
            }
            process.exit(0);
        };

        process.on('exit', () => this.cleanup());
        process.on('SIGINT', cleanupAndExit);
        process.on('SIGTERM', cleanupAndExit);
    }
}

// Rate limiting and quota management
class RateLimiter {
    constructor(dailyLimit) {
        this.dailyLimit = dailyLimit;
        this.requestCount = {
            count: 0,
            lastReset: new Date().toDateString()
        };
    }

    resetDaily() {
        const today = new Date().toDateString();
        if (today !== this.requestCount.lastReset) {
            this.requestCount.count = 0;
            this.requestCount.lastReset = today;
            console.log('Daily request count reset');
        }
    }

    canMakeRequest() {
        this.resetDaily();
        return this.requestCount.count < this.dailyLimit;
    }

    incrementCount() {
        this.requestCount.count++;
        console.log(`API requests today: ${this.requestCount.count}/${this.dailyLimit}`);
    }

    getTimeUntilReset() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        const diff = tomorrow - now;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        return `${hours} hours ${minutes} minutes`;
    }
}

// Anti-spam protection
class SpamProtection {
    constructor(cooldownTime) {
        this.cooldownTime = cooldownTime;
        this.userCooldowns = new Map();
        this.processingUsers = new Set();
        this.sentMessages = new Set();
        this.respondedMessages = new Set();
    }

    isUserOnCooldown(userId) {
        if (!this.userCooldowns.has(userId)) return false;
        
        const lastRequest = this.userCooldowns.get(userId);
        const timeSinceLastRequest = Date.now() - lastRequest;
        
        return timeSinceLastRequest < this.cooldownTime;
    }

    getRemainingCooldown(userId) {
        if (!this.userCooldowns.has(userId)) return 0;
        
        const lastRequest = this.userCooldowns.get(userId);
        const timeSinceLastRequest = Date.now() - lastRequest;
        
        return Math.ceil((this.cooldownTime - timeSinceLastRequest) / 1000);
    }

    setUserCooldown(userId) {
        this.userCooldowns.set(userId, Date.now());
    }

    isUserBeingProcessed(userId) {
        return this.processingUsers.has(userId);
    }

    markUserAsProcessing(userId) {
        this.processingUsers.add(userId);
    }

    unmarkUserAsProcessing(userId) {
        this.processingUsers.delete(userId);
    }

    isDuplicateMessage(content) {
        return this.sentMessages.has(content);
    }

    markMessageAsSent(content) {
        this.sentMessages.add(content);
        
        setTimeout(() => {
            this.sentMessages.delete(content);
        }, CONFIG.DUPLICATE_MESSAGE_TTL);
    }

    hasRespondedToMessage(messageId) {
        return this.respondedMessages.has(messageId);
    }

    markMessageAsResponded(messageId) {
        this.respondedMessages.add(messageId);
        
        setTimeout(() => {
            this.respondedMessages.delete(messageId);
        }, CONFIG.RESPONDED_MESSAGE_TTL);
    }

    cleanup() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [userId, lastRequest] of this.userCooldowns.entries()) {
            if (now - lastRequest > this.cooldownTime * 2) {
                this.userCooldowns.delete(userId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`Cleaned up ${cleanedCount} old cooldowns`);
        }
    }
}

// Message history management
class MessageHistory {
    constructor(maxHistory = CONFIG.MAX_MESSAGE_HISTORY) {
        this.maxHistory = maxHistory;
        this.history = new Map();
    }

    addMessage(userId, message) {
        if (!this.history.has(userId)) {
            this.history.set(userId, []);
        }
        
        const userHistory = this.history.get(userId);
        userHistory.push({
            content: message,
            timestamp: Date.now()
        });
        
        if (userHistory.length > this.maxHistory) {
            userHistory.shift();
        }
    }

    getPreviousMessage(userId) {
        if (!this.history.has(userId)) return null;
        
        const userHistory = this.history.get(userId);
        if (userHistory.length < 2) return null;
        
        return userHistory[userHistory.length - 2];
    }
}

// AI service
class AIService {
    constructor(apiKey, memoryManager = null) {
        this.client = new InferenceClient(apiKey);
        this.memoryManager = memoryManager;
    }

    async generateResponse(message, userId = null) {
        let contextInfo = '';
        if (userId && this.memoryManager) {
            contextInfo = this.memoryManager.getConversationSummary(userId);
        }
        
        const prompt = `You are Mizuhara Chizuru, one of Maku's waifus. 

IMPORTANT RULES:
- RESPOND IN THE SAME LANGUAGE AS THE USER'S MESSAGE
- If user writes in Vietnamese → respond in Vietnamese
- If user writes in English → respond in English
- If user writes in both languages → respond in the main language used
- Be cute and shy like Chizuru
- Use emoticons like >///<, >.<, ^^, >.0
- Be helpful but sometimes tsundere
- Only respond once
- Keep responses natural and conversational

MEMORY INSTRUCTIONS:
- Carefully read the USER CONTEXT below
- Learn and remember important information about the user naturally
- Remember names, preferences, personal details, and conversation history
- Use this information to make responses more personal and contextual
- Don't ask for information the user has already told you

USER CONTEXT: ${contextInfo}

Please answer this question: ${message}`;
        
        try {
            const chatCompletion = await this.client.chatCompletion({
                provider: "fireworks-ai",
                model: "openai/gpt-oss-120b",
                messages: [
                    {
                        role: "user",
                        content: prompt,
                    },
                ],
            });
            
            return chatCompletion.choices[0].message.content;
        } catch (error) {
            console.error('Hugging Face AI Error:', error);
            throw new Error(`AI service error: ${error.message}`);
        }
    }
}

// Error handler
class ErrorHandler {
    static getFallbackResponse() {
        const fallbackResponses = [
            "😅 Sorry I'm having some technical issues right now. Could you try again in a few minutes?",
        ];
        return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
    }

    static handleError(error, message, messageId) {
        console.error('Error details:', error.message);
        console.error('Error:', error);
        
        let response;
        
        if (error.message.includes('429') || error.message.includes('quota')) {
            response = `😅 Hugging Face API rate limit reached! Please try again in a few minutes.`;
        } else if (error.message.includes('503') || error.message.includes('overloaded')) {
            response = `😰 The server is overloaded, please try again in a few minutes!`;
        } else if (error.message.includes('500') || error.message.includes('internal')) {
            response = `💕 ${this.getFallbackResponse()}`;
        } else {
            response = `❌ An error occurred: ${error.message}`;
        }
        
        message.reply(response);
        return response;
    }
}

// Main bot class
class MizuBot {
    constructor() {
        // Ensure only one instance
        if (global.mizuBotInstance) {
            console.error('❌ Another MizuBot instance already exists!');
            process.exit(1);
        }
        global.mizuBotInstance = this;
        
        this.client = new Client({
            intents: [
                IntentsBitField.Flags.Guilds,
                IntentsBitField.Flags.GuildMembers,
                IntentsBitField.Flags.GuildMessages,
                IntentsBitField.Flags.MessageContent
            ]
        });
        
        this.processManager = new ProcessManager(CONFIG.PID_FILE);
        this.rateLimiter = new RateLimiter(CONFIG.DAILY_LIMIT);
        this.spamProtection = new SpamProtection(CONFIG.COOLDOWN_TIME);
        this.memoryManager = new MemoryManager();
        this.aiService = new AIService(process.env.HF_TOKEN, this.memoryManager);
        
        this.setupEventHandlers();
        this.setupIntervals();
    }

    setupEventHandlers() {
        this.client.on('ready', () => {
            console.log('Mizuku hello oni chan >.< ');
        });

        this.client.on('messageCreate', this.handleMessage.bind(this));
    }

    setupIntervals() {
        // Log daily stats every hour
        setInterval(() => {
            this.rateLimiter.resetDaily();
            console.log(`Current API usage: ${this.rateLimiter.requestCount.count}/${CONFIG.DAILY_LIMIT}`);
        }, CONFIG.STATS_LOG_INTERVAL);

        // Clean up old cooldowns every 5 minutes
        setInterval(() => {
            this.spamProtection.cleanup();
        }, CONFIG.MEMORY_CLEANUP_INTERVAL);
    }

    async handleMessage(message) {
        const processingId = `${message.id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        console.log(`[${processingId}] Processing message: ${message.content} from ${message.author.tag}`);
        
        // Early returns for ignored messages
        if (this.shouldIgnoreMessage(message)) {
            console.log(`[${processingId}] Ignoring message`);
            return;
        }
        
        const userId = message.author.id;
        const messageId = message.id;
        
        // Check if already responded (early check)
        if (this.spamProtection.hasRespondedToMessage(messageId)) {
            console.log(`[${processingId}] Already responded to message ${messageId}, ignoring duplicate`);
            return;
        }
        
        // Anti-spam checks
        if (this.spamProtection.isUserOnCooldown(userId)) {
            const remainingCooldown = this.spamProtection.getRemainingCooldown(userId);
            message.reply(`⏰ Sorry, I need ${remainingCooldown} seconds to process your previous message. Please wait a moment!`);
            this.spamProtection.markMessageAsResponded(messageId);
            return;
        }
        
        if (this.spamProtection.isUserBeingProcessed(userId)) {
            message.reply(`💕 Hey there, I'm still processing your previous message. Please wait a moment!`);
            this.spamProtection.markMessageAsResponded(messageId);
            return;
        }
        
        if (this.spamProtection.isDuplicateMessage(message.content)) {
            message.reply(`🔄 Hey, I just received a similar message. Please wait for me to finish processing!`);
            this.spamProtection.markMessageAsResponded(messageId);
            return;
        }
        
        // Mark user as being processed
        this.spamProtection.markUserAsProcessing(userId);
        
        // Process message for memory extraction
        this.memoryManager.processMessage(userId, message.content);
        
        // Start typing indicator
        const typingInterval = this.startTypingIndicator(message.channel);
        
        try {
            await this.processMessage(message, userId, messageId, typingInterval);
        } catch (error) {
            await this.handleProcessingError(error, message, messageId, typingInterval);
        } finally {
            this.spamProtection.setUserCooldown(userId);
            this.spamProtection.unmarkUserAsProcessing(userId);
        }
    }

    shouldIgnoreMessage(message) {
        return message.author.bot ||
               message.content.startsWith(CONFIG.IGNORE_PREFIX) ||
               (!CONFIG.CHANNELS.includes(message.channelId) && !message.mentions.users.has(this.client.user.id));
    }

    startTypingIndicator(channel) {
        channel.sendTyping();
        return setInterval(() => {
            channel.sendTyping();
        }, CONFIG.TYPING_INTERVAL);
    }

    async processMessage(message, userId, messageId, typingInterval) {
        // Handle previous message requests
        if (this.isPreviousMessageRequest(message.content)) {
            await this.handlePreviousMessageRequest(message, userId, messageId, typingInterval);
            return;
        }
        
        // Generate AI response with user context
        const response = await this.aiService.generateResponse(message.content, userId);
        
        // Send response and update tracking
        message.reply(response);
        
        // Store conversation in memory
        this.memoryManager.addConversation(userId, message.content, response);
        
        this.spamProtection.markMessageAsResponded(messageId);
        this.spamProtection.markMessageAsSent(message.content);
        this.rateLimiter.incrementCount();
        
        clearInterval(typingInterval);
    }

    isPreviousMessageRequest(content) {
        const keywords = ['previous message', 'tin nhắn trước', 'câu trước'];
        return keywords.some(keyword => content.toLowerCase().includes(keyword));
    }

    async handlePreviousMessageRequest(message, userId, messageId, typingInterval) {
        const recentConversations = this.memoryManager.getRecentConversations(userId, 1);
        const response = recentConversations.length > 0 
            ? `Your previous message was: "${recentConversations[0].message}"`
            : "You don't have any previous messages or this is your first message >///<.";
        
        message.reply(response);
        this.spamProtection.markMessageAsResponded(messageId);
        clearInterval(typingInterval);
    }

    async handleProcessingError(error, message, messageId, typingInterval) {
        if (error.message.includes('429') || error.message.includes('quota')) {
            this.rateLimiter.requestCount.count = CONFIG.DAILY_LIMIT;
        }
        
        ErrorHandler.handleError(error, message, messageId);
        clearInterval(typingInterval);
    }

    start() {
        this.processManager.checkExistingInstance();
        this.processManager.writePid();
        this.client.login(process.env.TOKEN);
    }
}

// Main execution
const main = () => {
    try {
        validateEnvironment();
        const bot = new MizuBot();
        bot.start();
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
};

main();