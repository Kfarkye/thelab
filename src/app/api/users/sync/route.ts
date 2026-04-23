import { NextRequest, NextResponse } from "next/server";
import { getCredentialDb } from "@/lib/spanner-pool";

export async function POST(req: NextRequest) {
  try {
    const { firebase_uid, email, full_name } = await req.json();

    if (!firebase_uid || !email) {
      return NextResponse.json({ error: "Missing firebase_uid or email" }, { status: 400 });
    }

    const db = getCredentialDb();

    // Check if user already exists
    const [rows] = await db.run({
      sql: "SELECT user_id FROM users WHERE firebase_uid = @uid",
      params: { uid: firebase_uid },
      types: { uid: { type: "string" } },
    });

    if (rows.length > 0) {
      return NextResponse.json({ user_id: rows[0].toJSON().user_id, synced: false });
    }

    // Create new user
    const userId = crypto.randomUUID();
    await db.runTransactionAsync(async (tx: any) => {
      await tx.runUpdate({
        sql: `INSERT INTO users (user_id, firebase_uid, email, full_name, role, created_at, updated_at)
              VALUES (@id, @uid, @email, @name, 'clinician', PENDING_COMMIT_TIMESTAMP(), PENDING_COMMIT_TIMESTAMP())`,
        params: { id: userId, uid: firebase_uid, email, name: full_name || email.split("@")[0] },
        types: {
          id: { type: "string" },
          uid: { type: "string" },
          email: { type: "string" },
          name: { type: "string" },
        },
      });
      await tx.commit();
    });

    return NextResponse.json({ user_id: userId, synced: true });
  } catch (error: unknown) {
    console.error("User sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
