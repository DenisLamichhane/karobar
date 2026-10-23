const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, 'database.json');

// 🔔 PASTE YOUR DISCORD WEBHOOK URL HERE (or use process.env.DISCORD_WEBHOOK_URL)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1563063402006585417/0vSkpJ3i9WzFkowt1O9NdVLedU6nL3QHznpND6d41GdQXq_ZefsX8VtpBVZu6tFq2FyG';

const SECRET_ADMIN_PIN = process.env.ADMIN_PIN || '1973';

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

const defaultData = {
  orders: [],
  reviews: [],
  accounts: [],
  settings: {
    qrImageUrl: '',
    paymentNote: 'Write your Roblox Username in Remarks!'
  }
};

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    console.error('Database read error:', err);
    return defaultData;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Database write error:', err);
  }
}

// Helper function to send Discord Webhook notification
async function sendDiscordNotification(order) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.includes('YOUR_DISCORD_WEBHOOK_URL')) return;

  try {
    const payload = {
      content: "🚨 **NEW ROBUX ORDER RECEIVED!** 🚨",
      embeds: [
        {
          title: `📦 Order ID: ${order.orderCode}`,
          color: 3066993, // Emerald green sidebar color
          fields: [
            { name: "👤 Roblox User", value: `\`${order.robloxUsername}\``, inline: true },
            { name: "💎 Robux Amount", value: `**${order.robuxAmount} R$**`, inline: true },
            { name: "💵 Price Paid", value: `**Rs. ${order.nprAmount}**`, inline: true },
            { name: "📧 Customer Email", value: order.customerEmail, inline: false },
            { name: "🔖 Transaction Ref", value: order.transactionRef || 'Not Provided', inline: true },
            { name: "⏳ Status", value: "Submitted (Awaiting Proof Verification)", inline: true }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };

    // Use native fetch in Node.js to post to Discord
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Failed to send Discord webhook:', err);
  }
}

// 1. GET PUBLIC STATE
app.get('/api/state', (req, res) => {
  const db = readDB();
  res.json({
    orders: db.orders,
    reviews: db.reviews,
    settings: {
      qrImageUrl: db.settings?.qrImageUrl || '',
      paymentNote: db.settings?.paymentNote || 'Write your Roblox Username in Remarks!'
    }
  });
});

// 2. VERIFY SELLER PIN
app.post('/api/admin/verify', (req, res) => {
  const { pin } = req.body;
  const db = readDB();
  const activePin = db.settings?.adminPin || SECRET_ADMIN_PIN;

  if (String(pin).trim() === String(activePin).trim()) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Access denied. Invalid PIN.' });
});

// 3. CUSTOMER SIGNUP / LOGIN
app.post('/api/accounts', (req, res) => {
  const db = readDB();
  const { mode, email, passwordHash, defaultRobloxUsername } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();

  const existing = db.accounts.find((a) => a.email.toLowerCase() === cleanEmail);

  if (mode === 'signup') {
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
    }
    const newAccount = {
      id: 'acc_' + Date.now(),
      email: cleanEmail,
      passwordHash,
      defaultRobloxUsername: defaultRobloxUsername || '',
      createdAt: Date.now()
    };
    db.accounts.push(newAccount);
    writeDB(db);
    return res.json({ account: newAccount });
  } else {
    if (!existing) {
      return res.status(404).json({ error: 'No account found with this email. Please sign up first.' });
    }
    if (existing.passwordHash !== passwordHash) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }
    return res.json({ account: existing });
  }
});

// 4. CREATE NEW ORDER & TRIGGER DISCORD NOTIFICATION
app.post('/api/orders', async (req, res) => {
  const db = readDB();
  const shortOrderCode = 'RK-' + Math.floor(100000 + Math.random() * 900000);
  const newOrder = {
    id: 'ord_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    orderCode: shortOrderCode,
    customerEmail: req.body.customerEmail,
    robloxUsername: req.body.robloxUsername,
    robuxAmount: Number(req.body.robuxAmount),
    nprAmount: Number(req.body.nprAmount),
    transactionRef: req.body.transactionRef || 'Not Provided',
    proofImage: req.body.proofImage,
    status: 'SUBMITTED',
    adminNote: 'Order received! Our team will verify your payment receipt shortly.',
    reviewed: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  db.orders.unshift(newOrder);
  writeDB(db);

  // Send alert to Discord asynchronously
  sendDiscordNotification(newOrder);

  res.json({ order: newOrder });
});

// 5. UPDATE ORDER STATUS (Seller Portal)
app.patch('/api/orders/:id', (req, res) => {
  const db = readDB();
  const idx = db.orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });

  db.orders[idx] = {
    ...db.orders[idx],
    ...req.body,
    updatedAt: Date.now()
  };
  writeDB(db);
  res.json({ order: db.orders[idx] });
});

// 6. ADD CUSTOMER REVIEW
app.post('/api/reviews', (req, res) => {
  const db = readDB();
  const newReview = {
    id: 'rev_' + Date.now(),
    robloxUsername: req.body.robloxUsername,
    robuxAmount: req.body.robuxAmount,
    rating: Number(req.body.rating),
    comment: req.body.comment,
    orderCode: req.body.orderCode || 'VERIFIED',
    verifiedOrder: Boolean(req.body.verifiedOrder),
    createdAt: Date.now()
  };
  db.reviews.unshift(newReview);

  if (req.body.orderId) {
    const ordIdx = db.orders.findIndex((o) => o.id === req.body.orderId);
    if (ordIdx !== -1) db.orders[ordIdx].reviewed = true;
  }

  writeDB(db);
  res.json({ review: newReview });
});

// 7. SAVE SHOP SETTINGS
app.post('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json({
    settings: {
      qrImageUrl: db.settings.qrImageUrl,
      paymentNote: db.settings.paymentNote
    }
  });
});

// 8. SERVE FRONTEND
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`✅ ROBUX KAROBAR SERVER RUNNING AT: http://localhost:${PORT}`);
  console.log('====================================================');
});
