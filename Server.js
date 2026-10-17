const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Database Setup
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);
});

// Serve Public.html at root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public.html'));
});

// Registration Endpoint (supports both /api/register and /api/auth/register)
app.post(['/api/register', '/api/auth/register'], (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], function (err) {
        if (err) {
            return res.status(400).json({ error: 'Username already exists or database error' });
        }
        res.json({ message: 'User registered successfully', userId: this.lastID });
    });
});

// Login Endpoint (supports both /api/login and /api/auth/login)
app.post(['/api/login', '/api/auth/login'], (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.json({ message: 'Login successful', username: user.username });
    });
});

// Groq AI Integration Endpoint
app.post('/api/ai', async (req, res) => {
    const { prompt } = req.body;

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY is missing from environment variables' });
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant for Grade 8 teachers.' },
                    { role: 'user', content: prompt }
                ]
            })
        });

        const data = await response.json();
        if (data.choices && data.choices[0]) {
            res.json({ result: data.choices[0].message.content });
        } else {
            res.status(500).json({ error: 'Failed to generate response from Groq AI' });
        }
    } catch (error) {
        console.error('Groq AI Error:', error);
        res.status(500).json({ error: 'Internal server error while connecting to AI' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});