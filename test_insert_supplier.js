const fs = require('fs');
const { createClient } = require("@supabase/supabase-js");

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = envFile.split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key.trim()] = val.join('=').trim().replace(/"/g, '');
  return acc;
}, {});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from("suppliers").insert({
    name: "Test",
    contact_name: "Contact",
    phone: "123456",
    email: "test@test.com",
    notes: "test notes"
  });
  if (error) {
    console.error("Error inserting:", error);
  } else {
    console.log("Success:", data);
  }
}
test();
