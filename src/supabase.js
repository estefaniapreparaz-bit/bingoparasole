import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const GAME_ID = import.meta.env.VITE_GAME_ID || "bingo-sole";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn("Faltan variables: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
