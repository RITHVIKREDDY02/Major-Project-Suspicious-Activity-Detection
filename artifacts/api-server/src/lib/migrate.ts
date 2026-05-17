import { pool } from "@workspace/db";

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"                    SERIAL PRIMARY KEY,
        "username"              TEXT NOT NULL UNIQUE,
        "email"                 TEXT NOT NULL UNIQUE,
        "full_name"             TEXT,
        "password_hash"         TEXT NOT NULL,
        "is_admin"              BOOLEAN NOT NULL DEFAULT false,
        "twilio_account_sid"    TEXT,
        "twilio_auth_token"     TEXT,
        "twilio_whatsapp_from"  TEXT,
        "twilio_whatsapp_to"    TEXT,
        "twilio_phone_from"     TEXT,
        "twilio_alert_to"       TEXT,
        "telegram_bot_token"    TEXT,
        "telegram_chat_id"      TEXT,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "detections" (
        "id"                    SERIAL PRIMARY KEY,
        "user_id"               INTEGER,
        "input_type"            TEXT NOT NULL DEFAULT 'image',
        "input_url"             TEXT,
        "input_filename"        TEXT,
        "activity_type"         TEXT,
        "confidence"            REAL,
        "status"                TEXT NOT NULL DEFAULT 'pending',
        "bounding_boxes"        TEXT,
        "processed_image_url"   TEXT,
        "notes"                 TEXT,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "monitors" (
        "id"                SERIAL PRIMARY KEY,
        "user_id"           INTEGER,
        "name"              TEXT NOT NULL,
        "stream_url"        TEXT NOT NULL,
        "whatsapp_number"   TEXT NOT NULL,
        "status"            TEXT NOT NULL DEFAULT 'stopped',
        "interval_seconds"  INTEGER NOT NULL DEFAULT 30,
        "alerts_enabled"    BOOLEAN NOT NULL DEFAULT true,
        "last_checked_at"   TIMESTAMPTZ,
        "last_alert_at"     TIMESTAMPTZ,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("[migrate] Tables verified / created successfully.");
  } finally {
    client.release();
  }
}
