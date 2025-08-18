## Mizu-bot (Discord AI bot)

An AI chat bot for Discord (persona: Mizuhara Chizuru) using Hugging Face Inference and `discord.js`.

### Features
- Smart language detection; replies in the same language as the user
- Conversation memory, user profile, and embedding-based context retrieval
- Typing indicator, anti-spam/cooldown, and basic rate limiting

### Requirements
- Node.js ≥ 16
- Discord Bot Token
- Hugging Face API Token

### Quick Start
```bash
git clone https://github.com/your-username/Mizu-bot.git
cd Mizu-bot
npm install
```

Create a `.env` file in the project root:
```env
TOKEN=your_discord_bot_token
HF_TOKEN=your_huggingface_token
DEBUG_MEMORY=0
# Response style: minimal (default) | expressive
RESPONSE_STYLE=minimal
```

Optional: open `index.js` and set `CONFIG.CHANNELS` to restrict where the bot listens.

Run the bot:
```bash
npm start
```

To also run the HTTP health server (cross-platform):
```bash
npm run start:web
```

### Usage
- Chat normally with the bot in a configured channel
- View previous message: type "previous message" (or Vietnamese: "tin nhắn trước")
- Ignore: any message starting with `!` is ignored

### Configuration
- `.env`: `TOKEN`, `HF_TOKEN`
- `index.js` → `CONFIG`: `CHANNELS`, `COOLDOWN_TIME`, etc.

You can also configure channels via environment variable:
```env
CHANNELS=123456789012345678,234567890123456789
```

Optional commands (DM or channel):
- `profile` / `view profile` — show remembered user profile
- `forget me` / `delete my data` — erase your stored memory

### Deploy (simple PM2 on a VPS)
```bash
npm install -g pm2
pm2 start index.js --name mizu-bot
pm2 save
```

### Troubleshooting
- Missing `HF_TOKEN`/`TOKEN`: check your `.env`
- Bot not responding: verify permissions, `CHANNELS`, and that the bot is online
- Quota/429: wait and retry or increase Hugging Face limits

---
