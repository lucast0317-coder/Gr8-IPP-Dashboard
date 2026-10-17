const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite Database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite database.');
});

// Create Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        session_token TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS widgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

// --- AUTHENTICATION ROUTES ---

// Register
app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;
    const token = crypto.randomBytes(32).toString('hex');

    db.run(`INSERT INTO users (username, password, session_token) VALUES (?, ?, ?)`,
        [username, password, token], function(err) {
            if (err) return res.status(400).json({ error: 'Username already taken or invalid.' });
            res.json({ token, username, userId: this.lastID });
        }
    );
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid username or password.' });

        const token = crypto.randomBytes(32).toString('hex');
        db.run(`UPDATE users SET session_token = ? WHERE id = ?`, [token, user.id], () => {
            res.json({ token, username: user.username, userId: user.id });
        });
    });
});

// Verify Token (Auto-Login check)
app.get('/api/auth/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided.' });

    const token = authHeader.split(' ')[1];
    db.get(`SELECT id, username FROM users WHERE session_token = ?`, [token], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid session token.' });
        res.json({ user });
    });
});

// --- WIDGET & AI ROUTES ---

// Get User Widgets
app.get('/api/widgets', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    db.get(`SELECT id FROM users WHERE session_token = ?`, [token], (err, user) => {
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        db.all(`SELECT * FROM widgets WHERE user_id = ?`, [user.id], (err, widgets) => {
            res.json(widgets);
        });
    });
});

// Create New AI Widget
app.post('/api/widgets', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const { title, system_prompt } = req.body;

    db.get(`SELECT id FROM users WHERE session_token = ?`, [token], (err, user) => {
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        db.run(`INSERT INTO widgets (user_id, title, system_prompt) VALUES (?, ?, ?)`,
            [user.id, title, system_prompt], function(err) {
                if (err) return res.status(500).json({ error: 'Failed to create widget' });
                res.json({ id: this.lastID, title, system_prompt });
            }
        );
    });
});

// Run AI Prompt via Gemini API
app.post('/api/ai/run', async (req, res) => {
    const { system_prompt, user_input } = req.body;
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    { role: 'user', parts: [{ text: `${system_prompt}\n\nInput: ${user_input}` }] }
                ]
            })
        });

        const data = await response.json();
        const output = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
        res.json({ output });
    } catch (error) {
        res.status(500).json({ error: 'Failed to communicate with AI model.' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));