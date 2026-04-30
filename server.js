const express = require('express');
const cors = require('cors');
const { Octokit } = require("@octokit/rest");
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Konfiguracja Rate Limitu: max 1 prośba na 2 sekundy z jednego IP dla ścieżki /save
const saveLimiter = rateLimit({
    windowMs: 2000, // 2 sekundy
    max: 1, // 1 zapytanie na okno
    message: "Zwolnij! Możesz wysyłać zmiany co 2 sekundy.",
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Status serwera
app.get('/status', (req, res) => res.send({ status: 'ok' }));

// Historia zmian (ostatnie 10 commitów pliku pozycje.js)
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

// Zapisywanie zmian (z nałożonym limitem 2s)
app.post('/save', saveLimiter, async (req, res) => {
    const { password, content, message } = req.body;

    if (password !== process.env.SAVE_PASSWORD) {
        return res.status(401).send("Błędne hasło!");
    }

    try {
        // 1. Pobierz aktualny plik (potrzebujemy jego SHA do aktualizacji)
        const { data: fileData } = await octokit.repos.getContent({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: 'pozycje.js'
        });

        // 2. Wyślij nową treść pliku
        await octokit.repos.createOrUpdateFileContents({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: 'pozycje.js',
            message: message || "Aktualizacja mapy przez panel administratora",
            content: Buffer.from(content).toString('base64'),
            sha: fileData.sha
        });

        res.send("Zapisano pomyślnie! Zmiany będą widoczne na mapie za ok. 1-2 minuty.");
    } catch (e) {
        res.status(500).send("Błąd podczas zapisu na GitHub: " + e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer backendu Crafty działa na porcie ${PORT}`));
