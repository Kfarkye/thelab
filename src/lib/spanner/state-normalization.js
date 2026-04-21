const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

const US_STATE_NAME_TO_CODE = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

function normalizeInput(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.toUpperCase().replace(/\./g, " ").trim();
}

export function normalizeUSHomeState(raw) {
  const upper = normalizeInput(raw);
  if (!upper) return null;

  if (US_STATE_CODES.has(upper)) return upper;
  if (US_STATE_NAME_TO_CODE[upper]) return US_STATE_NAME_TO_CODE[upper];

  const commaSegments = upper
    .split(",")
    .map((segment) => segment.replace(/[^A-Z ]/g, " ").trim().replace(/\s+/g, " "))
    .filter(Boolean);

  for (const segment of commaSegments) {
    if (US_STATE_CODES.has(segment)) return segment;
    if (US_STATE_NAME_TO_CODE[segment]) return US_STATE_NAME_TO_CODE[segment];
  }

  const twoLetterTokens = upper.match(/\b[A-Z]{2}\b/g) || [];
  for (const token of twoLetterTokens) {
    if (US_STATE_CODES.has(token)) return token;
  }

  for (const [stateName, stateCode] of Object.entries(US_STATE_NAME_TO_CODE)) {
    const pattern = new RegExp(`\\b${stateName.replace(/\s+/g, "\\s+")}\\b`);
    if (pattern.test(upper)) return stateCode;
  }

  return null;
}

