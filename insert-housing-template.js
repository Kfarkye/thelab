const { Spanner } = require('@google-cloud/spanner');

const spanner = new Spanner({ projectId: 'workflowos-a0fbf' });
const instance = spanner.instance('game-data');
const db = instance.database('recruitingdb');

async function insertHousingTemplate() {
  try {
    await db.runTransactionAsync(async (tx) => {
      const subjectTemplate = "Housing Options Breakdown - [CANDIDATE NAME] | [SPECIALTY] at [FACILITY NAME]";
      const bodyTemplate = `Hi team!

Can you please send a breakdown of Aya housing options for [CANDIDATE NAME]?

Apt/Ext Stay: [PREFERENCE]
Hospital: [FACILITY NAME]
Profession/Specialty: [SPECIALTY]
Crisis? (Y/N): [Y/N]
Rapid Response? (Y/N): [Y/N]
Float Pool? (Y/N): [Y/N]
City/State: [CITY, STATE]
Start Date: [START DATE]
Length of Contract: [LENGTH] weeks
Pets? (Breed and Weight): [PET DETAILS OR N/A]
Additional Occupants? (names/ages): [OCCUPANT DETAILS OR N/A]
Will the traveler have a car?: [Y/N]`;

      await tx.runUpdate({
        sql: `INSERT INTO email_templates (
                id, name, category, message_type, internal_only, 
                subject_template, body_template, to_default, cc_default,
                required_fields, signature, version, is_active, created_at, updated_at
              ) VALUES (
                'housing_options_breakdown', 
                '🏠 OPS: Housing Options Breakdown Request', 
                'ops', 
                'email', 
                true,
                @subjectTemplate,
                @bodyTemplate,
                'housing@ayahealthcare.com',
                null,
                '["name", "facility", "specialty", "city", "state", "startDate"]',
                null,
                1,
                true,
                CURRENT_TIMESTAMP(),
                CURRENT_TIMESTAMP()
              )`,
        params: {
          subjectTemplate,
          bodyTemplate
        }
      });
      await tx.commit();
      console.log("Successfully inserted housing_options_breakdown into Spanner.");
    });
  } catch (err) {
    console.error("Error inserting template:", err);
  } finally {
    await db.close();
  }
}

insertHousingTemplate();
