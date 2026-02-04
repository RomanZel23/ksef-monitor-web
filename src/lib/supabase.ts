import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Warning if keys are missing (in dev)
if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase URL or Key is missing. DB operations will fail.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
