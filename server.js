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

function formatHistoryTimestamp(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
    }, {});
    return `${parts.hour}.${parts.minute}.${parts.day}.${parts.month}.${parts.year}`;
}

function compareHistoryFiles(left, right) {
    const pattern = /^(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{4})(?:-(\d+))?\.js$/;
    const a = pattern.exec(left);
    const b = pattern.exec(right);
    if (!a || !b) return left.localeCompare(right);
    const aTime = Date.UTC(Number(a[5]), Number(a[4]) - 1, Number(a[3]), Number(a[1]), Number(a[2]));
    const bTime = Date.UTC(Number(b[5]), Number(b[4]) - 1, Number(b[3]), Number(b[1]), Number(b[2]));
    return aTime - bTime || Number(a[6] || 0) - Number(b[6] || 0) || left.localeCompare(right);
}

function formatHistoryValue(value, depth = 0) {
    const indent = level => '  '.repeat(level);
    if (Array.isArray(value)) {
        const isFlatArray = value.every(item => item === null || typeof item !== 'object');
        const isCoordinateArray = value.every(item =>
            Array.isArray(item) && item.every(coordinate => coordinate === null || typeof coordinate !== 'object'));
        if (isFlatArray || isCoordinateArray) {
            if (isCoordinateArray) {
                return `[${value.map(item => `[${item.map(coordinate => formatHistoryValue(coordinate, depth)).join(',')}]`).join(', ')}]`;
            }
            const separator = value.every(item => typeof item === 'number') ? ',' : ', ';
            return `[${value.map(item => formatHistoryValue(item, depth)).join(separator)}]`;
        }
        if (value.length === 0) return '[]';
        return `[\n${value.map(item => `${indent(depth + 1)}${formatHistoryValue(item, depth + 1)}`).join(',\n')}\n${indent(depth)}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return '{}';
        return `{\n${entries.map(([key, item]) =>
            `${indent(depth + 1)}${JSON.stringify(key)}: ${formatHistoryValue(item, depth + 1)}`
        ).join(',\n')}\n${indent(depth)}}`;
    }
    return JSON.stringify(value);
}

async function createUniqueHistoryPath(date) {
    const base = `poligons/${formatHistoryTimestamp(date)}`;
    let suffix = 1;
    while (true) {
        const filename = `${base}${suffix === 1 ? '' : `-${suffix}`}.js`;
        try {
            await octokit.repos.getContent({
                owner: process.env.REPO_OWNER,
                repo: process.env.REPO_NAME,
                path: filename
            });
            suffix++;
        } catch (error) {
            if (error.status === 404) return filename;
            throw error;
        }
    }
}

async function getPolygonHistoryFiles() {
    const { data: files } = await octokit.repos.getContent({
        owner: process.env.REPO_OWNER,
        repo: process.env.REPO_NAME,
        path: 'poligons'
    });
    if (!Array.isArray(files)) throw new Error('Nie udało się odczytać katalogu historii poligonów.');
    return files
        .filter(file => file.type === 'file' && /^\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{4}(?:-\d+)?\.js$/.test(file.name))
        .map(file => file.name)
        .sort(compareHistoryFiles);
}

app.get('/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send({ status: 'ok', time: new Date().toISOString() });
});

app.get('/polygon-history', async (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
        res.json(await getPolygonHistoryFiles());
    } catch (error) {
        console.error('Błąd pobierania historii poligonów:', error.message);
        res.status(502).send('Nie udało się pobrać historii poligonów.');
    }
});

app.get('/get-render-list', async (req, res) => {
    try {
        const { data: fileData } = await octokit.repos.getContent({
            owner: process.env.REPO_OWNER,
            repo: process.env.REPO_NAME,
            path: 'ktore_render.txt'
        });
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        res.send(content);
    } catch (e) {
        res.status(404).send("Brak pliku");
    }
});

app.post('/save-batch', saveLimiter, async (req, res) => {
    const { password, batch, message } = req.body;

    if (password !== process.env.SAVE_PASSWORD) {
        return res.status(401).send("Błędne hasło!");
    }

    if (!batch || !Array.isArray(batch) || batch.length === 0) {
        return res.status(400).send("Brak danych w paczce (batch).");
    }
    if (batch.length > 2 || batch.some(item =>
        !item || (item.type !== 'polygon-history' && item.path !== 'ktore_render.txt'))) {
        return res.status(400).send("Dozwolony jest zapis historii poligonów oraz listy kafelków.");
    }

    const results = [];
    const errors = [];

    // Historyczne poligony są dopisywane pod nową nazwą; pozostałe pliki zachowują dotychczasowy zapis.
    for (const item of batch) {
        const { author, content, path } = item;
        let filename = path;
        let fileContent = content;

        try {
            let sha = null;
            if (item.type === 'polygon-history') {
                if (!Array.isArray(item.operations) || item.operations.length === 0) {
                    throw new Error('Brak prawidłowych operacji historii poligonów.');
                }
                const createdIds = new Set();
                for (const operation of item.operations) {
                    if (!operation || typeof operation.id !== 'string' ||
                        !['create', 'edit', 'delete'].includes(operation.type) ||
                        (operation.type !== 'delete' &&
                            (!operation.polygon || operation.polygon.id !== operation.id || typeof operation.polygon !== 'object'))) {
                        throw new Error('Nieprawidłowa operacja historii poligonów.');
                    }
                    if (operation.type === 'create') {
                        if (createdIds.has(operation.id)) throw new Error('Powtórzone ID nowego poligonu.');
                        createdIds.add(operation.id);
                    }
                }
                if (typeof item.baseVersion !== 'string') {
                    throw new Error('Brak wersji bazowej historii.');
                }
                const historyFiles = await getPolygonHistoryFiles();
                if (historyFiles[historyFiles.length - 1] !== item.baseVersion) {
                    return res.status(409).send('Nie zapisano zmian: ktoś zapisał nowszą wersję. Twoje zmiany nadal są w tej karcie; sprawdź najnowszą mapę w drugim oknie przed ich ponownym wprowadzeniem.');
                }
                filename = await createUniqueHistoryPath(new Date());
                fileContent = `window.applyPolygonChanges(${formatHistoryValue(item.operations)});\n`;
            } else {
                try {
                    const { data: fileData } = await octokit.repos.getContent({
                        owner: process.env.REPO_OWNER,
                        repo: process.env.REPO_NAME,
                        path: filename
                    });
                    sha = fileData.sha;
                } catch (error) {
                    if (error.status !== 404) throw error;
                }
            }

            await octokit.repos.createOrUpdateFileContents({
                owner: process.env.REPO_OWNER,
                repo: process.env.REPO_NAME,
                path: filename,
                message: message || `Zmiana zbiorcza: ${author}`,
                content: Buffer.from(fileContent).toString('base64'),
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
        res.json({
            files: results,
            historyFile: results.find(filename => /^poligons\/\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{4}(?:-\d+)?\.js$/.test(filename)) || null
        });
    }
});

// Stary endpoint dla kompatybilności (jeśli ktoś ma starą wersję strony)
app.post('/save', saveLimiter, async (req, res) => {
    const { password } = req.body;
    if (password !== process.env.SAVE_PASSWORD) return res.status(401).send("Błędne hasło!");
    res.status(410).send("Ten format zapisu został wyłączony. Odśwież stronę, aby korzystać z historii wersji.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
