require('dotenv/config');
const { Client, IntentsBitField } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Check if required environment variables exist
if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY not found in .env file');
    process.exit(1);
}

if (!process.env.TOKEN) {
    console.error('Error: TOKEN not found in .env file');
    process.exit(1);
}

// Check if another instance is already running
const fs = require('fs');
const path = require('path');
const pidFile = path.join(__dirname, 'bot.pid');

if (fs.existsSync(pidFile)) {
    const existingPid = fs.readFileSync(pidFile, 'utf8');
    try {
        // Check if the existing PID is actually running
        process.kill(existingPid, 0);
        console.error(`❌ ERROR: Another bot instance is already running with PID ${existingPid}`);
        console.error('Please stop the existing instance first or delete bot.pid file');
        console.error('To stop existing instance, run: taskkill /PID ' + existingPid + ' /F');
        process.exit(1);
    } catch (e) {
        // PID doesn't exist, safe to continue
        console.log('✅ Previous instance not found, continuing...');
    }
}

// Write current PID to file
fs.writeFileSync(pidFile, process.pid.toString());
console.log(`🚀 Bot PID: ${process.pid}`);
console.log(`📁 PID file: ${pidFile}`);

// Clean up PID file on exit
process.on('exit', () => {
    console.log('🔄 Cleaning up PID file...');
    if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
        console.log('✅ PID file cleaned up');
    }
});

process.on('SIGINT', () => {
    console.log('🔄 Received SIGINT, shutting down gracefully...');
    if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
        console.log('✅ PID file cleaned up');
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🔄 Received SIGTERM, shutting down gracefully...');
    if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
        console.log('✅ PID file cleaned up');
    }
    process.exit(0);
});

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ]
});

// Rate limiting and quota management
const DAILY_LIMIT = 45; // Set to 45 to be safe (API limit is 50)
const requestCount = {
    count: 0,
    lastReset: new Date().toDateString(),
    resetDaily: function() {
        const today = new Date().toDateString();
        if (today !== this.lastReset) {
            this.count = 0;
            this.lastReset = today;
            console.log('Daily request count reset');
        }
    }
};

// Anti-spam protection
const userCooldowns = new Map(); // userId -> lastRequestTime
const COOLDOWN_TIME = 3000; // 3 seconds cooldown between requests
const PROCESSING_USERS = new Set(); // Track users currently being processed
const SENT_MESSAGES = new Set(); // Track recently sent messages to prevent duplicates
const RESPONDED_MESSAGES = new Set(); // Track which messages we've already responded to

// Fallback responses when API is unavailable
const fallbackResponses = [
    "😅 Sorry I'm having some technical issues right now. Could you try again in a few minutes?",
];

client.on('ready', () => {
    const botId = Math.random().toString(36).substring(7);
    console.log('Mizuku hello oni chan >.< ');
});

const IGNORE_PREFIX ="!";
const CHANNELS = ['1289441625399099392']

// Message history storage
const messageHistory = new Map(); // userId -> array of messages

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Function to add message to history
function addToHistory(userId, message) {
    if (!messageHistory.has(userId)) {
        messageHistory.set(userId, []);
    }
    
    const userHistory = messageHistory.get(userId);
    userHistory.push({
        content: message,
        timestamp: Date.now()
    });
    
    // Keep only last 10 messages to avoid memory issues
    if (userHistory.length > 10) {
        userHistory.shift();
    }
}

// Function to get previous message
function getPreviousMessage(userId) {
    if (!messageHistory.has(userId)) {
        return null;
    }
    
    const userHistory = messageHistory.get(userId);
    if (userHistory.length < 2) {
        return null;
    }
    
    return userHistory[userHistory.length - 2]; // Get second to last message
}

// Function to get random fallback response
function getFallbackResponse() {
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
}

// Function to check if we can make API requests
function canMakeRequest() {
    requestCount.resetDaily();
    return requestCount.count < DAILY_LIMIT;
}

// Function to increment request count
function incrementRequestCount() {
    requestCount.count++;
    console.log(`API requests today: ${requestCount.count}/${DAILY_LIMIT}`);
}

// Function to check if user is on cooldown
function isUserOnCooldown(userId) {
    if (!userCooldowns.has(userId)) return false;
    
    const lastRequest = userCooldowns.get(userId);
    const timeSinceLastRequest = Date.now() - lastRequest;
    
    return timeSinceLastRequest < COOLDOWN_TIME;
}

// Function to set user cooldown
function setUserCooldown(userId) {
    userCooldowns.set(userId, Date.now());
}

// Function to check if user is already being processed
function isUserBeingProcessed(userId) {
    return PROCESSING_USERS.has(userId);
}

// Function to mark user as being processed
function markUserAsProcessing(userId) {
    PROCESSING_USERS.add(userId);
}

// Function to unmark user as being processed
function unmarkUserAsProcessing(userId) {
    PROCESSING_USERS.delete(userId);
}

// Function to check if message content is duplicate
function isDuplicateMessage(content) {
    return SENT_MESSAGES.has(content);
}

// Function to mark message as sent
function markMessageAsSent(content) {
    SENT_MESSAGES.add(content);
    
    // Remove from set after 10 seconds to prevent memory issues
    setTimeout(() => {
        SENT_MESSAGES.delete(content);
    }, 10000);
}

// Function to check if we've already responded to this message
function hasRespondedToMessage(messageId) {
    return RESPONDED_MESSAGES.has(messageId);
}

// Function to mark message as responded
function markMessageAsResponded(messageId) {
    RESPONDED_MESSAGES.add(messageId);
    
    // Remove from set after 30 seconds to prevent memory issues
    setTimeout(() => {
        RESPONDED_MESSAGES.delete(messageId);
    }, 30000);
}

client.on('messageCreate', async (message) => {
    // Add unique identifier for this message processing
    const processingId = `${message.id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log(`[${processingId}] Processing message: ${message.content} from ${message.author.tag}`);
    
    if(message.author.bot) {
        console.log(`[${processingId}] Ignoring bot message`);
        return;
    }
    if(message.content.startsWith(IGNORE_PREFIX)) {
        console.log(`[${processingId}] Ignoring prefixed message`);
        return;
    }
    if(!CHANNELS.includes(message.channelId) && !message.mentions.users.has(client.user.id)) {
        console.log(`[${processingId}] Ignoring message from non-monitored channel`);
        return;
    }
    
    const userId = message.author.id;
    const messageId = message.id;
    
    console.log(`[${processingId}] Message ID: ${messageId}, User ID: ${userId}`);
    
    // CRITICAL: Check if we've already responded to this exact message
    if (hasRespondedToMessage(messageId)) {
        console.log(`[${processingId}] Already responded to message ${messageId}, ignoring duplicate`);
        return;
    }
    
    // Anti-spam protection
    if (isUserOnCooldown(userId)) {
        const remainingCooldown = Math.ceil((COOLDOWN_TIME - (Date.now() - userCooldowns.get(userId))) / 1000);
        message.reply(`⏰ Sorry, I need ${remainingCooldown} seconds to process your previous message. Please wait a moment!`);
        markMessageAsResponded(messageId);
        return;
    }
    
    // Prevent duplicate processing
    if (isUserBeingProcessed(userId)) {
        message.reply(`💕 Hey there, I'm still processing your previous message. Please wait a moment!`);
        markMessageAsResponded(messageId);
        return;
    }
    
    // Prevent duplicate message content processing
    if (isDuplicateMessage(message.content)) {
        message.reply(`🔄 Hey, I just received a similar message. Please wait for me to finish processing!`);
        markMessageAsResponded(messageId);
        return;
    }
    
    // Mark user as being processed
    markUserAsProcessing(userId);
    
    // Add message to history
    addToHistory(userId, message.content);
    
    await message.channel.sendTyping();

    const sendTypingInterval = setInterval(() => {
        message.channel.sendTyping();
    }, 5000);
    
    try {
        console.log('Sending message to Gemini:', message.content);
        
        // Check if user is asking about previous message
        if (message.content.toLowerCase().includes('previous message') || 
            message.content.toLowerCase().includes('tin nhắn trước') ||
            message.content.toLowerCase().includes('câu trước')) {
            
            const previousMsg = getPreviousMessage(userId);
            if (previousMsg) {
                const response = `Your previous message was: "${previousMsg.content}"`;
                message.reply(response);
                markMessageAsResponded(messageId);
                clearInterval(sendTypingInterval);
                setUserCooldown(userId);
                unmarkUserAsProcessing(userId);
                return;
            } else {
                const response = "You don't have any previous messages or this is your first message >///<.";
                message.reply(response);
                markMessageAsResponded(messageId);
                clearInterval(sendTypingInterval);
                setUserCooldown(userId);
                unmarkUserAsProcessing(userId);
                return;
            }
        }
        
        // Check if we can make API requests
        if (!canMakeRequest()) {
            const remainingTime = getTimeUntilReset();
            message.reply(`😅 Sorry, I've reached my daily API quota! Please try again tomorrow. (Daily API limit reached)\n⏰ Time remaining: ${remainingTime}`);
            markMessageAsResponded(messageId);
            clearInterval(sendTypingInterval);
            setUserCooldown(userId);
            unmarkUserAsProcessing(userId);
            return;
        }
        
        const prompt = `You are Mizuhara Chizuru, one of Makus' waifus. 

IMPORTANT RULES:
- ALWAYS respond in VIETNAMESE
- Only respond once
- If the user asks in English, still respond in Vietnamese
- Do not respond in two languages at the same time

Please answer this question: ${message.content}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log('Gemini response:', text);
        message.reply(text);
        
        // Mark message as responded to prevent duplicates
        markMessageAsResponded(messageId);
        
        // Mark message as sent to prevent duplicates
        markMessageAsSent(message.content);
        
        // Increment request count after successful response
        incrementRequestCount();
        
        // Clear typing indicator after successful response
        clearInterval(sendTypingInterval);
        
        // Set cooldown and unmark user
        setUserCooldown(userId);
        unmarkUserAsProcessing(userId);
        
    } catch (error) {
        console.error('Error details:', error.message);
        console.error('Error:', error);
        
        // Handle specific error types with user-friendly messages
        if (error.message.includes('429') || error.message.includes('quota')) {
            requestCount.count = DAILY_LIMIT; // Mark as quota exceeded
            const remainingTime = getTimeUntilReset();
            message.reply(`😅 Sorry, I've reached my daily API quota! Please try again tomorrow. (Daily API limit reached)\n⏰ Time remaining: ${remainingTime}`);
            markMessageAsResponded(messageId);
        } else if (error.message.includes('503') || error.message.includes('overloaded')) {
            message.reply(`😰 The server is overloaded, please try again in a few minutes! (Server overloaded, please try again later)`);
            markMessageAsResponded(messageId);
        } else if (error.message.includes('500') || error.message.includes('internal')) {
            message.reply(`💕 ${getFallbackResponse()}`);
            markMessageAsResponded(messageId);
        } else {
            message.reply(`❌ An error occurred: ${error.message}`);
            markMessageAsResponded(messageId);
        }
        
        // Clear typing indicator on error
        clearInterval(sendTypingInterval);
        
        // Set cooldown and unmark user even on error
        setUserCooldown(userId);
        unmarkUserAsProcessing(userId);
    }
});

// Function to calculate time until reset
function getTimeUntilReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const diff = tomorrow - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours} hours ${minutes} minutes`;
}

// Log daily stats every hour
setInterval(() => {
    requestCount.resetDaily();
    console.log(`Current API usage: ${requestCount.count}/${DAILY_LIMIT}`);
}, 60 * 60 * 1000); // Every hour

// Clean up old cooldowns every 5 minutes to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [userId, lastRequest] of userCooldowns.entries()) {
        if (now - lastRequest > COOLDOWN_TIME * 2) { // Remove cooldowns older than 2x cooldown time
            userCooldowns.delete(userId);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} old cooldowns`);
    }
}, 5 * 60 * 1000); // Every 5 minutes

// Start the bot
client.login(process.env.TOKEN);