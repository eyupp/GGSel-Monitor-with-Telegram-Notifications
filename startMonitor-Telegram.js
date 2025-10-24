require('dotenv').config();
const GGSelChatMonitor = require('./GGSelChatMonitor-Complete');
const TelegramNotifier = require('./TelegramNotifier');

// Check debug mode
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Create a conditional logger
const logger = {
    log: (...args) => DEBUG_MODE && console.log(...args),
    error: (...args) => console.error(...args), // Always show errors
    warn: (...args) => DEBUG_MODE && console.warn(...args),
    info: (...args) => DEBUG_MODE && console.info(...args)
};

// Utility function to format dates in GMT+3
function formatDateGMT3(dateString) {
    if (!dateString) return 'N/A';
    
    try {
        const date = new Date(dateString);
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

logger.log('╔'.repeat(80));
logger.log('🚀 GGSEL MONITOR WITH TELEGRAM NOTIFICATIONS');
logger.log('╔'.repeat(80));
logger.log('');

// Initialize Telegram notifier
let telegram = null;
try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
        logger.log('⚠️  Telegram not configured - notifications disabled');
        logger.log('💡 To enable Telegram notifications:');
        logger.log('   1. Add TELEGRAM_BOT_TOKEN to your .env file');
        logger.log('   2. Add TELEGRAM_CHAT_ID to your .env file');
        logger.log('');
    } else {
        telegram = new TelegramNotifier(botToken, chatId);
        logger.log('📱 Telegram notifier initialized');
        logger.log('');
    }
} catch (error) {
    logger.error('❌ Telegram initialization failed:', error.message);
    logger.log('📋 Monitor will continue without Telegram notifications');
    logger.log('');
}

logger.log('📋 Features:');
logger.log('   ✅ Detects NEW ORDERS');
logger.log('   ✅ Detects new chats');
logger.log('   ✅ Detects new messages');
logger.log('   ✅ Shows message content');
if (telegram) {
    logger.log('   ✅ Sends Telegram notifications');
}
logger.log('');
logger.log('╔'.repeat(80));
logger.log('');

const monitor = new GGSelChatMonitor({
    pollingInterval: 15000,
    debugMode: DEBUG_MODE, // Pass debug mode to monitor
    
    // =============================================
    // 🛒 NEW ORDER HANDLER
    // =============================================
    onNewOrder: async (sale) => {
        const formattedDate = formatDateGMT3(sale.date);
        
        // Console output (only in debug mode)
        logger.log('\n🎉🛒 NEW ORDER RECEIVED! 🛒🎉');
        logger.log('═'.repeat(80));
        logger.log(`🆔 Invoice ID: ${sale.invoice_id}`);
        logger.log(`📦 Product: ${sale.product.name}`);
        if (sale.buyer_email) {
            logger.log(`📧 Buyer Email: ${sale.buyer_email}`);
        }
        logger.log(`💰 USD: $${sale.product.price_usd} | EUR: €${sale.product.price_eur} | RUB: ₽${sale.product.price_rub}`);
        logger.log(`📅 Date: ${formattedDate} (GMT+3)`);
        logger.log('═'.repeat(80));
        
        // Send to Telegram (always, regardless of debug mode)
        if (telegram) {
            try {
                await telegram.notifyNewOrder(sale);
                logger.log('📱 Telegram notification sent!');
            } catch (error) {
                logger.error('❌ Failed to send Telegram notification:', error.message);
            }
        }
    },
    
    // =============================================
    // 💬 NEW CHAT HANDLER
    // =============================================
    onNewChat: async (chat, productName) => {
        // Console output (only in debug mode)
        logger.log('\n💬 NEW CHAT CREATED!');
        logger.log('═'.repeat(80));
        logger.log(`🆔 Order Number: ${chat.id_i}`);
        logger.log(`📦 Product: ${productName || `ID: ${chat.product}`}`);
        logger.log(`📧 Customer: ${chat.email}`);
        logger.log('═'.repeat(80));
        
        // Send to Telegram (always, regardless of debug mode)
        if (telegram) {
            try {
                await telegram.notifyNewChat(chat, productName);
                logger.log('📱 Telegram notification sent!');
            } catch (error) {
                logger.error('❌ Failed to send Telegram notification:', error.message);
            }
        }
    },
    
    // =============================================
    // 📨 NEW MESSAGE HANDLER
    // =============================================
    onNewMessage: async (chat, newMessageCount, messages, productName) => {
        // Console output (only in debug mode)
        logger.log('\n📨 NEW MESSAGE(S) RECEIVED!');
        logger.log('═'.repeat(80));
        logger.log(`🆔 Order Number: ${chat.id_i}`);
        logger.log(`📦 Product: ${productName || `ID: ${chat.product}`}`);
        logger.log(`📧 Customer: ${chat.email}`);
        logger.log(`📊 New Messages: +${newMessageCount}`);
        
        if (messages && messages.length > 0) {
            logger.log('\n📝 Messages:');
            messages.forEach((msg, index) => {
                const sender = msg.buyer ? '👤 Customer' : '🏢 You';
                logger.log(`   ${index + 1}. ${sender}: "${msg.message}"`);
            });
        }
        logger.log('═'.repeat(80));
        
        // Send to Telegram (always, regardless of debug mode)
        if (telegram) {
            try {
                await telegram.notifyNewMessage(chat, newMessageCount, messages, productName);
                logger.log('📱 Telegram notification sent!');
            } catch (error) {
                logger.error('❌ Failed to send Telegram notification:', error.message);
            }
        }
    }
});

// Start the monitor
(async () => {
    // Test Telegram connection if configured
    if (telegram) {
        logger.log('Testing Telegram connection...\n');
        const connected = await telegram.testConnection();
        
        if (connected) {
            logger.log('\nSending test message...');
            try {
                await telegram.sendTestMessage();
                logger.log('✅ Test message sent! Check your Telegram!\n');
            } catch (error) {
                logger.error('❌ Failed to send test message:', error.message);
            }
        }
        logger.log('');
    }
    
    // Start monitoring
    monitor.start();
    
    // Show initial message even in non-debug mode
    if (!DEBUG_MODE) {
        console.log('🚀 GGSel Monitor started in SILENT MODE');
        console.log('📱 Telegram notifications:', telegram ? 'ENABLED' : 'DISABLED');
        console.log('🔇 Console output disabled. Set DEBUG_MODE=true in .env to enable console logs.');
        console.log('💡 Press Ctrl+C to stop\n');
    }
})();

// Show statistics every minute (only in debug mode)
if (DEBUG_MODE) {
    setInterval(() => {
        const stats = monitor.getStats();
        const time = new Date().toLocaleTimeString();
        const telegramStatus = telegram ? '📱 ON' : '📱 OFF';
        logger.log(`\n📊 [${time}] ${telegramStatus} | Chats: ${stats.totalChats} | Invoices cached: ${stats.cachedInvoices} | Last invoice: ${stats.lastSaleInvoiceId}`);
    }, 60000);
}

// Graceful shutdown
process.on('SIGINT', () => {
    // Always show shutdown message, regardless of debug mode
    console.log('\n\n╔'.repeat(80));
    console.log('🛑 SHUTTING DOWN');
    console.log('╔'.repeat(80));
    
    const stats = monitor.getStats();
    console.log(`\n📊 Final Statistics:`);
    console.log(`   Last Sale Invoice: ${stats.lastSaleInvoiceId}`);
    console.log(`   Total Chats: ${stats.totalChats}`);
    console.log(`   Invoices Cached: ${stats.cachedInvoices}`);
    console.log(`   Products Cached: ${stats.cachedProducts}`);
    console.log(`   Telegram: ${telegram ? 'Enabled' : 'Disabled'}`);
    console.log(`   Debug Mode: ${DEBUG_MODE ? 'ON' : 'OFF'}`);
    console.log('');
    
    monitor.stop();
    console.log('✅ Monitor stopped successfully');
    console.log('👋 Goodbye!\n');
    process.exit(0);
});

logger.log('💡 TIP: Press Ctrl+C to stop the monitor\n');
logger.log('⏳ Initializing...\n');

process.stdin.resume();
