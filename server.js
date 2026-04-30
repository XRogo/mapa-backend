const express = require('express');
const cors = require('cors');
const { Octokit } = require("@octokit/rest");
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

console.log("--- BACKEND (SMART INTERNAL APPEND) ---");

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
    const { password, content, authors } = req.body;

    if (password !== process.env.SAVE_PASSWORD) {
        return res.status(401).send("Błędne hasło!");
    }

    // Wybór pliku: 1 autor -> własny plik, wielu -> pozycje.js
    let filename = 'poligons/pozycje.js';
    if (authors && authors.length === 1) {
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
            // Plik nie istnieje - stworzymy nowy
        }

        let updatedContent = existingContent.trim();
        
        if (!updatedContent.includes('window.registerPolygons')) {
            // Nowy plik - tworzymy strukturę tablicy
            updatedContent = `window.registerPolygons([\n${content}\n]);`;
        } else {
            // SMART APPEND: Wstawianie DO ŚRODKA tablicy przed ]);
            const lastIdx = updatedContent.lastIndexOf(']);');
            if (lastIdx !== -1) {
                let prefix = updatedContent.substring(0, lastIdx).trim();
                // Jeśli przed zamknięciem nie ma przecinka ani otwarcia tablicy, dodajemy go
                if (prefix.length > 0 && !prefix.endsWith(',') && !prefix.endsWith('[')) {
                    prefix += ",";
                }
                updatedContent = prefix + `\n${content}\n]);`;
            } else {
                // Fallback jeśli plik ma inną strukturę
                updatedContent += `\n\nwindow.registerPolygons([\n${content}\n]);`;
            }
        }

        await octokit.repos.createOrUpdateFileContents({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: filename,
            message: `Aktualizacja mapy (${authors ? authors.join(', ') : 'admin'})`,
            content: Buffer.from(updatedContent).toString('base64'),
            sha: sha
        });

        res.send(`Zapisano pomyślnie w ${filename}!`);
    } catch (e) {
        console.error("Błąd:", e.message);
        res.status(500).send("Błąd serwera: " + e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
