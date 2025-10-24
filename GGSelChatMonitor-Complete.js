require('dotenv').config();
const { getToken } = require('./GGSel');
const Request = require('request');

class GGSelChatMonitor {
    constructor(options = {}) {
        this.pollingInterval = options.pollingInterval || 90000; // Default: 45 seconds
        this.debugMode = options.debugMode !== undefined ? options.debugMode : (process.env.DEBUG_MODE === 'true');
        this.isRunning = false;
        this.isInitialized = false; // Track if initial load is complete
        this.lastChatCount = 0;
        this.lastMessageCounts = new Map(); // Track message count per chat (if available)
        this.lastMessageIds = new Map(); // Track highest message ID seen per chat
        this.productCache = new Map(); // Cache product names by product ID
        this.invoiceCache = new Map(); // Cache invoice details by invoice ID (order number)
        this.lastSaleInvoiceId = null; // Track last sale to detect new orders
        this.onNewChat = options.onNewChat || this.defaultNewChatHandler(this);
        this.onNewMessage = options.onNewMessage || this.defaultNewMessageHandler(this);
        this.onNewOrder = options.onNewOrder || this.defaultNewOrderHandler(this);

        // Create logger for this instance
        this.logger = {
            log: (...args) => this.debugMode && console.log(...args),
            error: (...args) => console.error(...args), // Always show errors
            warn: (...args) => this.debugMode && console.warn(...args),
            info: (...args) => this.debugMode && console.info(...args)
        };
    }

    // Default handlers
    defaultNewOrderHandler(sale) {
        this.logger.log('\n🛒 NEW ORDER RECEIVED!');
        this.logger.log('═'.repeat(70));
        this.logger.log(`🆔 Invoice ID: ${sale.invoice_id}`);
        this.logger.log(`📦 Product: ${sale.product.name}`);
        if (sale.buyer_email) {
            this.logger.log(`📧 Buyer Email: ${sale.buyer_email}`);
        }
        this.logger.log(`💰 Price: ${sale.product.price_usd} USD / ${sale.product.price_rub} RUB / ${sale.product.price_eur} EUR`);
        this.logger.log(`📅 Date: ${sale.date}`);
        this.logger.log('═'.repeat(70));
    }

    defaultNewChatHandler(chat, productName) {
        this.logger.log('\n💬 NEW CHAT!');
        this.logger.log('═'.repeat(70));
        this.logger.log(`🆔 Order Number: ${chat.id_i}`);
        this.logger.log(`📦 Product: ${productName || `ID: ${chat.product}`}`);
        this.logger.log(`📧 Email: ${chat.email}`);
        this.logger.log(`💬 Messages: ${chat.cnt_msg || 0}`);
        this.logger.log(`🔔 Unread: ${chat.cnt_new || 0}`);
        this.logger.log(`🕐 Last Activity: ${chat.last_message}`);
        this.logger.log('═'.repeat(70));
    }

    defaultNewMessageHandler(chat, newMessageCount, messages, productName) {
        this.logger.log('\n🆕 NEW MESSAGE(S)!');
        this.logger.log('═'.repeat(70));
        this.logger.log(`🆔 Order Number: ${chat.id_i}`);
        this.logger.log(`📦 Product: ${productName || `ID: ${chat.product}`}`);
        this.logger.log(`📧 Email: ${chat.email}`);
        this.logger.log(`📊 New Messages: +${newMessageCount}`);
        this.logger.log(`💬 Total Messages: ${chat.cnt_msg || 0}`);
        this.logger.log(`🔔 Unread: ${chat.cnt_new || 0}`);
        this.logger.log(`🕐 Last Activity: ${chat.last_message}`);
        
        if (messages && messages.length > 0) {
            this.logger.log('─'.repeat(70));
            this.logger.log('📝 NEW MESSAGE CONTENT:');
            this.logger.log('');
            messages.forEach((msg, index) => {
                const sender = msg.buyer ? '👤 Customer' : '🏢 You';
                const seenStatus = msg.date_seen ? '✓ Read' : '⭕ Unread';
                
                this.logger.log(`   ${index + 1}. ${sender} (${seenStatus}):`);
                this.logger.log(`      "${msg.message}"`);
                this.logger.log(`      📅 ${msg.date_written}`);
                
                if (msg.is_file) {
                    this.logger.log(`      📎 Attachment: ${msg.filename}`);
                    if (msg.is_img) {
                        this.logger.log(`      🖼️  Image: ${msg.url}`);
                    }
                }
                this.logger.log('');
            });
        }
        this.logger.log('═'.repeat(70));
    }

    // Fetch last sales
    async fetchLastSales(token, top = 10) {
        return new Promise((resolve, reject) => {
            const sellerId = process.env.GGSEL_SELLER_ID || '1074943';
            const url = `https://seller.ggsel.net/api_sellers/api/seller-last-sales?token=${token}&seller_id=${sellerId}&top=${top}`;
            
            Request({
                url: url,
                method: 'GET',
                headers: { 
                    'Accept': 'application/json',
                    'locale': 'en'
                },
                json: true,
                timeout: 10000
            }, (error, response, body) => {
                if (error) {
                    reject(error);
                } else if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`HTTP ${response.statusCode}: ${JSON.stringify(body)}`));
                } else {
                    resolve(body);
                }
            });
        });
    }

    // Fetch invoice details to get buyer email
    async fetchInvoiceDetails(token, invoiceId) {
        return new Promise((resolve, reject) => {
            const url = `https://seller.ggsel.net/api_sellers/api/purchase/info/${invoiceId}?token=${token}`;
            
            this.logger.log(`📡 API Call: GET /purchase/info/${invoiceId}`);
            
            Request({
                url: url,
                method: 'GET',
                headers: { 
                    'Accept': 'application/json',
                    'locale': 'en'
                },
                json: true,
                timeout: 10000
            }, (error, response, body) => {
                if (error) {
                    this.logger.error(`❌ Request error: ${error.message}`);
                    reject(error);
                } else if (response.statusCode < 200 || response.statusCode >= 300) {
                    this.logger.error(`❌ HTTP ${response.statusCode} - Body:`, JSON.stringify(body));
                    reject(new Error(`HTTP ${response.statusCode}`));
                } else if (body.retval !== 0) {
                    this.logger.error(`❌ API Error: ${body.retdesc}`);
                    reject(new Error(`API Error: ${body.retdesc}`));
                } else {
                    this.logger.log(`✅ Purchase info received for invoice ${invoiceId}`);
                    resolve(body.content);
                }
            });
        });
    }

    // Helper: Get buyer email for a chat (using invoice cache)
    async getChatBuyerEmail(token, chatId) {
        // Check cache first
        let invoiceData = this.invoiceCache.get(chatId);
        
        if (invoiceData && invoiceData.buyer_email) {
            return invoiceData.buyer_email;
        }
        
        // Not in cache - fetch from purchase API
        try {
            const purchaseInfo = await this.fetchInvoiceDetails(token, chatId);
            const buyerEmail = purchaseInfo?.buyer_info?.email || null;
            
            // Cache it
            this.invoiceCache.set(chatId, {
                invoice_id: chatId,
                buyer_email: buyerEmail
            });
            
            return buyerEmail;
        } catch (error) {
            this.logger.error(`Could not fetch buyer email for chat ${chatId}: ${error.message}`);
            return null;
        }
    }

    // Fetch product details
    async fetchProduct(token, productId) {
        // Check cache first
        if (this.productCache.has(productId)) {
            return this.productCache.get(productId);
        }

        return new Promise((resolve, reject) => {
            const url = `https://seller.ggsel.net/api_sellers/api/products/${productId}/data?token=${token}`;
            
            Request({
                url: url,
                method: 'GET',
                headers: { 
                    'Accept': 'application/json'
                },
                json: true,
                timeout: 10000
            }, (error, response, body) => {
                if (error) {
                    this.logger.error(`❌ Request error: ${error.message}`);
                    reject(error);
                } else if (response.statusCode < 200 || response.statusCode >= 300) {
                    this.logger.error(`❌ HTTP ${response.statusCode} - Body:`, JSON.stringify(body));
                    reject(new Error(`HTTP ${response.statusCode}`));
                } else if (body.retval !== 0) {
                    this.logger.error(`❌ API Error: ${body.retdesc}`);
                    reject(new Error(`API Error: ${body.retdesc}`));
                } else {
                    // Correct path: body.product.name
                    const productName = body?.product?.name || `Product ${productId}`;
                    // Cache the product name
                    this.productCache.set(productId, productName);
                    resolve(productName);
                }
            });
        });
    }

    // Fetch list of chats (only with unread messages for efficiency)
    async fetchChats(token) {
        return new Promise((resolve, reject) => {
            const url = `https://seller.ggsel.net/api_sellers/api/debates/v2/chats?token=${token}&filter_new=1&pagesize=200`;
            
            Request({
                url: url,
                method: 'GET',
                headers: { 
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                json: true,
                timeout: 10000
            }, (error, response, body) => {
                if (error) {
                    this.logger.error(`❌ Request error: ${error.message}`);
                    reject(error);
                } else if (response.statusCode < 200 || response.statusCode >= 300) {
                    this.logger.error(`❌ HTTP ${response.statusCode} - Body:`, JSON.stringify(body));
                    reject(new Error(`HTTP ${response.statusCode}`));
                } else {
                    this.logger.log(`✅ Chats received`);
                    resolve(body);
                }
            });
        });
    }

    // Fetch messages for a specific chat
    async fetchMessages(token, chatId, count = 10) {
        return new Promise((resolve, reject) => {
            const url = `https://seller.ggsel.net/api_sellers/api/debates/v2?token=${token}&id_i=${chatId}&count=${count}&newer=1`;
            
            Request({
                url: url,
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                json: true,
                timeout: 10000
            }, (error, response, body) => {
                if (error) {
                    this.logger.error(`❌ Request error: ${error.message}`);
                    reject(error);
                } else if (response.statusCode < 200 || response.statusCode >= 300) {
                    this.logger.error(`❌ HTTP ${response.statusCode} - Body:`, JSON.stringify(body));
                    reject(new Error(`HTTP ${response.statusCode}`));
                } else {
                    this.logger.log(`✅ Messages received for chat ${chatId}`);
                    resolve(body || []);
                }
            });
        });
    }

    // Check for new orders
    async checkNewOrders(token) {
        try {
            const salesResponse = await this.fetchLastSales(token, 20);  // Increased from 5 to 20
            
            if (salesResponse.retval !== 0) {
                this.logger.error('Sales API error:', salesResponse.retdesc);
                return;
            }

            const sales = salesResponse.sales || [];
            
            if (sales.length === 0) {
                return;
            }

            // Debug: Show what we're checking (only when initialized)
            if (this.isInitialized) {
                const invoiceIds = sales.map(s => s.invoice_id).join(', ');
                this.logger.log(`🔍 Checking orders: [${invoiceIds}] vs last known: ${this.lastSaleInvoiceId}`);
            }
            
            // Find the ACTUAL highest invoice ID in the returned sales
            const highestInvoiceInList = Math.max(...sales.map(s => s.invoice_id));
            
            // FIRST RUN: Initialize with current highest invoice
            if (this.lastSaleInvoiceId === null) {
                this.lastSaleInvoiceId = highestInvoiceInList;
                this.logger.log(`📊 Initialized tracking to invoice: ${this.lastSaleInvoiceId}`);
                return; // Don't alert on existing orders
            }
            
            // Check if there are any new sales (after initialization)
            if (this.isInitialized && highestInvoiceInList > this.lastSaleInvoiceId) {
                // We have new sales - find all sales GREATER than last known
                const newSales = [];
                for (const sale of sales) {
                    if (sale.invoice_id > this.lastSaleInvoiceId) {
                        newSales.push(sale);
                    }
                }
                
                this.logger.log(`✅ Found ${newSales.length} new order(s)!`);
                
                // Debug: Show first sale structure
                if (newSales.length > 0) {
                    this.logger.log('🔍 Sale object keys:', Object.keys(newSales[0]));
                }
                
                // Sort by invoice ID ascending (oldest first)
                newSales.sort((a, b) => a.invoice_id - b.invoice_id);
                
                // Notify for each new sale (with buyer email and actual amount)
                for (const sale of newSales) {
                    // Check cache first by invoice ID
                    let invoiceData = this.invoiceCache.get(sale.invoice_id);
                    
                    if (!invoiceData) {
                        // Fetch full invoice details from purchase API
                        let buyerEmail = null;
                        let orderAmount = null;
                        
                        this.logger.log(`🔍 Fetching order details for invoice ${sale.invoice_id}...`);
                        
                        try {
                            const purchaseInfo = await this.fetchInvoiceDetails(token, sale.invoice_id);
                            buyerEmail = purchaseInfo?.buyer_info?.email || null;
                            orderAmount = purchaseInfo?.amount || null; // Actual amount paid
                            const currencyType = purchaseInfo?.currency_type || null; // Currency (USD, RUB, EUR, etc.)
                            
                            if (buyerEmail) {
                                this.logger.log(`✅ Got buyer email: ${buyerEmail}`);
                            } else {
                                this.logger.log(`⚠️  No email in purchase info for invoice ${sale.invoice_id}`);
                            }
                            
                            if (orderAmount && currencyType) {
                                this.logger.log(`✅ Got order amount: ${orderAmount} ${currencyType}`);
                            } else {
                                this.logger.log(`⚠️  No amount/currency in purchase info for invoice ${sale.invoice_id}`);
                                this.logger.log(`📋 Purchase info structure:`, JSON.stringify(purchaseInfo, null, 2));
                            }
                            
                            // Add formatted amount to sale
                            if (orderAmount && currencyType) {
                                sale.order_amount = orderAmount;
                                sale.currency_type = currencyType;
                                sale.formatted_amount = `${orderAmount} ${currencyType}`;
                            }
                        } catch (error) {
                            this.logger.error(`❌ Failed to fetch order details for invoice ${sale.invoice_id}: ${error.message}`);
                        }
                        
                        // Cache the invoice data by invoice ID
                        invoiceData = {
                            invoice_id: sale.invoice_id,
                            buyer_email: buyerEmail,
                            order_amount: sale.order_amount,
                            currency_type: sale.currency_type,
                            formatted_amount: sale.formatted_amount,
                            product: sale.product,
                            date: sale.date
                        };
                        this.invoiceCache.set(sale.invoice_id, invoiceData);
                    } else {
                        this.logger.log(`📦 Using cached data for invoice ${sale.invoice_id}: ${invoiceData.buyer_email || 'no email'}, amount: ${invoiceData.formatted_amount || 'unknown'}`);
                    }
                    
                    // Add cached data to sale object
                    sale.buyer_email = invoiceData.buyer_email;
                    sale.order_amount = invoiceData.order_amount;
                    sale.currency_type = invoiceData.currency_type;
                    sale.formatted_amount = invoiceData.formatted_amount;
                    
                    this.onNewOrder(sale);
                }
                
                // CRITICAL: Update to the HIGHEST invoice ID (last in sorted newSales array)
                // NOT latestSale which is just sales[0]!
                const highestInvoiceId = Math.max(...newSales.map(s => s.invoice_id));
                this.lastSaleInvoiceId = highestInvoiceId;
                this.logger.log(`📊 Updated tracking to invoice: ${this.lastSaleInvoiceId}`);
            }
            // If no new orders, DON'T update lastSaleInvoiceId - keep tracking from the same point
            
        } catch (error) {
            this.logger.error('Error checking new orders:', error.message);
        }
    }

    // Main polling function
    async poll() {
        if (!this.isRunning) return;

        try {
            const token = await getToken();
            
            // Check for new orders FIRST (most important!)
            await this.checkNewOrders(token);
            
            // Then check chats and messages
            const chatsResponse = await this.fetchChats(token);
            const chats = chatsResponse.items || [];

            const currentChatCount = chats.length;
            
            // Debug: Show chat tracking info
            this.logger.log(`\n💬 Chat Detection:`);
            this.logger.log(`   Current chats: ${currentChatCount}`);
            this.logger.log(`   Last known chats: ${this.lastChatCount}`);
            this.logger.log(`   Tracked messages: ${this.lastMessageCounts.size}`);
            this.logger.log(`   Initialized: ${this.isInitialized}`);

            // Check for new chats
            if (this.lastChatCount > 0 && currentChatCount > this.lastChatCount) {
                const newChatsCount = currentChatCount - this.lastChatCount;
                this.logger.log(`\n🔔 Detected ${newChatsCount} new chat(s)!`);
                
                const newChats = chats.slice(0, newChatsCount);
                
                for (const chat of newChats) {
                    this.logger.log(`\n💬 Processing new chat: ${chat.id_i}`);
                    this.logger.log(`🔍 Chat object fields:`, Object.keys(chat));
                    this.logger.log(`🔍 Chat ID (chat.id): ${chat.id}`);
                    this.logger.log(`🔍 Invoice ID (chat.id_i): ${chat.id_i}`);
                    
                    let productName = null;
                    try {
                        productName = await this.fetchProduct(token, chat.product);
                    } catch (error) {
                        this.logger.error(`Could not fetch product name for ${chat.product}`);
                    }
                    
                    // Fetch buyer email for chat (chat.id_i is the invoice ID)
                    const buyerEmail = await this.getChatBuyerEmail(token, chat.id_i);
                    chat.email = buyerEmail; // Add email to chat object
                    
                    // ALWAYS fetch messages for new chat to see if there are any initial messages
                    let initialMessages = [];
                    let latestMessageId = null;
                    
                    try {
                        this.logger.log(`   📨 Fetching messages for new chat ${chat.id_i}...`);
                        const allMessages = await this.fetchMessages(token, chat.id_i, 200);
                        
                        if (allMessages && allMessages.length > 0) {
                            // Sort by ID to ensure we get the latest
                            allMessages.sort((a, b) => a.id - b.id);
                            initialMessages = allMessages;
                            latestMessageId = allMessages[allMessages.length - 1].id;
                            
                            this.logger.log(`   ✅ Found ${allMessages.length} initial message(s), latest ID: ${latestMessageId}`);
                        } else {
                            this.logger.log(`   📭 No messages in new chat yet`);
                        }
                    } catch (error) {
                        this.logger.error(`   ❌ Error fetching messages for new chat ${chat.id_i}:`, error.message);
                    }
                    
                    // Send new chat notification
                    this.onNewChat(chat, productName);
                    
                    // If there are initial messages, also send message notification
                    if (initialMessages.length > 0) {
                        this.logger.log(`   📨 Sending ${initialMessages.length} initial message(s) notification`);
                        this.onNewMessage(chat, initialMessages.length, initialMessages, productName);
                        
                        // Initialize with latest message ID
                        this.lastMessageIds.set(chat.id_i, latestMessageId);
                    } else {
                        // Initialize with 0 (no messages yet)
                        this.lastMessageIds.set(chat.id_i, 0);
                    }
                }
            }

            // Check for new messages in chats
            let chatsChecked = 0;
            let chatsInitialized = 0;
            let newMessagesFound = 0;
            
            this.logger.log(`\n💬 Checking ${chats.length} chats with potential unread messages...`);
            
            for (const chat of chats) {
                const chatId = chat.id_i;
                chatsChecked++;
                
                try {
                    // Fetch ALL messages for this chat (up to 200)
                    const allMessages = await this.fetchMessages(token, chatId, 200);
                    
                    if (!allMessages || allMessages.length === 0) {
                        // No messages in this chat
                        continue;
                    }
                    
                    // Sort messages by ID (ascending) to get latest
                    allMessages.sort((a, b) => a.id - b.id);
                    
                    // Get the highest message ID
                    const latestMessageId = allMessages[allMessages.length - 1].id;
                    const lastKnownMessageId = this.lastMessageIds.get(chatId);
                    
                    if (lastKnownMessageId === undefined) {
                        // First time seeing this chat - initialize
                        this.lastMessageIds.set(chatId, latestMessageId);
                        chatsInitialized++;
                        this.logger.log(`   📝 Initialized chat ${chatId} with message ID ${latestMessageId}`);
                        continue; // Don't notify on initial load
                    }
                    
                    // Check if there are new messages
                    if (latestMessageId > lastKnownMessageId) {
                        // Find new messages (IDs greater than last known)
                        const newMessages = allMessages.filter(msg => msg.id > lastKnownMessageId);
                        
                        if (newMessages.length > 0) {
                            newMessagesFound++;
                            
                            this.logger.log(`\n📨 Detected ${newMessages.length} new message(s) in chat ${chatId}`);
                            this.logger.log(`   Last known ID: ${lastKnownMessageId}, Latest ID: ${latestMessageId}`);
                            
                            // Get product name
                            let productName = null;
                            try {
                                productName = await this.fetchProduct(token, chat.product);
                            } catch (error) {
                                this.logger.error(`Could not fetch product name for ${chat.product}`);
                            }
                            
                            // Get buyer email
                            const buyerEmail = await this.getChatBuyerEmail(token, chatId);
                            chat.email = buyerEmail;
                            
                            // Update chat message count if available
                            if (chat.cnt_msg) {
                                chat.cnt_msg = allMessages.length;
                            }
                            
                            // Notify about new messages
                            this.onNewMessage(chat, newMessages.length, newMessages, productName);
                            
                            // Update last known message ID
                            this.lastMessageIds.set(chatId, latestMessageId);
                        }
                    }
                    
                } catch (error) {
                    this.logger.error(`Error checking messages for chat ${chatId}:`, error.message);
                }
            }
            
            this.logger.log(`\n   Summary: Checked ${chatsChecked} chats, Initialized ${chatsInitialized}, Found new messages in ${newMessagesFound} chats`);


            // Update chat count
            this.lastChatCount = currentChatCount;

        } catch (error) {
            this.logger.error('Polling error:', error.message);
        }

        // Mark as initialized after first poll completes (prevents false alerts on startup)
        if (!this.isInitialized) {
            this.isInitialized = true;
            this.logger.log('✅ First poll complete - now detecting new orders\n');
        }

        // Schedule next poll
        if (this.isRunning) {
            setTimeout(() => this.poll(), this.pollingInterval);
        }
    }

    // Start monitoring
    async start() {
        if (this.isRunning) {
            this.logger.log('⚠️  Monitor is already running');
            return;
        }

        this.logger.log('🚀 Starting GGSel Chat Monitor (Complete Edition)...');
        this.logger.log(`📊 Polling interval: ${this.pollingInterval}ms (${this.pollingInterval / 1000}s)`);
        this.logger.log('');
        
        this.isRunning = true;
        
        // Initial load - just record counts without notifications
        try {
            const token = await getToken();
            
            // Initialize last sale
            const salesResponse = await this.fetchLastSales(token, 1);
            if (salesResponse.retval === 0 && salesResponse.sales && salesResponse.sales.length > 0) {
                this.lastSaleInvoiceId = salesResponse.sales[0].invoice_id;
                this.logger.log(`✅ Initialized with last sale: Invoice ${this.lastSaleInvoiceId}`);
            }
            
            // Initialize chats
            const chatsResponse = await this.fetchChats(token);
            const chats = chatsResponse.items || [];

            this.lastChatCount = chats.length;
            
            // Initialize message counts for all chats and cache product names
            for (const chat of chats) {
                this.lastMessageCounts.set(chat.id_i, chat.cnt_msg || 0);
                
                // Preload product names
                try {
                    await this.fetchProduct(token, chat.product);
                } catch (error) {
                    // Ignore errors during preload
                }
            }

            this.logger.log(`✅ Initialized with ${this.lastChatCount} existing chats`);
            this.logger.log(`✅ Cached ${this.productCache.size} product names`);
            this.logger.log(`✅ Tracking from invoice: ${this.lastSaleInvoiceId}`);
            this.logger.log('👀 Now monitoring for new orders, chats, and messages...\n');
        } catch (error) {
            this.logger.error('❌ Initialization error:', error.message);
        }

        // Start polling - isInitialized will be set after first poll
        this.poll();
    }

    // Stop monitoring
    stop() {
        if (!this.isRunning) {
            this.logger.log('⚠️  Monitor is not running');
            return;
        }

        this.logger.log('\n🛑 Stopping GGSel Chat Monitor...');
        this.isRunning = false;
    }

    // Get statistics
    getStats() {
        return {
            isRunning: this.isRunning,
            totalChats: this.lastChatCount,
            trackedChats: this.lastMessageCounts.size,
            cachedProducts: this.productCache.size,
            cachedInvoices: this.invoiceCache.size,
            lastSaleInvoiceId: this.lastSaleInvoiceId,
            pollingInterval: this.pollingInterval
        };
    }
}

// Export the class
module.exports = GGSelChatMonitor;

// Example usage if run directly
if (require.main === module) {
    const monitor = new GGSelChatMonitor({
        pollingInterval: 15000,
        
        onNewOrder: (sale) => {
            this.logger.log('\n💰 KA-CHING! NEW ORDER!');
            this.logger.log('═'.repeat(70));
            this.logger.log(`🆔 Invoice: ${sale.invoice_id}`);
            this.logger.log(`📦 Product: ${sale.product.name}`);
            this.logger.log(`💵 ${sale.product.price_usd} USD`);
            this.logger.log('═'.repeat(70));
        },
        
        onNewChat: (chat, productName) => {
            this.logger.log('\n💬 New chat for order', chat.id_i);
        },
        
        onNewMessage: (chat, newCount, messages, productName) => {
            this.logger.log('\n📨 New message in order', chat.id_i);
            if (messages && messages.length > 0) {
                this.logger.log(`"${messages[0].message}"`);
            }
        }
    });

    monitor.start();

    setInterval(() => {
        const stats = monitor.getStats();
        this.logger.log(`\n📊 Monitoring... ${stats.totalChats} chats`);
    }, 60000);

    process.on('SIGINT', () => {
        this.logger.log('\n📊 Stats:', monitor.getStats());
        monitor.stop();
        process.exit(0);
    });

    this.logger.log('💡 Press Ctrl+C to stop\n');
    process.stdin.resume();
}
