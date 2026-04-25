const { Spanner } = require('@google-cloud/spanner');
const spanner = new Spanner({ projectId: 'workflowos-a0fbf' });
const instance = spanner.instance('game-data');
const db = instance.database('recruitingdb');

async function run() {
  const [rows] = await db.run('SELECT id, name FROM email_templates WHERE is_active = true');
  console.log(rows.map(r => r.toJSON()));
}
run().catch(console.error);
