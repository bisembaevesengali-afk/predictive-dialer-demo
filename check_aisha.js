const amocrm = require('./server/api/amocrm');

async function findAisha() {
    try {
        const response = await amocrm.axios.get('/leads?with=contacts&limit=50');
        const leads = response.data._embedded.leads;
        console.log('Total leads found:', leads.length);

        for (const lead of leads) {
            const contact = await amocrm.getMainContact(lead._embedded?.contacts || []);
            if (contact && (contact.name.includes('Aisha') || contact.phone?.includes('77778811411'))) {
                console.log('--- FOUND Aisha ---');
                console.log(JSON.stringify(lead, null, 2));
                console.log('Formatted Contact:', contact);
                return;
            }
        }
        console.log('Aisha not found in first 50 leads');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

findAisha();
