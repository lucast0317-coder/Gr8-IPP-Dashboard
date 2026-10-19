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

// Registration Endpoint
app.post(['/api/register', '/api/auth/register'], (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username.trim(), password], function (err) {
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

    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username.trim(), password], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error during login.' });
        }
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }
        res.json({ message: 'Login successful', username: user.username });
    });
});

// Groq AI Integration Endpoint supporting Custom AI Personality & Task Types
app.post('/api/ai', async (req, res) => {
    const { prompt, grade, taskType, customTask, aiPersonality } = req.body;

    if (!GROQ_API_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY is missing from environment variables on Render.' });
    }

    const activeTask = taskType === 'custom' ? (customTask || 'Custom Teacher Task') : taskType;
    const basePersonality = aiPersonality && aiPersonality.trim() !== '' 
        ? aiPersonality.trim() 
        : 'You are an expert AI co-teacher and educational assistant helping teachers design high-quality lesson plans, draft Individual Program Plans (IPPs), build assessments, and structure accommodations.';

    let refinedPrompt = `Target Grade Level: ${grade || 'Grade 8'}\nSelected Tool / Task Type: ${activeTask}\n\nTeacher Request Details: ${prompt}`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-oss-20b',
                messages: [
                    { role: 'system', content: basePersonality },
                    { role: 'user', content: refinedPrompt }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();
        
        if (data.choices && data.choices[0]) {
            res.json({ result: data.choices[0].message.content });
        } else {
            console.error('Groq API Error Response:', data);
            res.status(500).json({ error: data.error?.message || 'Failed to generate response from Groq AI' });
        }
    } catch (error) {
        console.error('Groq AI Network Error:', error);
        res.status(500).json({ error: 'Internal server error while connecting to AI' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});