# GGSel Monitor with Telegram Notifications

Real-time monitoring system for GGSel that tracks new orders, chats, and messages with Telegram notifications.

## Features

- 🛒 **New Order Detection** - Instantly notified when you receive a new order
- 💬 **New Chat Monitoring** - Alerts when customers start new conversations
- 📨 **Message Tracking** - Real-time notifications for new customer messages
- 📱 **Telegram Integration** - All alerts sent directly to your Telegram
- 🔇 **Silent Mode** - Run without console output for production use

## Prerequisites

- Node.js (v12 or higher)
- npm or yarn
- GGSel seller account
- Telegram Bot (optional, for notifications)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ggsel-monitor
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file from example:
```bash
cp .env.example .env
```

4. Configure your `.env` file:
```env
# Debug Mode (true = console output, false = silent)
DEBUG_MODE=false

# GGSel Credentials (required)
GGSEL_SELLER_ID=your_seller_id
GGSEL_SECRET_KEY=your_api_key

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## Setting up Telegram Bot

1. **Create a Bot:**
   - Open Telegram and search for `@BotFather`
   - Send `/newbot` and follow instructions
   - Save the bot token

2. **Get Your Chat ID:**
   - Open Telegram and search for `@@userinfobot`
   - Send `/start`
   - Save the ID

## Usage

### Start the monitor:
```bash
node startMonitor-Telegram.js
```

### Test Telegram connection only:
```bash
node TelegramNotifier.js
```

### Run in background (Linux/Mac):
```bash
nohup node startMonitor-Telegram.js > monitor.log 2>&1 &
```

### Run with PM2 (recommended):
```bash
# Install PM2 globally
npm install -g pm2

# Start the monitor
pm2 start startMonitor-Telegram.js --name "ggsel-monitor"

# View logs
pm2 logs ggsel-monitor

# Stop the monitor
pm2 stop ggsel-monitor
```

## Debug Mode

Control console output with the `DEBUG_MODE` environment variable:

- `DEBUG_MODE=true` - Shows all console logs (debugging)
- `DEBUG_MODE=false` - Silent mode (only errors and critical messages)

Telegram notifications work regardless of debug mode.

## File Structure

```
ggsel-monitor/
├── startMonitor-Telegram.js   # Main entry point
├── GGSelChatMonitor-Complete.js # Core monitoring logic
├── TelegramNotifier.js        # Telegram integration
├── GGSel.js                   # GGSel API authentication
├── .env                       # Your configuration
└── .env.example               # Example configuration
```

## Notifications

When running, you'll receive Telegram notifications for:

- **New Orders** - Invoice ID, product name, buyer email, amount
- **New Chats** - Order number, product, customer email
- **New Messages** - Message content, sender, attachments

## Troubleshooting

### Monitor runs but no notifications
- Check your Telegram bot token and chat ID
- Ensure the bot is started (send `/start` to your bot)
- Check `DEBUG_MODE=true` to see detailed logs

### Authentication errors
- Verify your GGSel email and password
- Check if your seller ID is correct

### No console output
- Set `DEBUG_MODE=true` in `.env` file
- Check if the process is running

## Stop the Monitor

Press `Ctrl+C` to gracefully shutdown. The monitor will display final statistics before exiting.

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
