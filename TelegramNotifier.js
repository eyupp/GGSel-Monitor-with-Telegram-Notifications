require('dotenv').config();
const axios = require('axios');

class TelegramNotifier {
    constructor(botToken, chatId, debugMode) {
        if (!botToken) {
            throw new Error('Telegram bot token is required! Set TELEGRAM_BOT_TOKEN in .env');
        }
        if (!chatId) {
            throw new Error('Telegram chat ID is required! Set TELEGRAM_CHAT_ID in .env');
        }
        
        this.botToken = botToken;
        this.chatId = chatId;
        this.apiUrl = `https://api.telegram.org/bot${botToken}`;
        
        // Set debug mode (can be passed in constructor or from env)
        this.debugMode = debugMode !== undefined ? debugMode : (process.env.DEBUG_MODE === 'true');
        
        // Create logger for this instance
        this.logger = {
            log: (...args) => this.debugMode && console.log(...args),
            error: (...args) => console.error(...args), // Always show errors
            warn: (...args) => this.debugMode && console.warn(...args),
            info: (...args) => this.debugMode && console.info(...args)
        };
    }

    // Format date to GMT+3 (Istanbul time)
    formatDateGMT3(dateString) {
        if (!dateString) return 'N/A';
        
        try {
            const date = new Date(dateString);
            // Format in Istanbul timezone
            return date.toLocaleString('en-US', {
                timeZone: 'Europe/Istanbul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        } catch (error) {
            return dateString;
        }
    }

    // Send a message to Telegram
    async sendMessage(text, options = {}) {
        try {
            const response = await axios.post(`${this.apiUrl}/sendMessage`, {
                chat_id: this.chatId,
                text: text,
                parse_mode: options.parseMode || 'HTML',
                disable_web_page_preview: options.disablePreview || false,
                disable_notification: options.silent || false
            });
            
            return response.data;
        } catch (error) {
            this.logger.error('Failed to send Telegram message:', error.response?.data || error.message);
            throw error;
        }
    }

    // Format and send new order notification
    async notifyNewOrder(sale) {
        const formattedDate = this.formatDateGMT3(sale.date);
        
        let text = `
🎉 <b>NEW ORDER RECEIVED!</b> 🛒

🆔 <b>Invoice ID:</b> ${sale.invoice_id}
🔗 <b>Order Link:</b> <a href="https://seller.ggsel.net/orders/${sale.invoice_id}">Open Order</a>
📦 <b>Product:</b> ${sale.product.name}`;

        if (sale.buyer_email) {
            text += `\n📧 <b>Buyer Email:</b> ${sale.buyer_email}`;
        }

        // Show actual order amount if available, otherwise fallback to product prices
        if (sale.formatted_amount) {
            text += `\n\n💰 <b>Order Amount:</b> ${sale.formatted_amount}`;
        } else if (sale.order_amount && sale.currency_type) {
            text += `\n\n💰 <b>Order Amount:</b> ${sale.order_amount} ${sale.currency_type}`;
        } else {
            text += `

💰 <b>Prices:</b>
   💵 USD: $${sale.product.price_usd}
   💶 EUR: €${sale.product.price_eur}
   💴 RUB: ₽${sale.product.price_rub}${sale.product.price_uah ? `\n   💷 UAH: ₴${sale.product.price_uah}` : ''}`;
        }

        text += `

📅 <b>Date:</b> ${formattedDate} (GMT+3)
        `;

        return await this.sendMessage(text.trim());
    }

    // Format and send new chat notification
    async notifyNewChat(chat, productName) {
        const formattedDate = this.formatDateGMT3(chat.last_message);
        
        // Use chat.id for the actual chat ID, not chat.id_i (which is invoice ID)
        const chatId = chat.id || chat.id_i; // Fallback to id_i if id not available
        
        const text = `
💬 <b>NEW CHAT CREATED</b>

🆔 <b>Order Number:</b> ${chat.id_i}
📦 <b>Product:</b> ${productName || `ID: ${chat.product}`}
📧 <b>Customer:</b> ${chat.email || 'N/A'}

🕐 <b>Last Activity:</b> ${formattedDate} (GMT+3)
        `.trim();

        return await this.sendMessage(text);
    }

    // Format and send new message notification
    async notifyNewMessage(chat, newMessageCount, messages, productName) {
        // Use chat.id for the actual chat ID, not chat.id_i (which is invoice ID)
        const chatId = chat.id || chat.id_i; // Fallback to id_i if id not available
        
        let text = `
📨 <b>NEW MESSAGE(S) RECEIVED!</b>

🆔 <b>Order Number:</b> ${chat.id_i}
📦 <b>Product:</b> ${productName || `ID: ${chat.product}`}
📧 <b>Customer:</b> ${chat.email || 'N/A'}
        `.trim();

        // Add message content
        if (messages && messages.length > 0) {
            text += '\n\n━━━━━━━━━━━━━━━━━━━━━\n📝 <b>MESSAGE CONTENT:</b>\n';
            
            messages.forEach((msg, index) => {
                text += `<i>"${this.escapeHtml(msg.message)}"</i>\n`;
                
                if (msg.is_file) {
                    text += `📎 Attachment: ${msg.filename}\n`;
                    if (msg.url) {
                        text += `🔗 ${msg.url}\n`;
                    }
                }
            });
        }

        return await this.sendMessage(text);
    }

    // Escape HTML special characters
    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Test the connection
    async testConnection() {
        try {
            const response = await axios.get(`${this.apiUrl}/getMe`);
            this.logger.log('✅ Telegram bot connected successfully!');
            this.logger.log(`   Bot name: ${response.data.result.first_name}`);
            this.logger.log(`   Bot username: @${response.data.result.username}`);
            return true;
        } catch (error) {
            this.logger.error('❌ Failed to connect to Telegram bot:', error.response?.data || error.message);
            return false;
        }
    }

    // Send a test message
    async sendTestMessage() {
        const text = `
🤖 <b>GGSel Monitor Connected!</b>

✅ Your Telegram notifications are working!
📱 You will receive alerts for:
   • New orders 🛒
   • New chats 💬
   • New messages 📨

🕐 Started: ${new Date().toLocaleString()}
🔇 Debug Mode: ${this.debugMode ? 'ON' : 'OFF'}
        `.trim();

        return await this.sendMessage(text);
    }
}

module.exports = TelegramNotifier;

// Test the module if run directly
if (require.main === module) {
    (async () => {
        try {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            const debugMode = process.env.DEBUG_MODE === 'true';

            // Create logger for standalone execution
            const logger = {
                log: (...args) => debugMode && console.log(...args),
                error: (...args) => console.error(...args)
            };

            if (!botToken || !chatId) {
                console.error('❌ Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env file');
                console.error('');
                console.error('📝 Add these to your .env file:');
                console.error('   TELEGRAM_BOT_TOKEN=your_bot_token_here');
                console.error('   TELEGRAM_CHAT_ID=your_chat_id_here');
                console.error('');
                console.error('💡 How to get these:');
                console.error('   1. Create bot: Talk to @BotFather on Telegram');
                console.error('   2. Get chat ID: Send a message to your bot, then visit:');
                console.error('      https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates');
                process.exit(1);
            }

            const notifier = new TelegramNotifier(botToken, chatId, debugMode);
            
            logger.log('Testing Telegram connection...\n');
            
            // Test connection
            const connected = await notifier.testConnection();
            
            if (connected) {
                logger.log('\nSending test message...');
                await notifier.sendTestMessage();
                console.log('✅ Test message sent successfully!');
                console.log('\n👀 Check your Telegram to see the message!');
                if (!debugMode) {
                    console.log('🔇 Running in SILENT MODE. Set DEBUG_MODE=true in .env to see debug output.');
                }
            }
            
        } catch (error) {
            console.error('❌ Test failed:', error.message);
            process.exit(1);
        }
    })();
}
