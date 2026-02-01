require('dotenv').config();

module.exports = {
    // AmoCRM
    amocrm: {
        subdomain: process.env.AMOCRM_SUBDOMAIN,
        token: process.env.AMOCRM_TOKEN,
        baseUrl: `https://${process.env.AMOCRM_SUBDOMAIN}.amocrm.ru`,
        apiUrl: 'https://api-b.amocrm.ru'
    },

    // OnlinePBX
    onlinepbx: {
        domain: process.env.ONLINEPBX_DOMAIN,
        apiKey: process.env.ONLINEPBX_API_KEY,
        apiUrl: 'https://api2.onlinepbx.ru',
        managerNumber: process.env.ONLINEPBX_MANAGER_NUMBER || '100'
    },

    // Server
    server: {
        port: process.env.PORT || 3000
    },

    // Dialer settings
    dialer: {
        parallelCalls: 2,           // Предиктивный режим: звоним двум сразу
        waitTimeAfterCall: 180000,  // 3 минуты на заполнение после звонка (мс)
        callTimeout: 30000          // Таймаут ожидания ответа (30 сек)
    }
};
