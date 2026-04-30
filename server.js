const express = require('express');
const cors = require('cors');
const { Octokit } = require("@octokit/rest");
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

console.log("--- BACKEND (BATCH MODE) ---");

const saveLimiter = rateLimit({
    windowMs: 2000,
    max: 1,
    message: "Zwolnij! Limit 1 zapisu na 2 sekundy.",
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

app.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send({ status: 'ok', time: new Date().toISOString() });
});

app.post('/save-batch', saveLimiter, async (req, res) => {
    const { password, batch, message } = req.body;

    if (password !== process.env.SAVE_PASSWORD) {
        return res.status(401).send("Błędne hasło!");
    }

    if (!batch || !Array.isArray(batch)) {
        return res.status(400).send("Brak danych w paczce (batch).");
    }

    const results = [];
    const errors = [];

    // Przetwarzamy każdy plik w paczce
    for (const item of batch) {
        const { author, content } = item;
        const filename = `poligons/${author.toLowerCase()}.js`;

        try {
            let sha = null;
            try {
                const { data: fileData } = await octokit.repos.getContent({
                    owner: process.env.REPO_OWNER,
                    repo: process.env.REPO_NAME,
                    path: filename
                });
                sha = fileData.sha;
            } catch (e) {
                // Plik nie istnieje, sha pozostaje null
            }

            await octokit.repos.createOrUpdateFileContents({
                owner: process.env.REPO_OWNER,
                repo: process.env.REPO_NAME,
                path: filename,
                message: message || `Zmiana zbiorcza: ${author}`,
                content: Buffer.from(content).toString('base64'),
                sha: sha
            });
            results.push(filename);
        } catch (e) {
            console.error(`Błąd przy ${filename}:`, e.message);
            errors.push(`${filename}: ${e.message}`);
        }
    }

    if (errors.length > 0) {
        res.status(500).send(`Zapisano częściowo: ${results.join(', ')}. Błędy: ${errors.join('; ')}`);
    } else {
        res.send(`Zaktualizowano pliki: ${results.join(', ')}`);
    }
});

// Stary endpoint dla kompatybilności (jeśli ktoś ma starą wersję strony)
app.post('/save', saveLimiter, async (req, res) => {
    const { password, content, authors } = req.body;
    if (password !== process.env.SAVE_PASSWORD) return res.status(401).send("Błędne hasło!");
    
    let filename = 'poligons/pozycje.js';
    if (authors && authors.length === 1) filename = `poligons/${authors[0].toLowerCase()}.js`;

    try {
        let sha = null;
        try {
            const { data: fileData } = await octokit.repos.getContent({
                owner: process.env.REPO_OWNER, repo: process.env.REPO_NAME, path: filename
            });
            sha = fileData.sha;
        } catch (e) {}

        await octokit.repos.createOrUpdateFileContents({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: filename,
            message: "Aktualizacja (tryb stary)",
            content: Buffer.from(content).toString('base64'),
            sha: sha
        });
        res.send("Zapisano!");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
