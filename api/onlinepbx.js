const axios = require('axios');
const WebSocket = require('ws');
const config = require('../config');

class OnlinePBX {
    constructor() {
        this.domain = this.getCleanDomain(config.onlinepbx.domain);
        this.apiKey = config.onlinepbx.apiKey;
        this.apiUrl = config.onlinepbx.apiUrl;
        this.managerNumber = config.onlinepbx.managerNumber;

        this.authKey = null;
        this.ws = null;
        this.eventHandlers = new Map();
    }

    /**
     * Авторизация в OnlinePBX API
     * @returns {Promise<string>} API ключ сессии
     */
    async authenticate() {
        try {
            console.log('Authenticating with OnlinePBX...');

            const response = await axios.post(
                `${this.apiUrl}/${this.domain}/auth.json`,
                { auth_key: this.apiKey },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.status === '1' || response.data.status === 'ok') {
                this.authKey = `${response.data.data.key_id}:${response.data.data.key}`;
                console.log('OnlinePBX authenticated successfully');
                return this.authKey;
            } else {
                throw new Error(response.data.comment || 'Authentication failed');
            }
        } catch (error) {
            console.error('OnlinePBX auth error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Получить заголовки для API запросов
     */
    getHeaders() {
        return {
            'x-pbx-authentication': this.authKey || this.apiKey,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Инициировать исходящий звонок
     * @param {string} from - Внутренний номер (номер менеджера)
     * @param {string} to - Номер для звонка
     * @returns {Promise<Object>} Результат инициации звонка
     */
    async makeCall(from, to) {
        try {
            // Нормализуем ОБА номера до чистых цифр — это самый надежный формат для API v2
            const normalizedFrom = this.normalizePhone(from);
            const normalizedTo = this.normalizePhone(to);

            console.log(`[ONLINEPBX] Requesting call: ${normalizedFrom} -> ${normalizedTo}`);

            const response = await axios.post(
                `${this.apiUrl}/${this.domain}/call/now.json`,
                {
                    from: normalizedFrom,
                    to: normalizedTo
                },
                { headers: this.getHeaders() }
            );

            console.log('OnlinePBX makeCall response:', response.data);

            // Добавлена проверка response.data.status === '1'
            if (response.data.status === 'ok' || response.data.status === true || response.data.status === '1') {
                return {
                    success: true,
                    callId: response.data.data?.uuid || response.data.data?.call_id,
                    data: response.data.data
                };
            } else {
                return {
                    success: false,
                    error: response.data.comment || 'Call initiation failed'
                };
            }
        } catch (error) {
            console.error('OnlinePBX makeCall error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.comment || error.message
            };
        }
    }

    /**
     * Положить трубку / Прервать вызов
     * @param {string} uuid - ID звонка
     * @returns {Promise<boolean>}
     */
    async hangup(uuid) {
        try {
            console.log(`[ONLINEPBX] Hanging up call: ${uuid}`);
            const response = await axios.post(
                `${this.apiUrl}/${this.domain}/call/hangup.json`,
                { uuid: uuid },
                { headers: this.getHeaders() }
            );
            return response.data.status === 'ok' || response.data.status === true;
        } catch (error) {
            console.error('OnlinePBX hangup error:', error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Инициировать звонок с автоматическим UUID
     * @param {string} from - Внутренний номер менеджера
     * @param {string} to - Номер для звонка
     * @returns {Promise<Object>}
     */
    async makeCallInstantly(from, to) {
        try {
            const normalizedTo = this.normalizePhone(to);

            const response = await axios.post(
                `${this.apiUrl}/${this.domain}/call/instantly.json`,
                {
                    from: from,
                    to: normalizedTo
                },
                { headers: this.getHeaders() }
            );

            console.log('[ONLINEPBX] makeCallInstantly response:', response.data);

            const isOk = response.data.status === 'ok' || response.data.status === true || response.data.status === '1';
            const hasUuid = !!response.data.data?.uuid;

            // Если есть UUID - значит звонок пошел, даже если статус "0" (бывает при USER_BUSY)
            if (isOk || hasUuid) {
                return {
                    success: true,
                    callId: response.data.data?.uuid,
                    data: response.data.data
                };
            } else {
                return {
                    success: false,
                    error: response.data.comment || 'Call initiation failed',
                    isBusy: response.data.comment === 'USER_BUSY'
                };
            }
        } catch (error) {
            const errorData = error.response?.data;
            console.error('[ONLINEPBX] makeCallInstantly error:', errorData || error.message);
            return {
                success: false,
                error: errorData?.comment || error.message,
                isBusy: errorData?.comment === 'USER_BUSY'
            };
        }
    }

    // Если передали полный домен, вырезаем субдомен
    getCleanDomain(domain) {
        // Пробуем использовать полный домен
        return domain;
    }

    /**
     * Нормализация номера телефона
     * @param {string} phone - Номер телефона
     * @param {boolean} keepPlus - Сохранять ли ведущий плюс (по умолчанию нет)
     * @returns {string} Нормализованный номер
     */
    normalizePhone(phone, keepPlus = false) {
        if (!phone) return '';
        const hasPlus = phone.toString().startsWith('+');
        // Удаляем ВСЕ нецифровые символы
        let normalized = phone.toString().replace(/\D/g, '');

        // Если начинается с 8, заменяем на 7
        if (normalized.startsWith('8') && normalized.length === 11) {
            normalized = '7' + normalized.slice(1);
        }

        return (keepPlus && hasPlus) ? '+' + normalized : normalized;
    }

    /**
     * Подключение к WebSocket для получения событий звонков
     * @param {Function} onEvent - Callback для событий
     */
    connectWebSocket(onEvent) {
        // Документация OnlinePBX: wss://{domain}.onpbx.ru:3342/?key={api_key}
        // this.domain уже содержит полный домен (напр. pbx35531.onpbx.ru)
        const wsUrl = `wss://${this.domain}:3342/?key=${this.authKey || this.apiKey}`;

        console.log('Connecting to OnlinePBX WebSocket:', wsUrl);

        // При подключении через URL параметры заголовки обычно не требуются
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log('OnlinePBX WebSocket connected');

            // Подписываемся на события
            // Для API 3.0 (порт 3342) формат подписки может отличаться, но попробуем стандартный
            this.ws.send(JSON.stringify({
                command: 'subscribe',
                data: {
                    events: ['call']
                }
            }));
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log('OnlinePBX WS event:', message);

                if (onEvent) {
                    onEvent(message);
                }

                // Вызываем зарегистрированные обработчики
                const eventType = message.event || message.type;
                if (eventType && this.eventHandlers.has(eventType)) {
                    this.eventHandlers.get(eventType)(message);
                }
            } catch (error) {
                console.error('OnlinePBX WS parse error:', error);
            }
        });

        this.ws.on('error', (error) => {
            console.error('OnlinePBX WebSocket error:', error.message);
        });

        this.ws.on('close', () => {
            console.log('OnlinePBX WebSocket disconnected (reconnect disabled)');
        });
    }

    /**
     * Зарегистрировать обработчик события
     * @param {string} eventType - Тип события (ringing, answered, hangup)
     * @param {Function} handler - Обработчик
     */
    on(eventType, handler) {
        this.eventHandlers.set(eventType, handler);
    }

    /**
     * Отключить WebSocket
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Проверка подключения к API
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            await this.authenticate();

            // Пробуем получить информацию о пользователях
            const response = await axios.get(
                `${this.apiUrl}/${this.domain}/users.json`,
                { headers: this.getHeaders() }
            );

            console.log('OnlinePBX connected, users:', response.data.data?.length || 0);
            return true;
        } catch (error) {
            console.error('OnlinePBX connection failed:', error.response?.data || error.message);
            return false;
        }
    }
}

module.exports = new OnlinePBX();
