import { NextRequest, NextResponse } from "next/server";
import { getCredentialDb } from "@/lib/spanner-pool";

const VALID_TYPES = ["BLS", "ACLS", "PALS"];

// GET /api/credentials?firebase_uid=xxx
export async function GET(req: NextRequest) {
  try {
    const uid = req.nextUrl.searchParams.get("firebase_uid");
    if (!uid) {
      return NextResponse.json({ error: "Missing firebase_uid" }, { status: 400 });
    }

    const db = getCredentialDb();
    const [rows] = await db.run({
      sql: `SELECT c.credential_id, c.credential_type, c.issuer, c.holder_name,
                   c.issue_date, c.expiration_date, c.status, c.source_type,
                   c.verified_status, c.upload_file_url, c.notes,
                   c.created_at, c.updated_at
            FROM users u
            JOIN credentials c ON u.user_id = c.user_id
            WHERE u.firebase_uid = @uid
            ORDER BY c.expiration_date ASC`,
      params: { uid },
      types: { uid: { type: "string" } },
    });

    const credentials = rows.map((row: any) => {
      const r = row.toJSON();
      // Compute live status
      const exp = r.expiration_date?.value || r.expiration_date;
      if (exp) {
        const expDate = new Date(exp);
        const now = new Date();
        const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        r.days_until_expiry = daysLeft;
        if (daysLeft < 0) r.computed_status = "expired";
        else if (daysLeft <= 30) r.computed_status = "expiring_soon";
        else r.computed_status = "active";
      }
      return r;
    });

    return NextResponse.json({ credentials });
  } catch (error: unknown) {
    console.error("Get credentials error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/credentials
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { firebase_uid, credential_type, issuer, holder_name, issue_date, expiration_date, notes } = body;

    if (!firebase_uid || !credential_type || !expiration_date) {
      return NextResponse.json(
        { error: "Missing required fields: firebase_uid, credential_type, expiration_date" },
        { status: 400 }
      );
    }

    if (!VALID_TYPES.includes(credential_type)) {
      return NextResponse.json(
        { error: `Invalid credential_type. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const db = getCredentialDb();

    // Get user_id from firebase_uid
    const [userRows] = await db.run({
      sql: "SELECT user_id FROM users WHERE firebase_uid = @uid",
      params: { uid: firebase_uid },
      types: { uid: { type: "string" } },
    });

    if (userRows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = userRows[0].toJSON().user_id;
    const credId = crypto.randomUUID();

    await db.runTransactionAsync(async (tx: any) => {
      await tx.runUpdate({
        sql: `INSERT INTO credentials
              (user_id, credential_id, credential_type, issuer, holder_name,
               issue_date, expiration_date, status, source_type, verified_status,
               notes, created_at, updated_at)
              VALUES
              (@userId, @credId, @type, @issuer, @holder,
               @issueDate, @expDate, 'active', 'manual', 'user_confirmed',
               @notes, PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP())`,
        params: {
          userId,
          credId,
          type: credential_type,
          issuer: issuer || null,
          holder: holder_name || null,
          issueDate: issue_date || null,
          expDate: expiration_date,
          notes: notes || null,
        },
        types: {
          userId: { type: "string" },
          credId: { type: "string" },
          type: { type: "string" },
          issuer: { type: "string" },
          holder: { type: "string" },
          issueDate: { type: "date" },
          expDate: { type: "date" },
          notes: { type: "string" },
        },
      });
      await tx.commit();
    });

    return NextResponse.json({ credential_id: credId, created: true }, { status: 201 });
  } catch (error: unknown) {
    console.error("Create credential error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
