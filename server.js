const express = require('express');
const cors = require('cors');
const { Octokit } = require("@octokit/rest");
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

console.log("--- BACKEND (OVERWRITE/APPEND MODE) ---");

const saveLimiter = rateLimit({
    windowMs: 2000,
    max: 1,
    message: "Zwolnij!",
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
    const { password, content, authors, allPolys, mode } = req.body;

    if (password !== process.env.SAVE_PASSWORD) {
        return res.status(401).send("Błędne hasło!");
    }

    // Wybór pliku
    let filename = 'poligons/pozycje.js';
    if (authors && authors.length === 1) {
        filename = `poligons/${authors[0].toLowerCase()}.js`;
    }

    try {
        let sha = null;
        try {
            const { data: fileData } = await octokit.repos.getContent({
                owner: process.env.REPO_OWNER,
                repo: process.env.REPO_NAME,
                path: filename
            });
            sha = fileData.sha;
        } catch (e) {}

        let finalContent = "";

        if (mode === "overwrite" && allPolys) {
            // Generujemy pełny plik z tablicą wszystkich poligonów autora
            const polysJson = allPolys.map(p => JSON.stringify(p, null, 2)).join(',\n');
            finalContent = `window.registerPolygons([\n${polysJson}\n]);`;
        } else {
            // Tryb APPEND (dla pozycje.js lub gdy brak allPolys)
            let existingContent = "";
            if (sha) {
                const { data: fileData } = await octokit.repos.getContent({
                    owner: process.env.REPO_OWNER,
                    repo: process.env.REPO_NAME,
                    path: filename
                });
                existingContent = Buffer.from(fileData.content, 'base64').toString('utf8');
            }

            let updated = existingContent.trim();
            if (!updated.includes('window.registerPolygons')) {
                updated = `window.registerPolygons([\n${content}\n]);`;
            } else {
                const lastIdx = updated.lastIndexOf(']);');
                if (lastIdx !== -1) {
                    let prefix = updated.substring(0, lastIdx).trim();
                    if (prefix.length > 0 && !prefix.endsWith(',') && !prefix.endsWith('[')) prefix += ",";
                    updated = prefix + `\n${content}\n]);`;
                } else {
                    updated += `\n\nwindow.registerPolygons([\n${content}\n]);`;
                }
            }
            finalContent = updated;
        }

        await octokit.repos.createOrUpdateFileContents({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: filename,
            message: `Aktualizacja: ${authors ? authors.join(', ') : 'admin'}`,
            content: Buffer.from(finalContent).toString('base64'),
            sha: sha
        });

        res.send(`Zapisano w ${filename}!`);
    } catch (e) {
        console.error("Błąd:", e.message);
        res.status(500).send("Błąd: " + e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
