const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const logger = require('./logger');

// API клиенты
const amocrm = require('./api/amocrm');
const onlinepbx = require('./api/onlinepbx');

// Сервисы
const dialer = require('./services/dialer');
const telephony = require('./services/telephony');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    // ЛОГИРУЕМ КАЖДЫЙ ЗАПРОС
    logger.info(`${req.method} ${req.url}`);
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище WebSocket клиентов
const clients = new Set();

// WebSocket соединения
wss.on('connection', (ws) => {
    console.log('Client connected');
    clients.add(ws);

    ws.send(JSON.stringify({
        type: 'state',
        data: dialer.getState()
    }));

    ws.on('message', async (message) => {
        try {
            const parsed = JSON.parse(message);
            if (parsed.type === 'start_dialer') {
                await dialer.start();
            } else if (parsed.type === 'stop_dialer') {
                dialer.stop();
            }
        } catch (e) {
            console.error('[WS] Error:', e);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
    });
});

function broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Webhook endpoint для OnlinePBX
app.post('/api/webhook/onlinepbx', (req, res) => {
    try {
        const result = telephony.handleWebhook(req.body, dialer, broadcast);
        res.status(200).json(result);
    } catch (error) {
        console.error('[SERVER] Webhook Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// События диалера
dialer.on('stateChanged', (state) => broadcast('stateChanged', { state }));
dialer.on('queueUpdated', (queue) => broadcast('queueUpdated', queue));
dialer.on('leadStatusChanged', (lead) => broadcast('leadStatusChanged', lead));
dialer.on('callInitiated', (data) => broadcast('callInitiated', data));
dialer.on('callAnswered', (data) => broadcast('callAnswered', data));
dialer.on('callEnded', (data) => broadcast('callEnded', data));

// API Routes
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/test-connections', async (req, res) => {
    const results = {
        amocrm: await amocrm.testConnection(),
        onlinepbx: await onlinepbx.testConnection()
    };
    res.json(results);
});

app.get('/api/dialer/state', (req, res) => res.json(dialer.getState()));

app.get('/api/users', async (req, res) => {
    try {
        const users = await amocrm.getUsers();

        // Группы отделов продаж (на основе теста)
        const salesGroupIds = [560434, 560430, 688610]; // KZ Алматы, KZ Астана, KZ Арина

        // Фильтруем только нужные группы + Админ
        const filtered = users.filter(u => {
            const userGroups = u._embedded?.groups || [];
            const isSales = userGroups.some(g => salesGroupIds.includes(g.id));
            const isAdmin = u.id === 7751419; // Специально для теста (Admin)
            return isSales || isAdmin;
        });

        // Форматируем для фронтенда
        const formattedUsers = filtered.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + encodeURIComponent(u.name),
            extension: '100' // ТЕСТОВЫЙ НОМЕР
        }));

        res.json(formattedUsers);
    } catch (error) {
        logger.error('API /users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET PIPELINES & STAGES
app.get('/api/amocrm/pipelines', async (req, res) => {
    try {
        let pipelines = await amocrm.getPipelines();

        // ФОЛБЭК: Если AmoCRM недоступна, отдаем демо-данные
        if (!pipelines || pipelines.length === 0) {
            console.log('Using MOCK Pipelines (Demo Mode)');
            pipelines = [
                { id: 101, name: 'Отдел Продаж (DEMO)', _embedded: { statuses: [{ id: 1, name: 'Первичный контакт' }, { id: 2, name: 'Переговоры' }] } },
                { id: 102, name: 'Холодный обзвон (DEMO)', _embedded: { statuses: [{ id: 3, name: 'Поиск контактов' }, { id: 4, name: 'Назначение встречи' }] } }
            ];
        }
        res.json(pipelines);
    } catch (error) {
        logger.error('API /pipelines error:', error);
        res.status(200).json([]); // Отдаем пустой массив вместо 500
    }
});

// GET REAL LEADS
app.get('/api/amocrm/leads', async (req, res) => {
    try {
        const { status_id, pipeline_id, user_id, limit } = req.query;
        let leads = await amocrm.findLeadsByStatus(status_id, pipeline_id, user_id, limit || 250);

        // ФОЛБЭК: Демо-сделки
        if (!leads || leads.length === 0) {
            console.log('Using MOCK Leads (Demo Mode)');
            leads = [
                { id: 1, name: 'Демо: Сделка #1', price: 150000, status_id: status_id, contactName: 'Иван Тестовый', phone: '+77770000001', link: '#' },
                { id: 2, name: 'Демо: Сделка #2', price: 80000, status_id: status_id, contactName: 'Мария Примерная', phone: '+77770000002', link: '#' }
            ];
        }
        res.json(leads);
    } catch (error) {
        logger.error('API /leads error:', error);
        res.status(200).json([]);
    }
});

app.post('/api/dialer/start', async (req, res) => {
    await dialer.start();
    res.json({ success: true });
});

app.post('/api/dialer/stop', (req, res) => {
    dialer.stop();
});

// Global Error Handling
app.use((err, req, res, next) => {
    logger.error('Unhandled Express Error: ', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

process.on('uncaughtException', (err) => {
    logger.error('CRITICAL: Uncaught Exception:', err);
    // Prevent crash by not exiting, though typically unsafe
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Инициализация
async function init() {
    // В облаке (Render/Heroku) порт выдается через process.env.PORT
    const PORT = process.env.PORT || config.server.port || 3000;

    server.listen(PORT, () => {
        console.log(`\n🚀 DASHBOARD IS READY: http://localhost:${PORT}`);
        console.log(`\n--- DEMO MODE INSTRUCTIONS ---`);
        console.log(`If running on cloud without .env, the app will automatically use MOCK DATA.`);
        console.log(`Open the browser and test the UI.`);
        console.log(`------------------------------\n`);
    });

    try {
        // Проверяем, есть ли токены. Если нет - сразу пишем, что работаем в Демо.
        if (!config.amocrm.token) {
            console.log('⚠️ No AmoCRM Token found. Running in OFFLINE DEMO MODE.');
            console.log('   (Pipelines and Leads will be simulated)');
        } else {
            amocrm.testConnection().then(ok => {
                if (!ok) console.warn('! AmoCRM: Connection failed (Will use Fallback)');
                else console.log('✓ AmoCRM: Connected');
            });
        }

        if (!config.onlinepbx.apiKey) {
            console.log('⚠️ No OnlinePBX API Key. Phone calls will be SIMULATED.');
        } else {
            onlinepbx.authenticate().then(() => {
                console.log('✓ OnlinePBX: Authenticated');
            }).catch(err => {
                console.warn('! OnlinePBX: Auth failed:', err.message);
            });
        }
    } catch (e) {
        console.error('Init error:', e);
    }
}

init().catch(e => console.error('CRITICAL ERROR:', e));
