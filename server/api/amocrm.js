const axios = require('axios');
const config = require('../../config');

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

    async getPipelines() {
        try {
            const response = await this.axios.get('/leads/pipelines');
            return response.data._embedded.pipelines;
        } catch (error) {
            console.error('Error fetching pipelines:', error.message);
            return [];
        }
    }

    // Fetch leads with filters
    async findLeadsByStatus(statusId = null, pipelineId = null, userId = null, limit = 50) {
        try {
            let url = `/leads?limit=${limit}&with=contacts`;

            // Фильтры
            if (statusId && statusId !== 'all') {
                url += `&filter[statuses][0][status_id]=${statusId}`;
            }
            if (pipelineId && pipelineId !== 'all') {
                url += `&filter[pipeline_id][0]=${pipelineId}`;
            }
            if (userId && userId !== 'all') {
                url += `&filter[responsible_user_id][0]=${userId}`;
            }

            const response = await this.axios.get(url);

            if (!response.data || !response.data._embedded) return [];

            const leads = response.data._embedded.leads;

            // Format leads for Dialer
            const formattedLeads = await Promise.all(leads.map(async (lead) => {
                const contact = await this.getMainContact(lead._embedded?.contacts || []);
                return {
                    id: lead.id,
                    name: lead.name,
                    price: lead.price || 0,
                    status_id: lead.status_id,
                    pipeline_id: lead.pipeline_id,
                    responsible_user_id: lead.responsible_user_id,
                    created_at: lead.created_at || lead.createdAt || 0,
                    updated_at: lead.updated_at || lead.updatedAt || 0,
                    contactName: contact?.name || lead.name || 'Без имени',
                    phone: contact?.phone || null,
                    link: `https://${config.amocrm.subdomain}.amocrm.ru/leads/detail/${lead.id}`,
                    custom_fields_values: lead.custom_fields_values || [],
                    tags: lead._embedded?.tags || []
                };
            }));

            // Filter out leads without phone numbers
            return formattedLeads.filter(l => l.phone);
        } catch (error) {
            console.error('Error finding leads:', error.response?.data || error.message);
            return [];
        }
    }

    async getMainContact(contacts) {
        if (!contacts || contacts.length === 0) return null;
        try {
            // Fetch first contact details to get phone
            const contactId = contacts[0].id;
            const response = await this.axios.get(`/contacts/${contactId}`);
            const contact = response.data;

            const phoneField = contact.custom_fields_values?.find(f => f.field_code === 'PHONE');
            const phone = phoneField ? phoneField.values[0].value : null;

            return {
                name: contact.name,
                phone: phone
            };
        } catch (error) {
            return null;
        }
    }
}

module.exports = new AmoCRM();
