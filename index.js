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

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent
    ]
});

client.on('ready', () => {
    console.log('Mizuku hello oni chan >.< ');
    console.log(`Logged in as ${client.user.tag}`);
    console.log('Bot is now running on Render! 🚀');
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

client.on('messageCreate', async (message) => {
    if(message.author.bot) return;
    if(message.content.startsWith(IGNORE_PREFIX)) return;
    if(!CHANNELS.includes(message.channelId) && !message.mentions.users.has(client.user.id)) return;
    
    // Add message to history
    addToHistory(message.author.id, message.content);
    
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
            
            const previousMsg = getPreviousMessage(message.author.id);
            if (previousMsg) {
                const response = `Tin nhắn trước của bạn là: "${previousMsg.content}"})`;
                message.reply(response);
                clearInterval(sendTypingInterval);
                return;
            } else {
                const response = "Anh chưa có tin nhắn trước đó hoặc đây là tin nhắn đầu tiên của anh đó >///<.";
                message.reply(response);
                clearInterval(sendTypingInterval);
                return;
            }
        }
        
        const prompt = `Bạn là Mizuhara Chizuru, một trong những waifu của Makus. 

QUY TẮC QUAN TRỌNG:
- LUÔN LUÔN trả lời bằng TIẾNG VIỆT trước tiên
- Nếu người dùng hỏi bằng tiếng Việt, phải trả lời 100% bằng tiếng Việt
- Nếu người dùng hỏi bằng tiếng Anh, trả lời chính bằng tiếng anh

Hãy trả lời câu hỏi này: ${message.content}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log('Gemini response:', text);
        message.reply(text);
        
        // Clear typing indicator after successful response
        clearInterval(sendTypingInterval);
    } catch (error) {
        console.error('Error details:', error.message);
        console.error('Error:', error);
        message.reply(`Error: ${error.message}`);
        
        // Clear typing indicator on error
        clearInterval(sendTypingInterval);
    }
});

// Start the bot
client.login(process.env.TOKEN);