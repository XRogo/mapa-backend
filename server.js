const express = require('express');
const cors = require('cors');
const { Octokit } = require("@octokit/rest");
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// DEBUGOWANIE - Sprawdź to w zakładce "Logs" na Renderze!
console.log("--- URUCHOMIENIE BACKENDU ---");
console.log("Czy GITHUB_TOKEN jest wczytany?:", process.env.GITHUB_TOKEN ? "TAK (Długość: " + process.env.GITHUB_TOKEN.length + ")" : "NIE");
console.log("Repozytorium:", process.env.REPO_OWNER + "/" + process.env.REPO_NAME);
console.log("-----------------------------");

const saveLimiter = rateLimit({
    windowMs: 2000,
    max: 1,
    message: "Zwolnij! Możesz wysyłać zmiany co 2 sekundy.",
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const octokit = new Octokit({ 
    auth: process.env.GITHUB_TOKEN,
    userAgent: 'CraftlyMap-Backend v1.0'
});

// Status serwera z nagłówkiem zakazującym cache
app.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send({ status: 'ok', time: new Date().toISOString() });
});

app.get('/history', async (req, res) => {
    try {
        const { data } = await octokit.repos.listCommits({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: 'pozycje.js',
            per_page: 10
        });
        res.send(data.map(c => ({
            date: c.commit.author.date,
            message: c.commit.message,
            author: c.commit.author.name
        })));
    } catch (e) { 
        res.status(500).send("Błąd pobierania historii: " + e.message); 
    }
});

app.post('/save', saveLimiter, async (req, res) => {
    const { password, content, message } = req.body;

    if (password !== process.env.SAVE_PASSWORD) {
        return res.status(401).send("Błędne hasło!");
    }

    try {
        const { data: fileData } = await octokit.repos.getContent({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: 'pozycje.js'
        });

        await octokit.repos.createOrUpdateFileContents({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: 'pozycje.js',
            message: message || "Aktualizacja mapy przez panel admina",
            content: Buffer.from(content).toString('base64'),
            sha: fileData.sha
        });

        res.send("Zapisano pomyślnie na GitHub!");
    } catch (e) {
        console.error("Błąd zapisu:", e.message);
        res.status(500).send("Błąd podczas zapisu na GitHub: " + e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
