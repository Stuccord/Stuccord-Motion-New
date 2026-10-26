/**
 * Seed script: creates (or resets) a dev user in Supabase auth.users with a
 * freshly generated password, and writes DEV_MOCK_USER_EMAIL and
 * DEV_MOCK_USER_PASSWORD to .env.local. With ENABLE_DEV_MOCK_AUTH=true the
 * dev server signs in as this user, so Row Level Security still applies.
 *
 * Run once: node --env-file=.env supabase/seed-dev-user.mjs
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment.
 * Point these at a development project, not production.
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Credentials come from the environment — never hardcode keys in this file.
// Run with: node --env-file=.env supabase/seed-dev-user.mjs
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env supabase/seed-dev-user.mjs",
  );
  process.exit(1);
}

const DEV_USER_EMAIL = "dev-user@stuccord.local";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function seed() {
  console.log("🌱 Seeding dev user into Supabase auth.users...");

  let userId;
  const password = crypto.randomBytes(24).toString("base64url");

  // Check if dev user already exists
  const { data: existingList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = existingList?.users?.find(u => u.email === DEV_USER_EMAIL);

  if (existing) {
    userId = existing.id;
    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) {
      console.error("❌ Failed to reset dev user password:", error.message);
      process.exit(1);
    }
    console.log("✅ Dev user already exists, password reset:", userId);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEV_USER_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: "Stuccord Dev User" },
      password,
    });
    if (error) {
      console.error("❌ Failed to create dev user:", error.message);
      process.exit(1);
    }
    userId = data.user.id;
    console.log("✅ Dev user created:", userId);
  }

  // Upsert profile
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: "Stuccord Dev User" }, { onConflict: "id" });

  if (profileError) {
    console.warn("⚠️  Profile upsert warning:", profileError.message);
  } else {
    console.log("✅ Profile seeded.");
  }

  // Write the dev user's credentials to .env.local (gitignored)
  const envLocalPath = path.join(ROOT, ".env.local");
  let envContent = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf-8") : "";
  const setEnv = (key, value) => {
    const line = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, "m");
    envContent = re.test(envContent) ? envContent.replace(re, line) : `${envContent.trimEnd()}\n${line}\n`;
  };
  setEnv("DEV_MOCK_USER_EMAIL", DEV_USER_EMAIL);
  setEnv("DEV_MOCK_USER_PASSWORD", password);
  fs.writeFileSync(envLocalPath, envContent, "utf-8");
  console.log("✅ Wrote DEV_MOCK_USER_EMAIL and DEV_MOCK_USER_PASSWORD to .env.local");

  console.log("\n🎉 Done! Restart your dev server to pick up the dev user credentials.");
}

seed();
