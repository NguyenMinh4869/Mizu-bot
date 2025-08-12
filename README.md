# 🤖 Mizu-bot - Discord AI Bot

An intelligent Discord bot powered by Google Gemini AI to chat with users. The bot is designed with the personality of Mizuhara Chizuru from the anime Rent-a-Girlfriend.

## ✨ Features

- 🤖 **AI Chat**: Intelligent conversations with Google Gemini AI
- 🌏 **Multi-language**: Support for Vietnamese and English
- 💬 **Message History**: Remembers previous messages from users
- ⌨️ **Typing Indicator**: Shows when the bot is typing
- 🎭 **Personality**: Lovable Mizuhara Chizuru character
- 🔒 **Secure**: API keys are safely protected

## 🚀 Installation

### System Requirements
- Node.js v16.0.0 or higher
- npm or yarn
- Discord Bot Token
- Google Gemini API Key

### Step 1: Clone repository
```bash
git clone https://github.com/your-username/Mizu-bot.git
cd Mizu-bot
```

### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Create .env file
Create a `.env` file in the root directory with the following content:
```env
TOKEN=your_discord_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### Step 4: Run the bot
```bash
npm start
# or
node index.js
```

## 🔧 Configuration

### Discord Bot Setup
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" tab and copy the token
4. Add the bot to your server with permissions:
   - Send Messages
   - Read Message History
   - Use Slash Commands

### Google Gemini API
1. Visit [Google AI Studio](https://aistudio.google.com/)
2. Create a new API key
3. Copy the key to your `.env` file

### Channel Configuration
In `index.js`, update the `CHANNELS` array with the IDs of channels where you want the bot to operate:
```javascript
const CHANNELS = ['your_channel_id_here']
```

## 📚 Usage

### Basic Commands
- **Chat**: Simply send normal messages
- **View previous message**: Type "what was my previous message" or "tin nhắn trước"
- **Ignore**: Messages starting with `!` will be ignored

### AI Features
The bot will automatically:
- Analyze message context
- Respond in Vietnamese (priority)
- Maintain Mizuhara Chizuru's personality
- Remember conversation history

## 🚀 Deployment

### Render (Recommended)
1. Sign up at [Render.com](https://render.com)
2. Create "New Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Add Environment Variables:
   - `TOKEN`: Discord bot token
   - `GEMINI_API_KEY`: Gemini API key
6. Deploy

### Railway
1. Sign up at [Railway.app](https://railway.app)
2. Deploy from GitHub
3. Set environment variables
4. Bot will run 24/7

### VPS/Server
```bash
# Install PM2
npm install -g pm2

# Run bot with PM2
pm2 start index.js --name mizu-bot

# Auto-start on reboot
pm2 startup
pm2 save
```

## 📁 Project Structure

```
Mizu-bot/
├── index.js              # Main bot file
├── package.json          # Dependencies and scripts
├── .env                  # Environment variables (local)
├── .gitignore           # Git ignore rules
├── README.md            # This documentation
└── node_modules/        # Dependencies (auto-generated)
```

## 🔒 Security

- **DO NOT commit** `.env` file to GitHub
- **DO NOT share** API keys with others
- Use `.gitignore` to protect sensitive information
- Environment variables are set in hosting platform

## 🐛 Troubleshooting

### Common Issues

**"GEMINI_API_KEY not found"**
- Check if `.env` file exists
- Verify variable names are correct
- If deployed, check environment variables in hosting platform

**"Cannot find module 'discord.js'"**
- Run `npm install` to install dependencies

**"429 Too Many Requests"**
- You've exceeded Gemini API quota (50 requests/day)
- Wait until tomorrow or upgrade to paid plan

**Bot not responding**
- Check if bot is online in Discord
- Verify channel ID is correct
- Ensure bot has permission to send messages

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request


## 👨‍💻 Author

**NguyenMinh4869** - [GitHub](https://github.com/NguyenMinh4869)

## 🙏 Acknowledgments

- [Discord.js](https://discord.js.org/) - Discord API wrapper
- [Google Gemini AI](https://ai.google.dev/) - AI model
- [Render](https://render.com) - Hosting platform


---

⭐ **If this project is helpful, please give it a star!** ⭐ 