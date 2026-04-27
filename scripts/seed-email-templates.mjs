/**
 * Seed script: Migrates static template-catalog.ts entries into Spanner email_templates table.
 * 
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=workflowos-a0fbf node scripts/seed-email-templates.mjs
 * 
 * Idempotent: Uses INSERT OR UPDATE so it's safe to re-run.
 */

import { Spanner } from '@google-cloud/spanner';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
if (!PROJECT) { console.error('Missing GOOGLE_CLOUD_PROJECT'); process.exit(1); }

const spanner = new Spanner({ projectId: PROJECT });
const db = spanner.instance('game-data').database('recruitingdb');

const SIGNATURE = `Best,\nKofi Farkye\nSenior Recruiter, Fulfillment Specialist\nP: 858-529-7267 Ext: 17017`;

/** @type {Array<{id: string, name: string, category: string, message_type: string, internal_only: boolean, subject_template: string, body_template: string, to_default?: string, cc_default?: string, required_fields: string[], signature?: string}>} */
const TEMPLATES = [
  // ── OUTREACH ──────────────────────────────────────────────
  {
    id: 'initial_outreach',
    name: '📧 EMAIL: Initial Outreach – Full Details',
    category: 'outreach',
    message_type: 'email',
    internal_only: false,
    required_fields: ['name', 'specialty', 'facility', 'city', 'state', 'grossWeeklyPay'],
    subject_template: '{{specialty}} Assignment - {{facility}} | {{grossWeeklyPay}}/week',
    body_template: `Hi {{firstName}},

Thanks for your interest in the {{specialty}} position at {{facility}}. Here is the full breakdown, this looks like an excellent match for your background:

Facility: {{facility}}
Location: {{city}}, {{state}}
Assignment Dates: {{startDate}} to {{endDate}}
Shifts & Hours: {{shiftType}} ({{weeklyHours}} hours/week)

Pay Package:
Taxable Hourly Rate: {{taxableRate}}/hr
Meals & Housing Stipend: {{weeklyStipend}}/week
Total Gross Weekly Pay: {{grossWeeklyPay}}

If this looks like a good fit, I can help move this along today and make sure you are submitted ASAP.

To get everything ready, please confirm:
- Are you available to start {{startDate}}?
- Do you have any time-off requests during the contract?
- Is your Aya profile current with your work history and skills checklist?

Please also send over your current certifications. If your profile is not fully updated yet, no worries. You can send me your current resume too, and I can help keep things moving.

Please let me know if you have any questions.

Thank you!`,
  },
  {
    id: 'hourly_rate_outreach',
    name: '📧 EMAIL: Hourly Rate Offer',
    category: 'outreach',
    message_type: 'email',
    internal_only: false,
    required_fields: ['name', 'facility', 'taxableRate'],
    subject_template: '{{specialty}} Assignment – {{facility}} | {{hourlyRate}}/hr',
    body_template: `Hi {{firstName}},

Thanks for your interest in the {{specialty}} position at {{facility}}.
Here's the full breakdown — this looks like a great match for your background:

Facility: {{facility}}
Location: {{city}}, {{state}}
Assignment Dates: {{startDate}} – {{endDate}}
Shifts & Hours: {{shiftType}} ({{weeklyHours}}hrs/week)
Hourly Rate: {{hourlyRate}}/hr

This role is moving quickly — I can get you submitted today if everything looks good.

To move forward, just confirm:

Are you available to start {{startDate}}?
Do you have any time-off requests during the contract?
Is your Aya profile current (work history, certs, skills checklist)?

Please let me know if you have any questions.

Thank you!`,
  },
  {
    id: 'reengagement',
    name: '📧 EMAIL: Re-engagement – Full Details Pitch',
    category: 'outreach',
    message_type: 'email',
    internal_only: false,
    required_fields: ['name', 'facility', 'specialty', 'grossWeeklyPay'],
    subject_template: '{{facility}} Assignment in {{city}}, {{state}} - {{grossWeeklyPay}}/week',
    body_template: `Hi {{firstName}},

It's been a while, I hope you're doing great!

I was scrolling through assignments and immediately thought of you for this great {{specialty}} role, given your background. Here are the full details:

Facility: {{facility}}
Location: {{city}}, {{state}}
Assignment Dates: {{startDate}} – {{endDate}}
Shifts & Hours: {{shiftType}} ({{weeklyHours}} hours/week)

Pay Package:
Taxable Hourly Rate: {{taxableRate}}/hr
Meals & Housing Stipend: {{weeklyStipend}}/week
Total Gross Weekly Pay: {{grossWeeklyPay}}

This is a highly competitive role, and I'd love to get your file submitted right away.

Are you available to start {{startDate}}, or when would be the best time for you to start your next travel assignment?

Let me know if you have any questions!`,
    signature: SIGNATURE,
  },
  {
    id: 'text_quick_pitch',
    name: '💬 TEXT: Quick Pitch',
    category: 'outreach',
    message_type: 'sms',
    internal_only: false,
    required_fields: ['name', 'facility', 'grossWeeklyPay'],
    subject_template: 'Text Message',
    body_template: `Hi {{firstName}}! Quick heads up on an amazing opportunity:

Facility: {{facility}}
Location: {{city}}, {{state}}
Assignment Dates: {{startDate}} – {{endDate}}
Shifts: {{shiftType}} ({{weeklyHours}} hrs/wk)
Specialty: {{specialty}}

Pay Package:
Hourly: {{taxableRate}}/hr
Stipends: {{weeklyStipend}}/wk
Total Gross: {{grossWeeklyPay}}/wk

Please let me know if you would like to be submitted!`,
  },
  {
    id: 'text_followup',
    name: '💬 TEXT: Follow-up Check',
    category: 'outreach',
    message_type: 'sms',
    internal_only: false,
    required_fields: ['name', 'facility'],
    subject_template: 'Text Message',
    body_template: `Hi {{firstName}} - Just circling back on the {{specialty}} position at {{facility}} ({{grossWeeklyPay}}/wk). Still interested? Let me know either way so I can update my notes. Thanks!`,
  },
  {
    id: 'text_urgent',
    name: '💬 TEXT: Urgent – Fast Decision',
    category: 'outreach',
    message_type: 'sms',
    internal_only: false,
    required_fields: ['name', 'facility', 'specialty'],
    subject_template: 'Text Message',
    body_template: `{{firstName}} - URGENT: {{facility}} needs {{specialty}} by {{startDate}}. {{grossWeeklyPay}}/wk. They're deciding TODAY. Can you talk now?`,
  },
  {
    id: 'text_submitted',
    name: '💬 TEXT: Submission Confirmation',
    category: 'outreach',
    message_type: 'sms',
    internal_only: false,
    required_fields: ['name', 'facility'],
    subject_template: 'Text Message',
    body_template: `{{firstName}} - Great news! You're submitted to {{facility}}. They typically respond within 24-48 hours. I'll text you as soon as I hear back. Fingers crossed!`,
  },
  {
    id: 'text_offer_received',
    name: '💬 TEXT: Offer Received',
    category: 'outreach',
    message_type: 'sms',
    internal_only: false,
    required_fields: ['name', 'facility', 'grossWeeklyPay'],
    subject_template: 'Text Message',
    body_template: `{{firstName}} - OFFER IN! {{facility}} wants you! {{grossWeeklyPay}}/week confirmed. Call me ASAP to review details.`,
  },
  {
    id: 'submission_with_references',
    name: '📧 EMAIL: Assignment Submission + Reference Instructions',
    category: 'outreach',
    message_type: 'email',
    internal_only: false,
    required_fields: ['name', 'facility', 'specialty'],
    subject_template: '{{facility}} – Application Submitted',
    body_template: `Hi {{firstName}},

Thanks for chatting with me today about the position at {{facility}}.

Facility: {{facility}}
Location: {{city}}, {{state}}
Assignment Dates: {{startDate}} – {{endDate}}
Shifts & Hours/Week: {{shiftType}} ({{weeklyHours}} hours/week)
Specialty: {{specialty}}

Pay Package:
Taxable Hourly Rate: {{taxableRate}}/hr
Weekly Meals Stipend: {{mealsStipend}}
Weekly Housing Stipend: {{housingStipend}}
Total Weekly Stipends (Meals + Housing): {{weeklyStipend}}
Total Gross Weekly Pay for {{weeklyHours}} Hours Worked: {{grossWeeklyPay}}

I've submitted your application and will keep you posted as soon as I hear back.

Reference Instructions:
To help your application move forward, please ask a supervisor (Team Lead, Charge Nurse, Unit Manager, or Director) to complete the attached reference form and email it to References@ayahealthcare.com, CC'ing me at Kofi.Farkye@ayahealthcare.com for tracking.

Please let me know if you have any questions.`,
    signature: SIGNATURE,
  },

  // ── OPS ────────────────────────────────────────────────────
  {
    id: 'ops_reassignment',
    name: '🛠 OPS: Reassignment Request',
    category: 'ops',
    message_type: 'email',
    internal_only: true,
    required_fields: ['name'],
    to_default: 'reassignments@ayahealthcare.com',
    subject_template: 'Please Reassign - {{name}}',
    body_template: `Hi Team,

Can we please reassign {{name}}

Email: {{email}}

Thank you!`,
    signature: SIGNATURE,
  },
  {
    id: 'ops_documents_and_references',
    name: '🛠 OPS: Documents & References',
    category: 'ops',
    message_type: 'email',
    internal_only: false,
    required_fields: ['name', 'specialty'],
    subject_template: 'Items Needed to Complete Your Application - {{specialty}} Position',
    body_template: `Hi {{firstName}},

Awesome — thanks for confirming!

I'll need a couple more items to complete your file before submission:

• Please send me a copy of your {{specialty}} so we can keep your file complete.
• I'll also need two supervisory references from the last two years (charge nurse, manager, or supervisor). I've attached a reference form; please have them email it to References@ayahealthcare.com and CC me.

Once we receive your certification and references, I'll move your application forward right away.

Process Timeline:
• Aya's clinical team reviews your file first
• Your profile is then sent to the facility's unit manager
• We typically hear back within 72 hours of submission

Your Benefits as an Aya Traveler:
• Day one medical, dental, and vision coverage
• Industry-leading 401k match (up to 4%)
• License reimbursements
• Sick time
• Dedicated support team

I've attached the reference form and benefits guide as well. Happy to help with any questions.

Thank you!`,
  },
  {
    id: 'ops_licensing_info',
    name: '🛠 OPS: Licensing Info Request',
    category: 'ops',
    message_type: 'email',
    internal_only: true,
    required_fields: ['specialty', 'state'],
    subject_template: 'Licensing - {{specialty}} - {{state}}',
    body_template: `Hi Team,

Can I please have licensing information for {{specialty}} in {{state}}?

Thank you!`,
  },
  {
    id: 'margin_approval',
    name: '💰 OPS: Low Margin Approval Request',
    category: 'ops',
    message_type: 'email',
    internal_only: true,
    required_fields: ['name'],
    to_default: 'team.managers.approval@ayahealthcare.com',
    subject_template: 'Margin Approval: {{name}} – {{actualMargin}}%',
    body_template: `Reason needed for approval (please include all details and information to fully understand your request):
[Insert reason here]

Is this a New Placement, Extension, or Change of Contract? (If COC, attach any previous margin approvals):
[New Placement / Extension / COC]

Is premium approval needed? Why?:
[Yes/No - Reason]

Was this sent to Comp Info Y/N?
[Y/N]

If yes, what was the distro's response? Please attach the email if applicable.
[Distro response here]

For Extensions, include the following:
What's the TM % for this contract? (If BR is changing on an extension offer, TM will be provided by AM):
[TM %]

Did you review why there was a variance on the initial contract?
[Yes/No]

What was the initial reason for the lower margin? (Attach prior approval for faster review—reference where it first started, even if a few contracts ago):
[Reason]

Insert link to deals tab ➔ [Link here]`,
    signature: SIGNATURE,
  },

  // ── RESPONSE ───────────────────────────────────────────────
  {
    id: 'response_ltc_and_references',
    name: '✉️ RESPONSE: LTC & Reference Request',
    category: 'response',
    message_type: 'email',
    internal_only: false,
    required_fields: ['name'],
    to_default: '{{email}}',
    subject_template: 'Next Steps: {{facility}}',
    body_template: `Hi {{firstName}},

Awesome — thanks for confirming!

I'll need a couple more items to complete your file before submission:

• Please send me a copy of your LTC so we can keep your file complete.
• I'll also need two supervisory references from the last two years (charge nurse, manager, or supervisor). I've attached a reference form; please have them email it to References@ayahealthcare.com and CC me.

Once we receive your certification and references, I'll move your application forward right away.

Process Timeline:
• Aya's clinical team reviews your file first
• Your profile is then sent to the facility's unit manager
• We typically hear back within 72 hours of submission

Your Benefits as an Aya Traveler:
• Day one medical, dental, and vision coverage
• Industry-leading 401k match (up to 4%)
• License reimbursements
• Sick time
• Dedicated support team — me as your recruiter + Tiffany Chavez (my assistant)

I've attached the reference form and benefits guide as well. Happy to help with any questions.

Thank you!`,
  },
];

async function seed() {
  console.log(`Seeding ${TEMPLATES.length} templates into recruitingdb.email_templates...`);
  
  const table = db.table('email_templates');
  const now = Spanner.timestamp(new Date());

  const rows = TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    category: t.category,
    message_type: t.message_type,
    internal_only: t.internal_only,
    subject_template: t.subject_template,
    body_template: t.body_template,
    to_default: t.to_default || null,
    cc_default: t.cc_default || null,
    required_fields: JSON.stringify(t.required_fields),
    signature: t.signature || null,
    created_by: 'seed-script',
    updated_by: 'seed-script',
    created_at: now,
    updated_at: now,
    version: 1,
    is_active: true,
  }));

  await table.upsert(rows);
  console.log(`✅ Seeded ${rows.length} templates successfully.`);

  // Verify
  const [verifyRows] = await db.run({ sql: 'SELECT id, name, category FROM email_templates ORDER BY category, id' });
  console.log('\nVerification:');
  for (const row of verifyRows) {
    const r = row.toJSON();
    console.log(`  ${r.category}/${r.id} → ${r.name}`);
  }

  await spanner.close();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
