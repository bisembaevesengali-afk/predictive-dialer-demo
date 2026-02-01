const config = require('../config');
const onlinepbx = require('../api/onlinepbx');
const telephony = require('./telephony');
const amocrm = require('../api/amocrm');

class Dialer {
    constructor() {
        this.queue = [];              // Очередь номеров для обзвона
        this.activeCalls = new Map(); // Активные звонки
        this.state = 'stopped';       // stopped, running, paused
        this.parallelCalls = config.dialer.parallelCalls;
        this.callTimeout = config.dialer.callTimeout;
        this.waitTimeAfterCall = config.dialer.waitTimeAfterCall;

        this.currentLead = null;      // Текущая сделка (с которой разговариваем)
        this.isInCall = false;        // Идёт ли разговор
        this.waitingTimer = null;     // Таймер ожидания после звонка

        this.eventHandlers = new Map();

        // Подписываемся на события телефонии
        telephony.on('answered', (data) => this.handleCallAnswered(data.uuid, data));
        telephony.on('hangup', (data) => this.handleCallHangup(data.uuid, data));
    }

    /**
     * Установить очередь для обзвона
     * @param {Array} leads - Массив сделок с телефонами
     */
    setQueue(leads) {
        this.queue = leads.map(lead => ({
            ...lead,
            status: 'pending',  // pending, calling, answered, failed, completed
            attempts: 0
        }));
        this.emit('queueUpdated', this.queue);
    }

    /**
     * Получить текущую очередь
     */
    getQueue() {
        return this.queue;
    }

    /**
     * Получить состояние
     */
    getState() {
        return {
            state: this.state,
            queueLength: this.queue.length,
            pendingCount: this.queue.filter(l => l.status === 'pending').length,
            completedCount: this.queue.filter(l => l.status === 'completed').length,
            failedCount: this.queue.filter(l => l.status === 'failed').length,
            currentLead: this.currentLead,
            isInCall: this.isInCall,
            activeCalls: Array.from(this.activeCalls.values())
        };
    }

    /**
     * Запустить обзвон
     */
    async start() {
        if (this.state === 'running') {
            console.log('Dialer already running');
            return;
        }

        // ТЕСТОВЫЕ НОМЕРА (от пользователя)
        const testLeads = [
            { id: 1001, contactName: 'Тест 1', phone: '+77471616163' },
            { id: 1002, contactName: 'Тест 2', phone: '+77772322323' }
        ];
        console.log('[TEST] Injecting test leads:', testLeads.map(l => l.phone));
        this.setQueue(testLeads);

        this.state = 'running';
        this.emit('stateChanged', this.state);

        // Запускаем цикл обзвона
        this.dialLoop();
    }

    /**
     * Поставить на паузу
     */
    pause() {
        console.log('Pausing dialer...');
        this.state = 'paused';
        this.emit('stateChanged', this.state);
    }

    /**
     * Остановить обзвон
     */
    stop() {
        console.log('Stopping dialer...');
        this.state = 'stopped';
        this.activeCalls.clear();
        this.currentLead = null;
        this.isInCall = false;

        if (this.waitingTimer) {
            clearTimeout(this.waitingTimer);
            this.waitingTimer = null;
        }

        this.emit('stateChanged', this.state);
    }

    /**
     * Основной цикл обзвона
     */
    async dialLoop() {
        while (this.state === 'running') {
            // Если идёт разговор - ждём и не звоним новым
            if (this.isInCall) {
                await this.sleep(1000);
                continue;
            }

            // Если лимит звонков исчерпан - ждём
            if (this.activeCalls.size >= this.parallelCalls) {
                await this.sleep(500);
                continue;
            }

            // Если включен таймер ожидания после звонка
            if (this.waitingTimer) {
                await this.sleep(500);
                continue;
            }

            // Сколько слотов свободно
            const freeSlots = this.parallelCalls - this.activeCalls.size;

            // Получаем следующие номера для обзвона
            const pendingLeads = this.queue.filter(l => l.status === 'pending');

            if (pendingLeads.length === 0 && this.activeCalls.size === 0) {
                console.log('Queue empty, stopping dialer');
                this.stop();
                this.emit('queueEmpty');
                break;
            }

            if (pendingLeads.length === 0) {
                await this.sleep(1000);
                continue;
            }

            // Берем столько лидов, сколько есть свободных слотов
            const toCall = pendingLeads.slice(0, freeSlots);
            console.log(`[DIALER] Slots: ${this.activeCalls.size}/${this.parallelCalls}. To call: ${toCall.map(l => l.phone).join(', ')}`);

            // Запускаем звонки с небольшой задержкой между ними
            for (const lead of toCall) {
                // ПРОВЕРКА ВНУТРИ ЦИКЛА: Если кто-то за это время ответил или мы ушли в ожидание — стоп
                if (this.isInCall || this.waitingTimer) {
                    console.log('[DIALER] Stopping batch initiation: manager is busy or in waiting mode');
                    break;
                }

                await this.initiateCall(lead).catch(err => console.error('Dial loop error:', err));
                if (toCall.length > 1) await this.sleep(1500); // 1.5 сек между запусками
            }

            // Небольшая пауза перед следующим циклом
            await this.sleep(1000);
        }
    }

    /**
     * Нормализует телефонный номер до чистых цифр.
     * @param {string|number} phone - Телефонный номер.
     * @returns {string} Нормализованный номер.
     */
    normalizePhone(phone) {
        if (!phone) return '';
        // Удаляем ВСЕ нецифровые символы (даже +)
        let normalized = phone.toString().replace(/\D/g, '');

        // Если начинается с 8, заменяем на 7
        if (normalized.startsWith('8') && normalized.length === 11) {
            normalized = '7' + normalized.slice(1);
        }

        return normalized;
    }

    /**
     * Инициировать звонок
     * @param {Object} lead - Сделка для звонка
     */
    async initiateCall(lead) {
        console.log(`[DIALER] Initiating call to ${lead.contactName} (${lead.phone})`);

        lead.status = 'calling';
        lead.attempts++;
        this.emit('leadStatusChanged', lead);

        try {
            const result = await telephony.initiateReverseCall(
                lead.phone,
                config.onlinepbx.managerNumber
            );

            if (result.success) {
                const callId = result.callId;

                this.activeCalls.set(callId, {
                    callId,
                    lead,
                    startTime: Date.now(),
                    status: 'ringing'
                });

                this.emit('callInitiated', { callId, lead });

                // Устанавливаем таймаут на звонок
                setTimeout(() => {
                    this.handleCallTimeout(callId);
                }, this.callTimeout);

            } else {
                console.error(`[DIALER] Call initiation failed for ${lead.phone}:`, result.error);
                lead.status = 'failed';
                lead.error = result.error;
                this.emit('leadStatusChanged', lead);
            }
        } catch (error) {
            console.error(`[DIALER] Initiation ERROR for ${lead.phone}:`, error.message);
            lead.status = 'failed';
            lead.error = error.message;
            this.emit('leadStatusChanged', lead);
        }
    }

    /**
     * Обработка таймаута звонка
     */
    handleCallTimeout(callId) {
        const call = this.activeCalls.get(callId);
        if (call && call.status === 'ringing') {
            console.log('Call timeout:', callId);

            call.lead.status = 'failed';
            call.lead.error = 'no_answer';
            this.activeCalls.delete(callId);

            this.emit('callTimeout', call);
            this.emit('leadStatusChanged', call.lead);
        }
    }

    /**
     * Обработка события ответа на звонок
     * @param {string} callId - ID звонка
     * @param {Object} eventData - Данные события
     */
    handleCallAnswered(callId, eventData) {
        let call = this.activeCalls.get(callId);

        if (!call) {
            // Проверяем ВСЕ возможные поля телефона в вебхуке OnlinePBX
            const phoneFromWebhook =
                eventData.raw?.caller ||
                eventData.raw?.callee ||
                eventData.raw?.from ||
                eventData.raw?.to ||
                eventData.phone;

            if (phoneFromWebhook) {
                // Ищем по последним 10 цифрам, очищая от любого мусора
                const cleanPhone = this.normalizePhone(phoneFromWebhook);
                console.log(`[DIALER] Searching call by phone suffix: ${cleanPhone}`);

                for (const [id, c] of this.activeCalls) {
                    const leadPhone = this.normalizePhone(c.lead.phone);
                    if (leadPhone && leadPhone === cleanPhone) {
                        console.log(`[DIALER] Found match by phone: ${c.lead.contactName}`);
                        return this.handleCallAnswered(id, eventData);
                    }
                }
            }
            console.log('Call not found by UUID or Phone:', callId);
            return;
        }

        console.log('Call answered:', call.lead.contactName);

        // Отменяем все остальные звонки в OnlinePBX
        for (const [id, c] of this.activeCalls) {
            if (id !== callId) {
                console.log(`[DIALER] Terminating redundant call to ${c.lead.contactName} (${c.lead.phone})`);
                onlinepbx.hangup(id).catch(err => console.error('Hangup error:', err.message));

                c.lead.status = 'pending'; // Возвращаем в очередь
                this.emit('leadStatusChanged', c.lead);
                this.activeCalls.delete(id);
            }
        }

        // Устанавливаем текущий звонок
        call.lead.status = 'answered';
        call.status = 'answered';
        this.currentLead = call.lead;
        this.isInCall = true;
        this.activeCalls.set(callId, call);

        console.log(`[DIALER] Call ANSWERED by ${call.lead.contactName}. Link: ${call.lead.link || 'NONE'}`);

        this.emit('callAnswered', call);
        this.emit('leadStatusChanged', call.lead);
    }

    /**
     * Обработка завершения звонка
     * @param {string} callId - ID звонка
     * @param {Object} eventData - Данные события
     */
    handleCallHangup(callId, eventData) {
        const call = this.activeCalls.get(callId);

        if (!call) {
            // Попробуем найти по номеру
            for (const [id, c] of this.activeCalls) {
                this.handleCallHangup(id, eventData);
                return;
            }
            return;
        }

        console.log('Call hangup:', call.lead.contactName);

        if (this.isInCall && this.currentLead?.id === call.lead.id) {
            // Разговор завершён - даём время на заполнение
            call.lead.status = 'completed';
            this.isInCall = false;

            this.emit('callEnded', call);
            this.emit('leadStatusChanged', call.lead);

            // Пауза для заполнения
            this.startWaitingTimer();
        } else {
            // Звонок не состоялся
            call.lead.status = 'failed';
            call.lead.error = 'no_answer';
            this.emit('leadStatusChanged', call.lead);
        }

        this.activeCalls.delete(callId);
        this.currentLead = null;
    }

    /**
     * Запустить таймер ожидания после звонка
     */
    startWaitingTimer() {
        console.log('Starting waiting timer:', this.waitTimeAfterCall / 1000, 'seconds');

        this.emit('waitingStarted', {
            duration: this.waitTimeAfterCall
        });

        this.waitingTimer = setTimeout(() => {
            console.log('Waiting timer ended, resuming calls');
            this.waitingTimer = null;
            this.emit('waitingEnded');
        }, this.waitTimeAfterCall);
    }

    /**
     * Пропустить ожидание и продолжить звонки
     */
    skipWaiting() {
        if (this.waitingTimer) {
            clearTimeout(this.waitingTimer);
            this.waitingTimer = null;
            this.emit('waitingEnded');
        }
    }

    /**
     * Отметить результат звонка
     * @param {number} leadId - ID сделки
     * @param {string} result - Результат (success, failed, callback)
     * @param {string} comment - Комментарий
     */
    setCallResult(leadId, result, comment = '') {
        const lead = this.queue.find(l => l.id === leadId);
        if (lead) {
            lead.callResult = result;
            lead.comment = comment;
            lead.status = 'completed';
            this.emit('leadStatusChanged', lead);
        }
    }

    /**
     * Подписка на события
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    /**
     * Отправка события
     */
    emit(event, data) {
        const handlers = this.eventHandlers.get(event) || [];
        handlers.forEach(handler => handler(data));
    }

    /**
     * Утилита для ожидания
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new Dialer();
