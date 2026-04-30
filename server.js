const express = require('express');
const cors = require('cors');
const { Octokit } = require("@octokit/rest");
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

console.log("--- URUCHOMIENIE BACKENDU (APPEND MODE) ---");
console.log("Czy GITHUB_TOKEN jest wczytany?:", process.env.GITHUB_TOKEN ? "TAK" : "NIE");
console.log("Repozytorium:", process.env.REPO_OWNER + "/" + process.env.REPO_NAME);

const saveLimiter = rateLimit({
    windowMs: 2000,
    max: 1,
    message: "Zwolnij! Możesz wysyłać zmiany co 2 sekundy.",
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

app.post('/save', saveLimiter, async (req, res) => {
    const { password, content, message, authors } = req.body;

    if (password !== process.env.SAVE_PASSWORD) {
        return res.status(401).send("Błędne hasło!");
    }

    // Decyzja o nazwie pliku
    let filename = 'poligons/pozycje.js';
    if (authors && authors.length === 1) {
        // Jeden autor -> własny plik (np. poligons/xrogo.js)
        filename = `poligons/${authors[0].toLowerCase()}.js`;
    }

    try {
        let existingContent = "";
        let sha = null;

        try {
            const { data: fileData } = await octokit.repos.getContent({
                owner: process.env.REPO_OWNER,
                repo: process.env.REPO_NAME,
                path: filename
            });
            sha = fileData.sha;
            existingContent = Buffer.from(fileData.content, 'base64').toString('utf8');
        } catch (e) {
            // Plik nie istnieje - nie błąd, po prostu stworzymy nowy
        }

        // DOPISYWANIE na końcu pliku
        let updatedContent = existingContent.trim();
        if (updatedContent.length > 0) updatedContent += "\n\n";
        
        // Dodajemy poligon jako nowe wywołanie funkcji
        updatedContent += `window.registerPolygons([\n${content}\n]);`;

        await octokit.repos.createOrUpdateFileContents({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: filename,
            message: message || `Zmiana od ${authors ? authors.join(', ') : 'admina'}`,
            content: Buffer.from(updatedContent).toString('base64'),
            sha: sha
        });

        res.send(`Zapisano pomyślnie w ${filename}!`);
    } catch (e) {
        console.error("Błąd zapisu:", e.message);
        res.status(500).send("Błąd podczas zapisu na GitHub: " + e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
