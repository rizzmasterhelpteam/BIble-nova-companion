import { createClient } from '@supabase/supabase-js';
import { isNativePlatform } from './native/platform';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';
const hasPlaceholderUrl = supabaseUrl.includes('placeholder.supabase.co') || supabaseUrl.includes('your-project.supabase.co');
const hasPlaceholderAnonKey = supabaseAnonKey === 'placeholder-anon-key' || supabaseAnonKey === 'your-anon-key';

export const isSupabaseConfigured = !hasPlaceholderUrl && !hasPlaceholderAnonKey;
export const supabaseConfigMessage =
  'Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in.';

import { Preferences } from '@capacitor/preferences';

const capacitorStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const { value } = await Preferences.get({ key });
    return value;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key: string): Promise<void> => {
    await Preferences.remove({ key });
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: capacitorStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: !isNativePlatform(),
  },
});
