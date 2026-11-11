const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

let isServerLockedDown = false;
let currentBroadcastMessage = '';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Persistent SQLite Database Setup
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Create tables for users and AI interaction history
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ai_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            grade TEXT,
            taskType TEXT,
            prompt TEXT,
            response TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public.html'));
});

// Registration Endpoint
app.post(['/api/register', '/api/auth/register'], (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const cleanUsername = username.trim();
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [cleanUsername, password], function (err) {
        if (err) {
            return res.status(400).json({ error: 'Username already exists or database error.' });
        }
        res.json({ message: 'User registered successfully', userId: this.lastID });
    });
});

// Login Endpoint
app.post(['/api/login', '/api/auth/login'], (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const cleanUsername = username.trim();
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [cleanUsername, password], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error during login.' });
        }
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        res.json({ message: 'Login successful', username: user.username });
    });
});

// Admin Auth & Controls
app.post('/api/admin/auth', (req, res) => {
    const { password } = req.body;
    if (password === 'password' || password === ':password') {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Incorrect admin password.' });
    }
});

app.post('/api/admin/lockdown', (req, res) => {
    const { lockdown } = req.body;
    isServerLockedDown = Boolean(lockdown);
    res.json({ success: true, isServerLockedDown });
});

app.post('/api/admin/broadcast', (req, res) => {
    const { message } = req.body;
    currentBroadcastMessage = message || '';
    res.json({ success: true, message: currentBroadcastMessage });
});

// Accurate Admin System Status & User Count
app.get('/api/system/status', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({
            userCount: row ? row.count : 0,
            isServerLockedDown,
            broadcastMessage: currentBroadcastMessage,
            uptime: process.uptime()
        });
    });
});

// Retrieve User AI History Log Endpoint
app.get('/api/logs/:username', (req, res) => {
    const username = req.params.username;
    db.all('SELECT * FROM ai_logs WHERE username = ? ORDER BY id DESC', [username], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve logs' });
        }
        res.json({ logs: rows });
    });
});

// Groq AI Integration Endpoint with History Logging
app.post('/api/ai', async (req, res) => {
    if (isServerLockedDown) {
        return res.status(503).json({ error: 'Server is currently in Lockdown Mode by an administrator. No AI calls are permitted until reopened.' });
    }

    const { username, prompt, grade, taskType, customTask, aiPersonality, scienceUnit } = req.body;

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY is missing from environment variables on Render.' });
    }

    const activeTask = taskType === 'custom' ? (customTask || 'Custom Teacher Task') : taskType;
    const scienceUnitInfo = scienceUnit && scienceUnit.trim() !== '' ? `Science Unit Focus: ${scienceUnit.trim()}` : '';

    let systemRole = 'You are an expert AI co-teacher and educational assistant helping teachers design high-quality lesson plans, quizzes, word problems, and resources across Science, Math, ELA, and Social Studies. Use Markdown formatting (such as **bold**, bullet points, and headers) to organize your responses clearly.';
    if (aiPersonality && aiPersonality.trim() !== '') {
        systemRole = `STRICT INSTRUCTION - Adopt the following tone and personality for all responses: "${aiPersonality.trim()}". You are an expert AI co-teacher helping teachers design high-quality lesson plans and resources across Science, Math, ELA, and Social Studies. Use Markdown formatting (**bold**, bullet points, headers) to structure your output.`;
    }

    let refinedPrompt = `Target Grade Level: ${grade || 'Grade 8'}\nSelected Tool / Task Type: ${activeTask}\n${scienceUnitInfo}\n\nTeacher Request Details: ${prompt}`;

    const requestPayload = {
        model: 'openai/gpt-oss-20b',
        messages: [
            { role: 'system', content: systemRole },
            { role: 'user', content: refinedPrompt }
        ],
        temperature: 0.7
    };

    console.log('--- SENDING TO GROQ API ---');
    console.log(JSON.stringify(requestPayload, null, 2));

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestPayload)
        });

        const data = await response.json();
        
        console.log('--- RECEIVED FROM GROQ API ---');
        console.log(JSON.stringify(data, null, 2));
        
        if (data.choices && data.choices[0]) {
            const aiResponseText = data.choices[0].message.content;

            // Save interaction to SQLite database
            if (username) {
                db.run('INSERT INTO ai_logs (username, grade, taskType, prompt, response) VALUES (?, ?, ?, ?, ?)',
                    [username, grade, activeTask, prompt, aiResponseText]);
            }

            res.json({ result: aiResponseText });
        } else {
            console.error('Groq API Error Response:', data);
            res.status(500).json({ error: data.error?.message || 'Failed to generate response from Groq AI' });
        }
    } catch (error) {
        console.error('Groq AI Network Error:', error);
        res.status(500).json({ error: 'Internal server error while connecting to AI' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});