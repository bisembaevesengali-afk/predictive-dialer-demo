const axios = require('axios');
const config = require('../config');

class AmoCRM {
    constructor() {
        this.baseUrl = `https://${config.amocrm.subdomain}.amocrm.ru/api/v4`;
        this.token = config.amocrm.token;
        this.axios = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async testConnection() {
        try {
            const response = await this.axios.get('/account');
            console.log(`AmoCRM connected: ${response.data.name} (ID: ${response.data.id})`);
            return true;
        } catch (error) {
            console.error('AmoCRM connection failed:', error.response?.data || error.message);
            return false;
        }
    }

    async getUsers() {
        try {
            const response = await this.axios.get('/users?with=role,group');
            return response.data._embedded.users;
        } catch (error) {
            console.error('Error fetching users:', error.message);
            return [];
        }
    }

    async getGroups() {
        try {
            const response = await this.axios.get('/users/groups');
            return response.data._embedded.groups;
        } catch (error) {
            console.error('Error fetching groups:', error.message);
            return [];
        }
    }

    async getPipelines() {
        try {
            const response = await this.axios.get('/leads/pipelines');
            return response.data._embedded.pipelines;
        } catch (error) {
            console.error('Error fetching pipelines:', error.message);
            return [];
        }
    }

    async findLeadsByStatus(statusId = null, pipelineId = null, responsibleUserId = null, limit = 50) {
        try {
            let url = `/leads?limit=${limit}&with=contacts`;
            if (statusId && statusId !== 'all') {
                url += `&filter[statuses][0][status_id]=${statusId}`;
            }
            if (pipelineId && pipelineId !== 'all') {
                url += `&filter[statuses][0][pipeline_id]=${pipelineId}`;
            }
            if (responsibleUserId) {
                url += `&filter[responsible_user_id]=${responsibleUserId}`;
            }

            const response = await this.axios.get(url);

            if (!response.data || !response.data._embedded) return [];

            const leads = response.data._embedded.leads;

            // 1. Собираем ID всех контактов из всех сделок
            const contactIds = [...new Set(leads.flatMap(lead =>
                (lead._embedded?.contacts || []).map(c => c.id)
            ))];

            // 2. Пакетная загрузка контактов (макс. 50 за раз)
            const contactsData = await this.getContactsBulk(contactIds);

            // 3. Форматируем сделки, сопоставляя их с загруженными контактами
            const formattedLeads = leads.map(lead => {
                const leadContactId = lead._embedded?.contacts?.[0]?.id;
                const contactInfo = contactsData[leadContactId] || null;

                return {
                    id: lead.id,
                    name: lead.name,
                    price: lead.price,
                    status_id: lead.status_id,
                    contactName: contactInfo?.name || lead.name || 'Unknown',
                    phone: contactInfo?.phone || null,
                    link: `https://${config.amocrm.subdomain}.amocrm.ru/leads/detail/${lead.id}`
                };
            });

            // Возвращаем все сделки (фильтрация только по наличию телефона не обязательна здесь)
            return formattedLeads;
        } catch (error) {
            console.error('Error finding leads:', error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Пакетная загрузка контактов по ID для экономии лимитов API.
     */
    async getContactsBulk(ids) {
        if (!ids || ids.length === 0) return {};

        try {
            const result = {};
            // Если контактов много, бьем на пачки по 50
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const filter = chunk.map(id => `filter[id][]=${id}`).join('&');
                const response = await this.axios.get(`/contacts?${filter}`);

                if (response.data && response.data._embedded) {
                    response.data._embedded.contacts.forEach(c => {
                        const phoneField = c.custom_fields_values?.find(f => f.field_code === 'PHONE');
                        result[c.id] = {
                            name: c.name,
                            phone: phoneField ? phoneField.values[0].value : null
                        };
                    });
                }
            }
            return result;
        } catch (error) {
            console.error('Bulk contacts fetch failed:', error.message);
            return {};
        }
    }
}

module.exports = new AmoCRM();
