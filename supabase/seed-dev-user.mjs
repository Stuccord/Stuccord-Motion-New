/**
 * Seed script: creates a stable dev user in Supabase auth.users
 * and writes the resulting UUID to .env.local as DEV_MOCK_USER_ID
 * so the auth-middleware can read it at runtime.
 *
 * Run once: node supabase/seed-dev-user.mjs
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SUPABASE_URL = "https://ayelmiaagypuracepbzl.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5ZWxtaWFhZ3lwdXJhY2VwYnpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzMzMTAxMSwiZXhwIjoyMDk4OTA3MDExfQ.9j408pU8L5_Da-K0_3zzfmcWlv_Y4JgnqH81DOYmb00";

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
