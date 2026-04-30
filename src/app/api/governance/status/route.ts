import { NextResponse } from "next/server";

import { getCachedConstitution } from "@/lib/git-governance/engine";

export const runtime = "nodejs";

const ACTIVE_LEDGER_PATH = "docs/ledger/active_rules.json";

type GovernanceStatusResponse = {
  ok: true;
  source: "github";
  ledgerPath: string;
  version: string;
  ledgerBlobSha: string | null;
  fetchedAt: string;
  ruleCount: number;
  ruleVerdicts: string[];
};

type GovernanceStatusErrorResponse = {
  ok: false;
  source: "github";
  ledgerPath: "docs/ledger/active_rules.json";
  error: "Unable to load active governance.";
  code: "GOVERNANCE_STATUS_ERROR";
};

export async function GET(): Promise<NextResponse<GovernanceStatusResponse | GovernanceStatusErrorResponse>> {
  try {
    const constitution = await getCachedConstitution(undefined, undefined, ACTIVE_LEDGER_PATH);

    return NextResponse.json({
      ok: true,
      source: "github",
      ledgerPath: constitution.ledgerPath,
      version: constitution.version,
      ledgerBlobSha: constitution.ledgerBlobSha,
      fetchedAt: new Date(constitution.fetchedAt).toISOString(),
      ruleCount: constitution.ruleCount,
      ruleVerdicts: constitution.ruleVerdicts,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: "github",
        ledgerPath: ACTIVE_LEDGER_PATH,
        error: "Unable to load active governance.",
        code: "GOVERNANCE_STATUS_ERROR",
      },
      { status: 500 },
    );
  }
}
