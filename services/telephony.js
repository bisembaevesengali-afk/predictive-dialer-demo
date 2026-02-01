const EventEmitter = require('events');
const onlinepbx = require('../api/onlinepbx');
const config = require('../config');

class TelephonyService extends EventEmitter {
    constructor() {
        super();
        this.activeCalls = new Map(); // UUID -> Call Data
    }

    /**
     * Инициировать обратный звонок (клиент -> менеджер)
     * @param {string} clientPhone Номер клиента (внешний)
     * @param {string} managerExt Добавочный менеджера (внутренний, напр. 100)
     */
    async initiateReverseCall(clientPhone, managerExt) {
        // Очищаем номера
        const cleanClient = this.formatExternalPhone(clientPhone);
        const cleanManager = managerExt.toString().replace(/\D/g, '');

        console.log(`[TELEPHONY] Initiating Bridge: CLIENT(${cleanClient}) -> MANAGER(${cleanManager})`);

        try {
            // Используем makeCallInstantly: from=клиент, to=менеджер
            // Это обеспечит ПРЕДИКТИВНЫЙ режим: звоним клиентам параллельно, 
            // кто первый взял - того соединяем с менеджером
            const result = await onlinepbx.makeCallInstantly(cleanClient, cleanManager);

            if (result.success) {
                console.log(`[TELEPHONY] API Success. UUID: ${result.callId}`);
                return result;
            } else {
                console.error(`[TELEPHONY] API Error: ${result.error}`);
                return result; // Возвращаем результат даже если ошибка, Dialer его обработает
            }
        } catch (error) {
            console.error(`[TELEPHONY] Call request failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Форматирование внешнего номера. Если нет +, добавляем для международного формата.
     */
    formatExternalPhone(phone) {
        if (!phone) return '';
        let digits = phone.toString().replace(/\D/g, '');

        // Превращаем 8 в 7
        if (digits.startsWith('8') && digits.length === 11) {
            digits = '7' + digits.slice(1);
        }

        // Возвращаем с плюсом для OnlinePBX (надежный формат E.164)
        return '+' + digits;
    }

    /**
     * Обработка входящего вебхука от OnlinePBX
     */
    handleWebhook(data, dialer, broadcast) {
        const uuid = data.uuid || data.call_id;
        let event = data.event || data.status;
        const phone = data.from || data.caller || data.phone;

        console.log(`[TELEPHONY] Webhook: UUID=${uuid}, EVENT=${event}, PHONE=${phone}`);

        // Нормализация события для фронта
        if (event === 'ringing' || event === 'call_start') event = 'ringing';
        if (event === 'answered' || event === 'call_answered' || event === 'The call was answered') event = 'answered';
        if (event === 'hangup' || event === 'call_end' || event === 'call_missed' || event === 'completed' || event === 'The call ended') event = 'hangup';

        const cleanEvent = {
            uuid: uuid,
            event: event,
            raw: data
        };

        // 1. Уведомляем Dialer
        if (event === 'answered') {
            dialer.handleCallAnswered(uuid, cleanEvent);
        } else if (event === 'hangup') {
            dialer.handleCallHangup(uuid, cleanEvent);
        }

        // 2. Транслируем на фронтенд
        if (broadcast) {
            broadcast('pbxEvent', cleanEvent);
            broadcast('call_update', { id: uuid, status: event, data: data });
        }

        return { status: 'ok', event: event };
    }
}

module.exports = new TelephonyService();
