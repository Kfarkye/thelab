// /outreach/templates.ts
// Pristine, structured, organized. Shared by EmailTemplateModal and OutreachTemplateManager.

// Re-including the necessary interface/type definition (schema)
export interface ExtractedOfferData {
  name: string;
  email: string;
  facility: string;
  city: string;
  state: string;
  shiftType: string;
  weeklyHours: number;
  startDate: string | null;
  endDate: string | null;
  taxableRate: number;
  weeklyStipend: number;
  grossWeeklyPay: number;
  specialty: string;
  jobId: number | null;
  candidateId: number | null;
  actualMargin?: number | null;
}

export interface EmailTemplate {
  id: string;
  name: string;
  requiredFields?: (keyof ExtractedOfferData)[];
  messageType?: 'email' | 'sms';
  internalOnly?: boolean;
  category?: TemplateCategory;
  generateContent: (data: ExtractedOfferData) => { subject: string; body: string; to?: string; cc?: string };
}

export type TemplateCategory = 'outreach' | 'ops' | 'response';

/** 
 * Scans payload for required fields and returns a list of missing keys.
 */
export function getMissingRequiredFields(data: Partial<ExtractedOfferData>, template: EmailTemplate): string[] {
  if (!template.requiredFields || template.requiredFields.length === 0) return [];
  return template.requiredFields.filter(field => {
    const val = data[field];
    return val === undefined || val === null || val === '';
  });
}

const currency = (n?: number | null) =>
  n == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n));

const shortDate = (ds?: string | null, fallback: string = 'ASAP') => {
  if (!ds) return fallback;
  const d = new Date(`${ds}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? fallback
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatCurrencyRate = (rate?: number | null): string => {
  if (rate == null || Number.isNaN(Number(rate)) || Number(rate) === 0) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(rate));
};

const getFirstName = (fullName: string): string => fullName.split(' ')[0] || '';
const getFacilityName = (name: string): string => name.replace(' at ', ' ').trim();

// ----------------------
// Outreach (candidate-facing)
// ----------------------
export const OUTREACH_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'initial_outreach',
    name: '📧 EMAIL: Initial Outreach – Full Details',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'specialty', 'facility', 'city', 'state', 'grossWeeklyPay'],
    generateContent: (d) => ({
      subject: `${d.specialty} Assignment – ${d.facility} | ${currency(d.grossWeeklyPay)}/week`,
      body: `Hi ${d.name.split(' ')[0] || ''},

Thanks for your interest in the ${d.specialty} position at ${d.facility}. Here's the full breakdown — this looks like an excellent match for your background:

Facility: ${d.facility}
Location: ${d.city}, ${d.state}
Assignment Dates: ${shortDate(d.startDate)} – ${shortDate(d.endDate)}
Shifts & Hours: ${d.shiftType} (${d.weeklyHours} hours/week)

Pay Package:
Taxable Hourly Rate: ${currency(d.taxableRate)}/hr
Meals & Housing Stipend: ${currency(d.weeklyStipend)}/week
Total Gross Weekly Pay: ${currency(d.grossWeeklyPay)}

This role is moving quickly — I can get you submitted today if everything looks good.

To move forward, just confirm:
- Are you available to start ${shortDate(d.startDate)}?
- Do you have any time-off requests during the contract?
- Is your Aya profile current (work history, certs, skills checklist)?

Please let me know if you have any questions.

Thank you!`,
    }),
  },
  {
    id: 'hourly_rate_outreach',
    name: '📧 EMAIL: Hourly Rate Offer',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'facility', 'taxableRate'],
    generateContent: (d) => {
      const firstName = getFirstName(d.name);
      const hourlyRate = formatCurrencyRate(d.taxableRate + (d.weeklyStipend / (d.weeklyHours || 40)));
      const facilityName = getFacilityName(d.facility);

      return {
        subject: `${d.specialty || '[Specialty]'} Assignment – ${facilityName || '[Facility Name]'} | ${hourlyRate}/hr`,
        body: `Hi ${firstName || '[First Name]'},

Thanks for your interest in the ${d.specialty || '[Specialty]'} position at ${facilityName || '[Facility Name]'}.
Here's the full breakdown — this looks like a great match for your background:

Facility: ${facilityName || '[Facility Name]'}
Location: ${d.city || '[City]'}, ${d.state || '[State]'}
Assignment Dates: ${shortDate(d.startDate)} – ${shortDate(d.endDate)}
Shifts & Hours: ${d.shiftType || '[Shift Type]'} (${d.weeklyHours}hrs/week)
Hourly Rate: ${hourlyRate}/hr

This role is moving quickly — I can get you submitted today if everything looks good.

To move forward, just confirm:

Are you available to start ${shortDate(d.startDate)}?
Do you have any time-off requests during the contract?
Is your Aya profile current (work history, certs, skills checklist)?

Please let me know if you have any questions.

Thank you!`,
      };
    },
  },
  {
    id: 'rush_ma_full_details',
    name: '📧 EMAIL: Rush MA – Full Details + References',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'facility', 'city', 'state'],
    generateContent: (d) => {
      const hours =
        d.weeklyHours === 40 ? '5x8s (40 hours/week)' :
          d.weeklyHours === 36 ? '3x12s (36 hours/week)' :
            d.weeklyHours === 48 ? '4x12s (48 hours/week)' :
              `${d.shiftType} (${d.weeklyHours} hours/week)`;

      const comp =
        d.weeklyStipend && d.grossWeeklyPay
          ? `Total Weekly Pay: ${currency(d.grossWeeklyPay)}`
          : `Hourly Rate: ${currency(d.taxableRate)}/hr`;

      return {
        subject: `Medical Assistant – Rush University Medical Center (${d.city}, ${d.state})`,
        body: `Hi ${d.name.split(' ')[0] || ''},

Thanks for your interest in the Medical Assistant opening at Rush University Medical Center. Here are the details:

Facility: Rush University Medical Center
Location: ${d.city}, ${d.state}
Assignment Dates: ${shortDate(d.startDate)} – ${shortDate(d.endDate)}
Shifts & Hours: ${hours}
${comp}

This role is moving quickly—I can get you submitted today if everything looks good.

To move forward, please confirm availability for ${shortDate(d.startDate)}, any RTO, and that your Aya profile is current.

When you have a moment, please send a copy of your CMA (NHA, AMT, or AAMA).
I'll also need two supervisory references from the last two years (charge nurse/manager/supervisor). They can email the form to References@ayahealthcare.com and CC me.

Thank you!`,
      };
    },
  },
  {
    id: 'reengagement',
    name: '📧 EMAIL: Re-engagement – Full Details Pitch',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'facility', 'specialty', 'grossWeeklyPay'],
    generateContent: (d) => ({
      subject: `${d.facility} Assignment in ${d.city}, ${d.state} - ${currency(d.grossWeeklyPay)}/week`,
      body: `Hi ${d.name.split(' ')[0] || ''},

It's been a while, I hope you're doing great!

I was scrolling through assignments and immediately thought of you for this great ${d.specialty} role, given your background. Here are the full details:

Facility: ${d.facility}
Location: ${d.city}, ${d.state}
Assignment Dates: ${shortDate(d.startDate)} – ${shortDate(d.endDate)}
Shifts & Hours: ${d.shiftType} (${d.weeklyHours} hours/week)

Pay Package:
Taxable Hourly Rate: ${currency(d.taxableRate)}/hr
Meals & Housing Stipend: ${currency(d.weeklyStipend)}/week
Total Gross Weekly Pay: ${currency(d.grossWeeklyPay)}

This is a highly competitive role, and I'd love to get your file submitted right away.

Are you available to start ${shortDate(d.startDate)}, or when would be the best time for you to start your next travel assignment?

Let me know if you have any questions!

Best,
[Your name]`,
    }),
  },
  {
    id: 'working_traveler_interest',
    name: '📧 EMAIL: Working Traveler – Interested Click',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'facility'],
    generateContent: (d) => ({
      subject: `${d.specialty} – ${d.facility} | ${currency(d.grossWeeklyPay)}/week`,
      body: `Hi ${d.name.split(' ')[0] || ''},

I saw you clicked interested on this one — here are the details:

Facility: ${d.facility}
Location: ${d.city}, ${d.state}
Dates: ${shortDate(d.startDate)} - ${shortDate(d.endDate)}
Shift: ${d.shiftType} (${d.weeklyHours} hrs/wk)

Pay: ${currency(d.taxableRate)}/hr + ${currency(d.weeklyStipend)}/wk stipends = ${currency(d.grossWeeklyPay)}/wk

Let me know if you have any time-off needs and I'll get you submitted!

Thank you!`,
    }),
  },
  {
    id: 'reengaged_traveler_interest',
    name: '📧 EMAIL: Re-Engaged Traveler – Interested Click',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'facility'],
    generateContent: (d) => ({
      subject: `${d.specialty} – ${d.facility} | ${currency(d.grossWeeklyPay)}/week`,
      body: `Hi ${d.name.split(' ')[0] || ''},

I hope you're doing well! I saw you clicked interested on this one — here are the details:

Facility: ${d.facility}
Location: ${d.city}, ${d.state}
Dates: ${shortDate(d.startDate)} - ${shortDate(d.endDate)}
Shift: ${d.shiftType} (${d.weeklyHours} hrs/wk)

Pay: ${currency(d.taxableRate)}/hr + ${currency(d.weeklyStipend)}/wk stipends = ${currency(d.grossWeeklyPay)}/wk

Let me know if you have any time-off needs and I'll get you submitted. Happy to jump on a quick call if you'd like to chat through anything!

Thank you!`,
    }),
  },
  {
    id: 'competitive_offer',
    name: '📧 EMAIL: Competitive Counter Offer',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'facility', 'grossWeeklyPay'],
    generateContent: (d) => {
      const enhancedPay = d.grossWeeklyPay * 1.05;

      return {
        subject: `${d.name.split(' ')[0] || ''}, we can beat that offer`,
        body: `Hi ${d.name.split(' ')[0] || ''},

I heard you might be considering another opportunity. Before you make a decision, let me share what we can offer:

${d.facility} - ${d.city}, ${d.state}
• ${currency(enhancedPay)}/week (enhanced rate)
• Completion bonus available
• Guaranteed hours
• Day 1 health benefits
• Free private housing option

Plus, with Aya you get:
• 24/7 clinical support
• License reimbursement
• Travel reimbursement up to $500

Can we talk for 5 minutes? I think you'll be pleasantly surprised.

[Your name]`,
      };
    },
  },
  {
    id: 'referral_request',
    name: '📧 EMAIL: Referral Request',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'specialty'],
    generateContent: (d) => ({
      subject: `${d.name.split(' ')[0] || ''}, know any ${d.specialty}s looking?`,
      body: `Hi ${d.name.split(' ')[0] || ''},

Quick question — do you know any other ${d.specialty}s who might be looking for their next assignment?

I have this great opportunity at ${d.facility}:
• ${currency(d.grossWeeklyPay)}/week
• ${d.city}, ${d.state}
• ${d.shiftType} shift

If you refer someone who takes an assignment, you'll get a $500 referral bonus!

Even if this specific role isn't a fit, I have others. Any names come to mind?

Thanks!
[Your name]`,
    }),
  },
  {
    id: 'text_quick_pitch',
    name: '💬 TEXT: Quick Pitch',
    category: 'outreach',
    messageType: 'sms',
    requiredFields: ['name', 'facility', 'grossWeeklyPay'],
    generateContent: (d) => {
      const formatDate = (ds: string | null) => ds ? new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
      const formatEndDate = (ds: string | null) => ds ? new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';

      return {
        subject: 'Text Message',
        body: `Hi ${d.name.split(' ')[0] || ''}! Quick heads up on an amazing opportunity:

Facility: ${d.facility}
Location: ${d.city}, ${d.state}
Assignment Dates: ${formatDate(d.startDate)} – ${formatEndDate(d.endDate)}
Shifts: ${d.shiftType} (${d.weeklyHours || 36} hrs/wk)
Specialty: ${d.specialty}

Pay Package:
Hourly: ${currency(d.taxableRate || 0)}/hr
Stipends: ${currency(d.weeklyStipend || 0)}/wk
Total Gross: ${currency(d.grossWeeklyPay)}/wk

Please let me know if you would like to be submitted!`,
      };
    },
  },
  {
    id: 'text_followup',
    name: '💬 TEXT: Follow-up Check',
    category: 'outreach',
    messageType: 'sms',
    requiredFields: ['name', 'facility'],
    generateContent: (d) => ({
      subject: 'Text Message',
      body: `Hi ${d.name.split(' ')[0] || ''} - Just circling back on the ${d.specialty} position at ${d.facility} (${currency(d.grossWeeklyPay)}/wk). Still interested? Let me know either way so I can update my notes. Thanks!`,
    }),
  },
  {
    id: 'text_urgent',
    name: '💬 TEXT: Urgent – Fast Decision',
    category: 'outreach',
    messageType: 'sms',
    requiredFields: ['name', 'facility', 'specialty'],
    generateContent: (d) => {
      const formatDate = (dateString: string | null) => {
        if (!dateString) return 'ASAP';
        return new Date(dateString).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      };

      return {
        subject: 'Text Message',
        body: `${d.name.split(' ')[0] || ''} - URGENT: ${d.facility} needs ${d.specialty} by ${formatDate(d.startDate)}. ${currency(d.grossWeeklyPay)}/wk. They're deciding TODAY. Can you talk now? Call me at [phone] or reply YES.`,
      };
    },
  },
  {
    id: 'text_last_chance',
    name: '💬 TEXT: Last Chance',
    category: 'outreach',
    messageType: 'sms',
    requiredFields: ['name', 'facility'],
    generateContent: (d) => ({
      subject: 'Text Message',
      body: `${d.name.split(' ')[0] || ''} - Final call on ${d.facility} (${currency(d.grossWeeklyPay)}/wk). They're deciding by EOD. Reply YES if interested, NO if not. Thanks!`,
    }),
  },
  {
    id: 'text_submitted',
    name: '💬 TEXT: Submission Confirmation',
    category: 'outreach',
    messageType: 'sms',
    requiredFields: ['name', 'facility'],
    generateContent: (d) => ({
      subject: 'Text Message',
      body: `${d.name.split(' ')[0] || ''} - Great news! You're submitted to ${d.facility}. They typically respond within 24-48 hours. I'll text you as soon as I hear back. Fingers crossed!`,
    }),
  },
  {
    id: 'text_offer_received',
    name: '💬 TEXT: Offer Received',
    category: 'outreach',
    messageType: 'sms',
    requiredFields: ['name', 'facility', 'grossWeeklyPay'],
    generateContent: (d) => ({
      subject: 'Text Message',
      body: `${d.name.split(' ')[0] || ''} - OFFER IN! ${d.facility} wants you! ${currency(d.grossWeeklyPay)}/week confirmed. Call me ASAP to review details: [phone]`,
    }),
  },
  {
    id: 'text_submission_general',
    name: '💬 TEXT: Assignment Submission (General)',
    category: 'outreach',
    messageType: 'sms',
    requiredFields: ['name', 'facility', 'city', 'state'],
    generateContent: (d) => {
      const firstName = getFirstName(d.name);
      const facilityName = getFacilityName(d.facility);
      const mealsStipend = d.weeklyStipend ? (d.weeklyStipend * 0.4).toFixed(0) : '—';
      const housingStipend = d.weeklyStipend ? (d.weeklyStipend * 0.6).toFixed(0) : '—';

      return {
        subject: 'Text Message',
        body: `Hey ${firstName}, I just submitted you for this one in ${d.city}, ${d.state}.

Facility: ${facilityName}
Location: ${d.city}, ${d.state}
Assignment Dates: ${shortDate(d.startDate)} – ${shortDate(d.endDate)}
Shifts & Hours/Week: ${d.shiftType} (${d.weeklyHours}/week)
Specialty: ${d.specialty}

Pay Package:
${currency(d.taxableRate)}/hr taxable + $${mealsStipend}/wk meals + $${housingStipend}/wk housing
= ~${currency(d.grossWeeklyPay)}/wk total for ${d.weeklyHours} hours

Let me know if you have any questions or if you're not interested in this one.

Thank you!`,
      };
    },
  },
  {
    id: 'submission_with_references',
    name: '📧 EMAIL: Assignment Submission + Reference Instructions',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['name', 'facility', 'specialty'],
    generateContent: (d) => {
      const firstName = getFirstName(d.name);
      const facilityName = getFacilityName(d.facility);
      const mealsStipend = d.weeklyStipend ? currency(d.weeklyStipend * 0.4) : '—';
      const housingStipend = d.weeklyStipend ? currency(d.weeklyStipend * 0.6) : '—';
      const totalStipends = d.weeklyStipend ? currency(d.weeklyStipend) : '—';

      return {
        subject: `${facilityName} – Application Submitted`,
        body: `Hi ${firstName},

Thanks for chatting with me today about the position at ${facilityName}.

Facility: ${facilityName}
Location: ${d.city}, ${d.state}
Assignment Dates: ${shortDate(d.startDate)} – ${shortDate(d.endDate)}
Shifts & Hours/Week: ${d.shiftType} (${d.weeklyHours} hours/week)
Specialty: ${d.specialty}

Pay Package:
Taxable Hourly Rate: ${currency(d.taxableRate)}/hr
Weekly Meals Stipend: ${mealsStipend}
Weekly Housing Stipend: ${housingStipend}
Total Weekly Stipends (Meals + Housing): ${totalStipends}
Total Gross Weekly Pay for ${d.weeklyHours} Hours Worked: ${currency(d.grossWeeklyPay)}

I've submitted your application and will keep you posted as soon as I hear back.

Reference Instructions:
To help your application move forward, please ask a supervisor (Team Lead, Charge Nurse, Unit Manager, or Director) to complete the attached reference form and email it to References@ayahealthcare.com, CC'ing me at Kofi.Farkye@ayahealthcare.com for tracking.

I will also recommend more assignments to you as they come in.

Please let me know if you have any questions.`,
      };
    },
  },
  {
    id: 'pay_package_snippet',
    name: '📋 SNIPPET: Pay Package & Facility Info',
    category: 'outreach',
    messageType: 'email',
    requiredFields: ['facility'],
    generateContent: (d) => {
      const facilityName = getFacilityName(d.facility);
      const mealsStipend = d.weeklyStipend ? currency(d.weeklyStipend * 0.4) : '—';
      const housingStipend = d.weeklyStipend ? currency(d.weeklyStipend * 0.6) : '—';
      const totalStipends = d.weeklyStipend ? currency(d.weeklyStipend) : '—';

      return {
        subject: 'Pay Package & Facility Info',
        body: `Facility: ${facilityName}
Location: ${d.city}, ${d.state}
Assignment Dates: ${shortDate(d.startDate)} – ${shortDate(d.endDate)}
Shifts & Hours/Week: ${d.shiftType} (${d.weeklyHours} hours/week)
Specialty: ${d.specialty}

Pay Package:
Taxable Hourly Rate: ${currency(d.taxableRate)}/hr
Weekly Meals Stipend: ${mealsStipend}
Weekly Housing Stipend: ${housingStipend}
Total Weekly Stipends (Meals + Housing): ${totalStipends}
Total Gross Weekly Pay for ${d.weeklyHours} Hours Worked: ${currency(d.grossWeeklyPay)}`,
      };
    },
  },
];

// ----------------------
// Ops (internal / operational emails)
// ----------------------
export const OPS_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'ops_reassignment',
    name: '🛠 OPS: Reassignment Request',
    category: 'ops',
    messageType: 'email',
    internalOnly: true,
    requiredFields: ['name'],
    generateContent: (d) => {
      const novaUrl = d.candidateId
        ? `https://nova.ayahealthcare.com/#/recruiting/candidates/${d.candidateId}/new-profile/about`
        : 'Not Available';

      return {
        to: 'reassignments@ayahealthcare.com',
        subject: `Reassignment Request – ${d.name}`,
        body: `Hi Team,

Can we please reassign ${d.name}?

Email: ${d.email || 'Not Available'}
Nova Profile: ${novaUrl}

Thank you!`,
      };
    },
  },

  // Docs + references (candidate-facing ops)
  {
    id: 'ops_documents_and_references',
    name: '🛠 OPS: Documents & References',
    category: 'ops',
    messageType: 'email',
    requiredFields: ['name', 'specialty'],
    generateContent: (d) => ({
      subject: `Items Needed to Complete Your Application - ${d.specialty} Position`,
      body: `Hi ${d.name.split(' ')[0] || ''},

Awesome — thanks for confirming! 

I'll need a couple more items to complete your file before submission:

• Please send me a copy of your ${d.specialty || 'certification'} so we can keep your file complete.
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
    }),
  },

  // Licensing info (internal)
  {
    id: 'ops_licensing_info',
    name: '🛠 OPS: Licensing Info Request',
    category: 'ops',
    messageType: 'email',
    internalOnly: true,
    requiredFields: ['specialty', 'state'],
    generateContent: (d) => ({
      subject: `Licensing - ${d.specialty} - ${d.state}`,
      body: `Hi Team,

Can I please have licensing information for ${d.specialty} in ${d.state}?

Thank you!`,
    }),
  },

  // Margin Approval (internal)
  {
    id: 'margin_approval',
    name: '💰 OPS: Margin Approval Request',
    category: 'ops',
    messageType: 'email',
    internalOnly: true,
    requiredFields: ['name'],
    generateContent: (d) => {
      const margin = d.actualMargin != null ? String(d.actualMargin) : '[XX]';
      const signature = `Best,\nKofi Farkye\nSenior Recruiter, Fulfillment Specialist\nP: 858-529-7267 Ext: 17017`;

      return {
        to: 'Colton.Valdez@ayahealthcare.com',
        cc: 'Tiffany.Chavez@ayahealthcare.com',
        subject: `Margin Approval – ${d.name || '[CANDIDATE]'} – ${margin}%`,
        body: [
          `Reason needed for approval? RFM and Fast Distro set TM% at ${margin}%.`,
          `Is this a New Placement, Extension, or Change of Contract? New Placement`,
          `Is premium approval needed? N`,
          `Was this sent to Comp Info (Y/N)? N`,
          '',
          signature
        ].join('\n'),
      };
    },
  },
];

// ----------------------
// Response (candidate response emails)
// ----------------------
export const RESPONSE_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'response_ltc_and_references',
    name: '✉️ RESPONSE: LTC & Reference Request',
    category: 'response',
    messageType: 'email',
    requiredFields: ['name'],
    generateContent: (d) => {
      const getFirstName = (fullName: string) => (fullName?.trim()?.split(' ')[0] ?? '').replace(/[^A-Za-z'-]/g, '') || 'there';

      return {
        to: d.email,
        subject: `Next Steps: ${d.facility || 'Your Application'}`,
        body: `Hi ${getFirstName(d.name)},

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
      };
    },
  },
];

// ----------------------
// Convenience exports
// ----------------------
export const EMAIL_TEMPLATES = OUTREACH_EMAIL_TEMPLATES; // legacy export (outreach default)

export function getTemplateById(id: string, from: TemplateCategory | 'both' = 'outreach'): EmailTemplate {
  const pools =
    from === 'outreach' ? OUTREACH_EMAIL_TEMPLATES :
      from === 'ops' ? OPS_EMAIL_TEMPLATES :
        from === 'response' ? RESPONSE_EMAIL_TEMPLATES :
          [...OUTREACH_EMAIL_TEMPLATES, ...OPS_EMAIL_TEMPLATES, ...RESPONSE_EMAIL_TEMPLATES];

  return pools.find((t) => t.id === id) || pools[0];
}

// ----------------------
// Legacy Extraction Fallbacks
// ----------------------

export function extractMarginApprovalFromText(text: string): Record<string, string> {
    const data: Record<string, string> = {};
    if (!text) return data;

    const subjectMatch = text.match(/margin approval[:\s-]+([a-z][a-z\s.'-]+?)\s*[-–]\s*([0-9.]+)\s*%/i);
    if (subjectMatch) {
        data.candidateName = subjectMatch[1].trim();
        data.marginPercentage = subjectMatch[2].trim();
    }

    const marginMatch = text.match(/\b(actual\s+margin|margin)\s*[:\-]?\s*([0-9.]+)\s*%/i);
    if (marginMatch && !data.marginPercentage) {
        data.marginPercentage = marginMatch[2].trim();
    }

    const reasonMatch = text.match(/reason needed for approval\??\s*[:\-]?\s*(.+)/i);
    if (reasonMatch?.[1]) data.reason = reasonMatch[1].trim();

    const placementMatch = text.match(/new placement,\s*extension,\s*or change of contract\??\s*[:\-]?\s*(.+)/i);
    if (placementMatch?.[1]) data.placementType = placementMatch[1].trim();

    const premiumMatch = text.match(/premium approval needed\??\s*[:\-]?\s*(.+)/i);
    if (premiumMatch?.[1]) data.premiumNeeded = premiumMatch[1].trim();

    return data;
}

export function extractPayPackageNotesFromText(text: string): string[] {
    if (!text) return [];

    const cleaned = text
        .replace(/\[📎[^\]]+\]\([^)]+\)/g, '')
        .replace(/\bimage\.png\b/gi, '')
        .replace(/\u00a0/g, ' ');

    const rawLines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return [];

    const shouldIgnore = (line: string): boolean => /^(draft|pp|pay package|outreach|draft pp)/i.test(line);

    const isRequirementLine = (line: string): boolean => {
        return /(must|required|requirement|will accept|preferred|call requirement|weekend requirement|float requirement|client offer description|submit info|shift:|hours:|guaranteed hours|start)/i.test(line);
    };

    const seen = new Set<string>();
    const results: string[] = [];

    for (const line of rawLines) {
        if (shouldIgnore(line)) continue;
        if (!isRequirementLine(line)) continue;
        const key = line.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(line);
    }

    return results;
}