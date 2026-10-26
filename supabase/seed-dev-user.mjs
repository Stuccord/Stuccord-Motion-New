/**
 * Seed script: creates a stable dev user in Supabase auth.users
 * and writes the resulting UUID to .env.local as DEV_MOCK_USER_ID
 * so the auth-middleware can read it at runtime.
 *
 * Run once: node --env-file=.env supabase/seed-dev-user.mjs
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment.
 * Point these at a development project, not production.
 */
import { createClient } from "@supabase/supabase-js";
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

  // Check if dev user already exists
  const { data: existingList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = existingList?.users?.find(u => u.email === DEV_USER_EMAIL);

  if (existing) {
    userId = existing.id;
    console.log("✅ Dev user already exists:", userId);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEV_USER_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: "Stuccord Dev User" },
      password: "dev-password-" + Math.random().toString(36).slice(2),
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

  // Write DEV_MOCK_USER_ID to .env.local
  const envLocalPath = path.join(ROOT, ".env.local");
  let envContent = fs.existsSync(envLocalPath) ? fs.readFileSync(envLocalPath, "utf-8") : "";
  if (envContent.includes("DEV_MOCK_USER_ID=")) {
    envContent = envContent.replace(/DEV_MOCK_USER_ID=.*/g, `DEV_MOCK_USER_ID="${userId}"`);
  } else {
    envContent += `\nDEV_MOCK_USER_ID="${userId}"\n`;
  }
  fs.writeFileSync(envLocalPath, envContent, "utf-8");
  console.log(`✅ Wrote DEV_MOCK_USER_ID="${userId}" to .env.local`);

  console.log("\n🎉 Done! Restart your dev server to pick up the new mock user ID.");
}

seed();
